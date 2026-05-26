import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  AdapterNormalizationResult,
  RawArtifactRef as AdapterRawArtifactRef
} from "../adapter-contract/types.js";
import type {
  DerivedCacheRecord,
  FileBackedCacheStore,
  NormalizedCacheRecord
} from "../cache/file-backed-cache-store.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { mergeNormalizedResults } from "../ingestion/index.js";
import { DEFAULT_BOUNDED_INGESTION_LIMITS } from "../ingestion/bounded-ingestion.js";
import type { RawArtifactIndex, RawArtifactIndexEntry } from "../ingestion/raw-artifact-index.js";
import type {
  FileMutationEvidence,
  OutputArtifact,
  Project,
  Session,
  SessionEvent,
  SessionMessage,
  ShellCommandEvidence,
  ToolCall
} from "../model/entities.js";
import {
  createDiagnosticId,
  type RawArtifactRef as ModelRawArtifactRef
} from "../model/identifiers.js";
import type { SourceRecord, SourceRegistry } from "../registry/source-registry.js";
import {
  createSafeFilesystem,
  isPathWithinDirectory,
  isSamePath
} from "../security/index.js";
import {
  ArchiveAggregateTracker,
  ARCHIVE_FORMAT,
  ARCHIVE_MANIFEST_VERSION,
  ARCHIVE_V3_ENTITY_SECTION_NAMES,
  ARCHIVE_V3_MANIFEST_VERSION,
  type ArchiveAggregateLimits,
  type ArchiveManifest,
  createEmptyArchiveV3SectionEntityCounts,
  type ArchiveV3EntitySectionName,
  type ArchiveV3Manifest,
  type ArchivedRawArtifact,
  type ArchivedSourceRecord,
  type VersionedArchiveManifest
} from "./archive-manifest.js";
import type {
  StoredProjectGitHubSnapshot,
  StoredProjectGitSnapshot,
  StoredSessionRunAuditSnapshot,
  StoredSessionVerificationSnapshot,
  WorkbenchArchivePreflight,
  WorkbenchCurrentRunScope,
  WorkbenchEntityStore,
  WorkbenchOverviewRollup,
  WorkbenchProjectRollup,
  WorkbenchRawArtifactMetadataRecord,
  WorkbenchSessionRecord,
  WorkbenchSessionRollup,
  WorkbenchTimelineRecord
} from "../store/workbench-entity-store.js";

export type ArchiveExportScope =
  | { kind: "project"; projectId: string }
  | { kind: "session"; sessionId: string };

export interface ArchiveExportAvailability {
  scopeKind: "project" | "session";
  scopeId: string;
  scopeLabel: string;
  sessionCount: number;
  sourceCount: number;
  rawArtifactsAvailable: boolean;
  rawArtifactCount: number;
  rawArtifactsReason?: string;
}

export interface CreateArchiveInput {
  destinationPath: string;
  includeRawArtifacts: boolean;
  privacyWarningAcknowledged: boolean;
  scope: ArchiveExportScope;
}

export interface CreateArchiveResult {
  archivePath: string;
  manifest: VersionedArchiveManifest;
  rawArtifactCount: number;
}

export class ArchiveExportError extends Error {
  readonly code:
    | "archive-export.scope-not-found"
    | "archive-export.raw-artifacts-unavailable"
    | "archive-export.warning-not-acknowledged";

  constructor(code: ArchiveExportError["code"], message: string) {
    super(message);
    this.name = "ArchiveExportError";
    this.code = code;
  }
}

interface ArchiveExporterOptions {
  cacheStore: FileBackedCacheStore;
  entityStore?: WorkbenchEntityStore;
  rawArtifactIndex: RawArtifactIndex;
  sourceRegistry: SourceRegistry;
  now?: () => Date;
}

interface ScopeResolution {
  availability: ArchiveExportAvailability;
  cacheRecords: NormalizedCacheRecord[];
  projectIds: string[];
  rawArtifactEntries: RawArtifactIndexEntry[];
  sessionIds: string[];
  sourceDiagnostics: Diagnostic[];
  sources: ArchivedSourceRecord[];
}

interface ScopeResolutionContext {
  cacheRecords: NormalizedCacheRecord[];
  merged: AdapterNormalizationResult;
  rawArtifactEntries: RawArtifactIndexEntry[];
  sourceRecords: SourceRecord[];
}

interface ArchivedSourceScope {
  archivedSource: ArchivedSourceRecord;
  diagnostics: Diagnostic[];
}

interface StoreScopeResolution {
  availability: ArchiveExportAvailability;
  exportableRawArtifacts: Array<
    WorkbenchRawArtifactMetadataRecord & { entry: RawArtifactIndexEntry }
  >;
  manifest: ArchiveV3Manifest;
  sourcePlans: StoreSourcePlan[];
}

interface StoreSourcePlan {
  adapterId: string;
  archivedSource: ArchivedSourceRecord;
  overviewRollup?: WorkbenchOverviewRollup;
  outputArtifacts: OutputArtifact[];
  preflight: WorkbenchArchivePreflight;
  projectRollups: WorkbenchProjectRollup[];
  projects: Project[];
  rawArtifactMetadata: WorkbenchRawArtifactMetadataRecord[];
  runAuditSnapshots: StoredSessionRunAuditSnapshot[];
  sectionEntityCounts: Record<ArchiveV3EntitySectionName, number>;
  sessionRecords: WorkbenchSessionRecord[];
  sessionRollups: WorkbenchSessionRollup[];
  sessions: Session[];
  sourceDiagnostics: Diagnostic[];
  sourceId: string;
  storeDiagnostics: Diagnostic[];
  verificationSnapshots: StoredSessionVerificationSnapshot[];
}

interface StoreAvailabilitySourceContext {
  exportableRawArtifactCountByProjectId: ReadonlyMap<string, number>;
  preflightFailed: boolean;
  projectQueryFailed: boolean;
  rawArtifactMetadataFailed: boolean;
  projectRollups: WorkbenchProjectRollup[];
  sourceId: string;
}

export interface ArchiveExportAvailabilityBatchOptions {
  projectSourceCoverageByProjectId?: ReadonlyMap<string, readonly string[]>;
}

const DEFAULT_ARCHIVE_V3_AGGREGATE_LIMITS: ArchiveAggregateLimits = {
  maxSectionCount: ARCHIVE_V3_ENTITY_SECTION_NAMES.length,
  maxSectionEntityCount: 1_000,
  maxTotalEntityCount: 10_000,
  maxRawArtifactChunkCountPerArtifact: 16,
  maxRawArtifactBytes: 4 * 1024 * 1024,
  maxSourceDiagnosticCount: 1_000
};
const STORE_EXPORT_PAGE_LIMIT = 100;

export class ArchiveExporter {
  readonly #cacheStore: FileBackedCacheStore;
  readonly #entityStore: WorkbenchEntityStore | undefined;
  readonly #now: () => Date;
  readonly #rawArtifactIndex: RawArtifactIndex;
  readonly #sourceRegistry: SourceRegistry;

  constructor(options: ArchiveExporterOptions) {
    this.#cacheStore = options.cacheStore;
    this.#entityStore = options.entityStore;
    this.#now = options.now ?? (() => new Date());
    this.#rawArtifactIndex = options.rawArtifactIndex;
    this.#sourceRegistry = options.sourceRegistry;
  }

  async getScopeAvailability(
    scope: ArchiveExportScope
  ): Promise<ArchiveExportAvailability> {
    if (this.#entityStore) {
      return (await this.#resolveStoreScope(scope)).availability;
    }

    return (await this.#resolveScope(scope)).availability;
  }

  async getScopeAvailabilities(
    scopes: ArchiveExportScope[],
    options: ArchiveExportAvailabilityBatchOptions = {}
  ): Promise<ArchiveExportAvailability[]> {
    if (scopes.length === 0) {
      return [];
    }

    if (this.#entityStore) {
      const sourceRecords = await this.#sourceRegistry.listSources();
      return this.#resolveStoreScopeAvailabilities(scopes, sourceRecords, options);
    }

    const context = await this.#loadScopeResolutionContext();

    return scopes.map((scope) => this.#resolveScopeWithContext(scope, context).availability);
  }

  async createArchive(input: CreateArchiveInput): Promise<CreateArchiveResult> {
    if (this.#entityStore) {
      return this.#createArchiveV3(input);
    }

    const resolution = await this.#resolveScope(input.scope);

    if (input.includeRawArtifacts && !resolution.availability.rawArtifactsAvailable) {
      throw new ArchiveExportError(
        "archive-export.raw-artifacts-unavailable",
        resolution.availability.rawArtifactsReason ??
          "No indexed raw artifacts are available for this archive scope."
      );
    }

    if (input.includeRawArtifacts && !input.privacyWarningAcknowledged) {
      throw new ArchiveExportError(
        "archive-export.warning-not-acknowledged",
        "Raw artifact export requires an acknowledged privacy warning."
      );
    }

    const rawArtifacts = input.includeRawArtifacts
      ? await this.#loadRawArtifacts(resolution.rawArtifactEntries)
      : [];
    const exportedAt = this.#now().toISOString();
    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      manifestVersion: ARCHIVE_MANIFEST_VERSION,
      exportedAt,
      scope: {
        kind: resolution.availability.scopeKind,
        id: resolution.availability.scopeId,
        label: resolution.availability.scopeLabel
      },
      includes: {
        normalizedData: true,
        diagnostics: true,
        rawArtifacts: input.includeRawArtifacts,
        privacyWarningAcknowledged: input.privacyWarningAcknowledged
      },
      adapters: unique(
        resolution.sources.map((source) => source.adapterId).sort((left, right) =>
          left.localeCompare(right)
        )
      ),
      sourceIds: resolution.sources.map((source) => source.sourceId),
      sessionIds: resolution.sessionIds,
      projectIds: resolution.projectIds,
      counts: {
        sources: resolution.sources.length,
        sessions: resolution.sessionIds.length,
        projects: resolution.projectIds.length,
        cacheRecords: resolution.cacheRecords.length,
        sourceDiagnostics: resolution.sourceDiagnostics.length,
        rawArtifacts: rawArtifacts.length
      }
    };
    await mkdir(path.dirname(input.destinationPath), { recursive: true });
    await writeArchiveV2({
      cacheRecords: resolution.cacheRecords.map(sanitizeArchivedCacheRecord),
      destinationPath: input.destinationPath,
      manifest,
      rawArtifacts,
      sourceDiagnostics: resolution.sourceDiagnostics,
      sources: resolution.sources
    });

    return {
      archivePath: input.destinationPath,
      manifest,
      rawArtifactCount: rawArtifacts.length
    };
  }

  async #createArchiveV3(input: CreateArchiveInput): Promise<CreateArchiveResult> {
    const resolution = await this.#resolveStoreScope(input.scope);

    if (input.includeRawArtifacts && !resolution.availability.rawArtifactsAvailable) {
      throw new ArchiveExportError(
        "archive-export.raw-artifacts-unavailable",
        resolution.availability.rawArtifactsReason ??
          "No indexed raw artifacts are available for this archive scope."
      );
    }

    if (input.includeRawArtifacts && !input.privacyWarningAcknowledged) {
      throw new ArchiveExportError(
        "archive-export.warning-not-acknowledged",
        "Raw artifact export requires an acknowledged privacy warning."
      );
    }

    const manifest: ArchiveV3Manifest = {
      ...resolution.manifest,
      includes: {
        ...resolution.manifest.includes,
        rawArtifacts: input.includeRawArtifacts,
        privacyWarningAcknowledged: input.privacyWarningAcknowledged
      }
    };
    const exportableRawArtifacts: Array<
      WorkbenchRawArtifactMetadataRecord & { entry: RawArtifactIndexEntry }
    > = input.includeRawArtifacts ? resolution.exportableRawArtifacts : [];
    const rawArtifactCount = input.includeRawArtifacts
      ? resolution.exportableRawArtifacts.length
      : 0;
    await mkdir(path.dirname(input.destinationPath), { recursive: true });
    await writeArchiveV3({
      destinationPath: input.destinationPath,
      entityStore: this.#entityStore!,
      exportableRawArtifacts,
      manifest: {
        ...manifest,
        counts: {
          ...manifest.counts,
          rawArtifacts: rawArtifactCount
        }
      },
      sourcePlans: resolution.sourcePlans
    });

    return {
      archivePath: input.destinationPath,
      manifest: {
        ...manifest,
        counts: {
          ...manifest.counts,
          rawArtifacts: rawArtifactCount
        }
      },
      rawArtifactCount
    };
  }

  async #resolveStoreScope(
    scope: ArchiveExportScope,
    sourceRecords?: SourceRecord[]
  ): Promise<StoreScopeResolution> {
    const entityStore = this.#entityStore;

    if (!entityStore) {
      throw new ArchiveExportError(
        "archive-export.scope-not-found",
        "Store-backed archive export is unavailable."
      );
    }
    const sourcePlans: StoreSourcePlan[] = [];
    const sourceRecordsToUse = sourceRecords ?? (await this.#sourceRegistry.listSources());

    for (const sourceRecord of sourceRecordsToUse) {
      const preflight = await entityStore.getArchivePreflight?.({
        sourceId: sourceRecord.sourceId
      });

      if (!preflight) {
        continue;
      }

      const sourcePlan = await this.#buildStoreSourcePlan(scope, sourceRecord, preflight);

      if (sourcePlan) {
        sourcePlans.push(sourcePlan);
      }
    }

    if (sourcePlans.length === 0) {
      throw new ArchiveExportError(
        "archive-export.scope-not-found",
        scope.kind === "project"
          ? `Project '${scope.projectId}' could not be resolved for export.`
          : `Session '${scope.sessionId}' could not be resolved for export.`
      );
    }

    const sectionEntityCounts = createEmptyArchiveV3SectionEntityCounts();
    const projectIds = unique(
      sourcePlans.flatMap((sourcePlan) => sourcePlan.projects.map((project) => project.id))
    ).sort((left, right) => left.localeCompare(right));
    const sessionIds = unique(
      sourcePlans.flatMap((sourcePlan) => sourcePlan.sessions.map((session) => session.id))
    ).sort((left, right) => left.localeCompare(right));
    const sourceDiagnostics = uniqueDiagnostics(
      sourcePlans.flatMap((sourcePlan) => sourcePlan.sourceDiagnostics)
    );

    sectionEntityCounts.sources = sourcePlans.length;

    for (const sectionName of ARCHIVE_V3_ENTITY_SECTION_NAMES) {
      if (sectionName === "sources") {
        continue;
      }

      sectionEntityCounts[sectionName] = sourcePlans.reduce(
        (total, sourcePlan) => total + sourcePlan.sectionEntityCounts[sectionName],
        0
      );
    }

    sectionEntityCounts.diagnostics += sourceDiagnostics.length;

    const totalEntities = Object.values(sectionEntityCounts).reduce(
      (total, count) => total + count,
      0
    );
    const exportableRawArtifacts = sourcePlans
      .flatMap((sourcePlan) => sourcePlan.rawArtifactMetadata)
      .filter(
        (
          metadata
        ): metadata is WorkbenchRawArtifactMetadataRecord & { entry: RawArtifactIndexEntry } =>
          isExportableRawArtifactMetadata(metadata)
      )
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    const selectedProjects = sourcePlans.flatMap((sourcePlan) => sourcePlan.projects);
    const selectedSessions = sourcePlans.flatMap((sourcePlan) => sourcePlan.sessions);
    const availability: ArchiveExportAvailability = {
      scopeKind: scope.kind,
      scopeId: scope.kind === "project" ? scope.projectId : scope.sessionId,
      scopeLabel:
        scope.kind === "project"
          ? selectedProjects[0]?.displayName ?? selectedProjects[0]?.name ?? "Project Archive"
          : selectedSessions[0]?.title ?? selectedSessions[0]?.nativeId ?? "Session Archive",
      sessionCount: sessionIds.length,
      sourceCount: sourcePlans.length,
      rawArtifactsAvailable: exportableRawArtifacts.length > 0,
      rawArtifactCount: exportableRawArtifacts.length,
      ...(exportableRawArtifacts.length === 0
        ? {
            rawArtifactsReason:
              "No indexed raw artifacts are available for this archive scope."
          }
        : {})
    };
    const exportedAt = this.#now().toISOString();
    const manifest: ArchiveV3Manifest = {
      format: ARCHIVE_FORMAT,
      manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
      exportedAt,
      scope: {
        kind: availability.scopeKind,
        id: availability.scopeId,
        label: availability.scopeLabel
      },
      includes: {
        normalizedData: true,
        diagnostics: true,
        rawArtifacts: false,
        privacyWarningAcknowledged: false
      },
      adapters: unique(sourcePlans.map((sourcePlan) => sourcePlan.adapterId)).sort((left, right) =>
        left.localeCompare(right)
      ),
      sourceIds: sourcePlans.map((sourcePlan) => sourcePlan.sourceId),
      sessionIds,
      projectIds,
      counts: {
        sources: sourcePlans.length,
        sessions: sessionIds.length,
        projects: projectIds.length,
        sourceDiagnostics: sourceDiagnostics.length,
        rawArtifacts: exportableRawArtifacts.length,
        totalEntities
      },
      sectionEntityCounts,
      aggregateLimits: DEFAULT_ARCHIVE_V3_AGGREGATE_LIMITS
    };

    return {
      availability,
      exportableRawArtifacts,
      manifest,
      sourcePlans
    };
  }

  async #resolveStoreScopeAvailabilities(
    scopes: ArchiveExportScope[],
    sourceRecords?: SourceRecord[],
    options: ArchiveExportAvailabilityBatchOptions = {}
  ): Promise<ArchiveExportAvailability[]> {
    const entityStore = this.#entityStore;

    if (!entityStore) {
      throw new ArchiveExportError(
        "archive-export.scope-not-found",
        "Store-backed archive export is unavailable."
      );
    }

    const sourceRecordsToUse = sourceRecords ?? (await this.#sourceRegistry.listSources());
    const projectScopes = scopes.filter(
      (scope): scope is Extract<ArchiveExportScope, { kind: "project" }> => scope.kind === "project"
    );
    const sourceContexts =
      projectScopes.length === 0
        ? []
        : await Promise.all(
            sourceRecordsToUse.map(
              async (sourceRecord): Promise<StoreAvailabilitySourceContext> => {
                const sourceId = sourceRecord.sourceId;

                try {
                  const preflight = await entityStore.getArchivePreflight?.({ sourceId });

                  if (!preflight) {
                    return {
                      exportableRawArtifactCountByProjectId: new Map<string, number>(),
                      preflightFailed: false,
                      projectQueryFailed: false,
                      rawArtifactMetadataFailed: false,
                      projectRollups: [],
                      sourceId
                    };
                  }

                  try {
                    const [projectRollupsResult, rawArtifactMetadataResult] =
                      await Promise.allSettled([
                        entityStore.listProjectRollups({ sourceId }),
                        entityStore.listRawArtifactMetadata({ sourceId })
                      ]);

                    if (
                      projectRollupsResult.status === "rejected" ||
                      rawArtifactMetadataResult.status === "rejected"
                    ) {
                      return {
                        exportableRawArtifactCountByProjectId: new Map<string, number>(),
                        preflightFailed: false,
                        projectQueryFailed: projectRollupsResult.status === "rejected",
                        rawArtifactMetadataFailed: rawArtifactMetadataResult.status === "rejected",
                        projectRollups:
                          projectRollupsResult.status === "fulfilled"
                            ? projectRollupsResult.value
                            : [],
                        sourceId
                      };
                    }

                    return {
                      exportableRawArtifactCountByProjectId:
                        buildExportableRawArtifactCountByProjectId(
                          projectRollupsResult.value,
                          rawArtifactMetadataResult.value
                        ),
                      preflightFailed: false,
                      projectQueryFailed: false,
                      rawArtifactMetadataFailed: false,
                      projectRollups: projectRollupsResult.value,
                      sourceId
                    };
                  } catch {
                    return {
                      exportableRawArtifactCountByProjectId: new Map<string, number>(),
                      preflightFailed: false,
                      projectQueryFailed: true,
                      rawArtifactMetadataFailed: true,
                      projectRollups: [],
                      sourceId
                    };
                  }
                } catch {
                  return {
                    exportableRawArtifactCountByProjectId: new Map<string, number>(),
                    preflightFailed: true,
                    projectQueryFailed: false,
                    rawArtifactMetadataFailed: false,
                    projectRollups: [],
                    sourceId
                  };
                }
              }
            )
          );

    const availabilities = await Promise.all(
      scopes.map(async (scope) => {
        if (scope.kind === "project") {
          return this.#buildStoreAvailabilityFromSourceContexts(
            scope,
            sourceContexts,
            options.projectSourceCoverageByProjectId?.get(scope.projectId)
          );
        }

        try {
          return (await this.#resolveStoreScope(scope, sourceRecordsToUse)).availability;
        } catch {
          return this.#buildUnavailableStoreAvailability(scope);
        }
      })
    );

    return availabilities;
  }

  #buildStoreAvailabilityFromSourceContexts(
    scope: ArchiveExportScope,
    sourceContexts: StoreAvailabilitySourceContext[],
    expectedSourceIds: readonly string[] = []
  ): ArchiveExportAvailability {
    if (scope.kind === "project") {
      const hasSourceContextFailures = sourceContexts.some(
        (sourceContext) =>
          sourceContext.preflightFailed ||
          sourceContext.projectQueryFailed ||
          sourceContext.rawArtifactMetadataFailed
      );
      const normalizedExpectedSourceIds = unique(
        expectedSourceIds.filter((sourceId) => sourceId.length > 0)
      );

      if (hasSourceContextFailures && normalizedExpectedSourceIds.length === 0) {
        return this.#buildUnavailableStoreAvailability(scope);
      }

      const matchingProjectRollups = sourceContexts.flatMap((sourceContext) =>
        sourceContext.preflightFailed ||
        sourceContext.projectQueryFailed ||
        sourceContext.rawArtifactMetadataFailed
          ? []
          : sourceContext.projectRollups
              .filter((projectRollup) => projectRollup.projectId === scope.projectId)
              .map((projectRollup) => ({
                exportableRawArtifactCount:
                  sourceContext.exportableRawArtifactCountByProjectId.get(
                    projectRollup.projectId ?? ""
                  ) ?? 0,
                projectRollup,
                sourceId: sourceContext.sourceId
              }))
      );

      if (matchingProjectRollups.length === 0) {
        return this.#buildUnavailableStoreAvailability(scope);
      }

      const coveredSourceIds = unique(
        matchingProjectRollups.map(({ sourceId }) => sourceId)
      );

      if (
        normalizedExpectedSourceIds.length > 0 &&
        normalizedExpectedSourceIds.some((sourceId) => !coveredSourceIds.includes(sourceId))
      ) {
        return this.#buildUnavailableStoreAvailability(scope);
      }

      const sessionIds = unique(
        matchingProjectRollups.flatMap(({ projectRollup }) => projectRollup.sessionIds)
      ).sort((left, right) => left.localeCompare(right));
      const rawArtifactCount = matchingProjectRollups.reduce(
        (total, { exportableRawArtifactCount }) => total + exportableRawArtifactCount,
        0
      );

      return {
        scopeKind: scope.kind,
        scopeId: scope.projectId,
        scopeLabel:
          matchingProjectRollups[0]?.projectRollup.project?.displayName ??
          matchingProjectRollups[0]?.projectRollup.project?.name ??
          "Project Archive",
        sessionCount: sessionIds.length,
        sourceCount: coveredSourceIds.length,
        rawArtifactsAvailable: rawArtifactCount > 0,
        rawArtifactCount,
        ...(rawArtifactCount === 0
          ? {
              rawArtifactsReason:
                "No indexed raw artifacts are available for this archive scope."
            }
          : {})
      };
    }

    return this.#buildUnavailableStoreAvailability(scope);
  }

  #buildUnavailableStoreAvailability(
    scope: ArchiveExportScope
  ): ArchiveExportAvailability {
    return {
      scopeKind: scope.kind,
      scopeId: scope.kind === "project" ? scope.projectId : scope.sessionId,
      scopeLabel: scope.kind === "project" ? "Project Archive" : "Session Archive",
      sessionCount: 0,
      sourceCount: 0,
      rawArtifactsAvailable: false,
      rawArtifactCount: 0,
      rawArtifactsReason:
        "Archive export availability could not be resolved for this scope."
    };
  }

  async #buildStoreSourcePlan(
    scope: ArchiveExportScope,
    sourceRecord: SourceRecord,
    preflight: WorkbenchArchivePreflight
  ): Promise<StoreSourcePlan | undefined> {
    const entityStore = this.#entityStore!;
    const sourceScope = { sourceId: sourceRecord.sourceId };
    const projectRollups =
      scope.kind === "project"
        ? (await entityStore.listProjectRollups(sourceScope)).filter(
            (projectRollup) => projectRollup.projectId === scope.projectId
          )
        : await this.#loadProjectRollupsForSessionScope(sourceScope, scope.sessionId);
    const rawProjects = projectRollups
      .flatMap((projectRollup) => (projectRollup.project ? [projectRollup.project] : []))
      .sort((left, right) => left.id.localeCompare(right.id));

    if (scope.kind === "project" && rawProjects.length === 0) {
      return undefined;
    }

    const sessionRecords =
      scope.kind === "project"
        ? await listAllSessionRecordsForSource(entityStore, {
            projectId: scope.projectId,
            sourceId: sourceRecord.sourceId
          })
        : await this.#loadSessionRecordsForSessionScope(sourceScope, scope.sessionId);
    const rawSessions = sessionRecords.map((sessionRecord) => sessionRecord.session);

    if (rawSessions.length === 0) {
      return undefined;
    }

    const sectionEntityCounts = createEmptyArchiveV3SectionEntityCounts();
    const selectedEntityIds = new Set<string>([
      ...rawProjects.map((project) => project.id),
      ...rawSessions.map((session) => session.id)
    ]);
    const outputArtifactsById = new Map<string, OutputArtifact>();
    const includeOutputArtifact = (artifact: OutputArtifact) => {
      if (outputArtifactsById.has(artifact.id)) {
        return;
      }

      outputArtifactsById.set(artifact.id, artifact);
      sectionEntityCounts["output-artifacts"] += 1;
      selectedEntityIds.add(artifact.id);
    };

    for (const session of rawSessions) {
      await forEachTimelineRecord(
        entityStore,
        { sessionId: session.id, sourceId: sourceRecord.sourceId },
        (timelineRecord) => {
          sectionEntityCounts["timeline-events"] += 1;
          selectedEntityIds.add(timelineRecord.event.id);

          if (timelineRecord.message) {
            sectionEntityCounts.messages += 1;
            selectedEntityIds.add(timelineRecord.message.id);
          }

          if (timelineRecord.toolCall) {
            sectionEntityCounts["tool-calls"] += 1;
            selectedEntityIds.add(timelineRecord.toolCall.id);
          }

          if (timelineRecord.shellCommand) {
            sectionEntityCounts["shell-commands"] += 1;
            selectedEntityIds.add(timelineRecord.shellCommand.id);
          }

          for (const artifact of timelineRecord.outputArtifacts ?? []) {
            includeOutputArtifact(artifact);
          }

          if (timelineRecord.fileMutation) {
            sectionEntityCounts["file-mutations"] += 1;
            selectedEntityIds.add(timelineRecord.fileMutation.id);
          }
        }
      );
    }

    if (entityStore.getOutputArtifact) {
      const missingOutputArtifactIds = unique(
        rawSessions.flatMap((session) => session.outputArtifactIds ?? [])
      )
        .filter((outputArtifactId) => !outputArtifactsById.has(outputArtifactId))
        .sort((left, right) => left.localeCompare(right));

      const missingOutputArtifacts = await Promise.all(
        missingOutputArtifactIds.map((outputArtifactId) =>
          entityStore.getOutputArtifact?.({
            sourceId: sourceRecord.sourceId,
            outputArtifactId
          })
        )
      );

      for (const outputArtifact of missingOutputArtifacts) {
        if (outputArtifact) {
          includeOutputArtifact(outputArtifact);
        }
      }
    }

    const outputArtifacts = [...outputArtifactsById.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    );

    const storeDiagnostics = (await entityStore.listDiagnostics(sourceScope))
      .filter((diagnostic) =>
        shouldIncludeStoreDiagnostic(diagnostic, selectedEntityIds, sourceRecord.sourceId)
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const sourceDiagnostics = uniqueDiagnostics(
      sourceRecord.diagnostics.map((diagnostic) =>
        rebaseSourceDiagnostic(diagnostic, sourceRecord.sourceId)
      )
    );
    const rawArtifactMetadata = selectRawArtifactMetadata({
      outputArtifacts,
      projects: rawProjects,
      rawArtifactMetadata: await entityStore.listRawArtifactMetadata(sourceScope),
      sessions: rawSessions
    });
    const verificationSnapshots = sessionRecords
      .flatMap((sessionRecord) =>
        sessionRecord.verification
          ? [{ sessionId: sessionRecord.session.id, verification: sessionRecord.verification }]
          : []
      )
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    const runAuditSnapshots = sessionRecords
      .flatMap((sessionRecord) =>
        sessionRecord.runAudit
          ? [{ sessionId: sessionRecord.session.id, audit: sessionRecord.runAudit }]
          : []
      )
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    const sessionRollups = (
      await Promise.all(
        rawSessions.map((session) =>
          entityStore.getSessionRollup({
            sourceId: sourceRecord.sourceId,
            sessionId: session.id
          })
        )
      )
    )
      .filter((sessionRollup): sessionRollup is WorkbenchSessionRollup => Boolean(sessionRollup))
      .map(sanitizeArchivedSessionRollup)
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    const overviewRollup = await entityStore.getOverviewRollup(sourceScope);
    const projects = rawProjects.map(sanitizeArchivedProject);
    const sessions = rawSessions.map(sanitizeArchivedSession);

    sectionEntityCounts.projects = rawProjects.length;
    sectionEntityCounts.sessions = rawSessions.length;
    sectionEntityCounts.diagnostics = storeDiagnostics.length;
    sectionEntityCounts["verification-snapshots"] = verificationSnapshots.length;
    sectionEntityCounts["run-audit-snapshots"] = runAuditSnapshots.length;
    sectionEntityCounts["git-snapshots"] = projectRollups.filter((projectRollup) => projectRollup.git).length;
    sectionEntityCounts["github-snapshots"] = projectRollups.filter((projectRollup) => projectRollup.github).length;
    sectionEntityCounts["overview-rollups"] = overviewRollup ? 1 : 0;
    sectionEntityCounts["project-rollups"] = projectRollups.length;
    sectionEntityCounts["session-rollups"] = sessionRollups.length;
    sectionEntityCounts["raw-artifact-entries"] = rawArtifactMetadata.length;

    return {
      adapterId: preflight.adapterId,
      archivedSource: toArchivedSourceRecord(sourceRecord),
      ...(overviewRollup ? { overviewRollup } : {}),
      outputArtifacts: outputArtifacts.map(sanitizeArchivedOutputArtifact),
      preflight,
      projectRollups: projectRollups.map(sanitizeArchivedProjectRollup),
      projects,
      rawArtifactMetadata,
      runAuditSnapshots,
      sectionEntityCounts,
      sessionRecords,
      sessionRollups,
      sessions,
      sourceDiagnostics,
      sourceId: sourceRecord.sourceId,
      storeDiagnostics,
      verificationSnapshots
    };
  }

  async #loadProjectRollupsForSessionScope(
    scope: WorkbenchCurrentRunScope,
    sessionId: string
  ): Promise<WorkbenchProjectRollup[]> {
    const sessionRollup = await this.#entityStore!.getSessionRollup({
      sourceId: scope.sourceId,
      sessionId
    });

    if (!sessionRollup?.projectId) {
      return [];
    }

    return (await this.#entityStore!.listProjectRollups(scope)).filter(
      (projectRollup) => projectRollup.projectId === sessionRollup.projectId
    );
  }

  async #loadSessionRecordsForSessionScope(
    scope: WorkbenchCurrentRunScope,
    sessionId: string
  ): Promise<WorkbenchSessionRecord[]> {
    const sessionRollup = await this.#entityStore!.getSessionRollup({
      sourceId: scope.sourceId,
      sessionId
    });

    if (!sessionRollup?.session) {
      return [];
    }

    const verification = await this.#entityStore!.getSessionVerificationSnapshot({
      sourceId: scope.sourceId,
      sessionId
    });
    const runAudit = await this.#entityStore!.getSessionRunAuditSnapshot({
      sourceId: scope.sourceId,
      sessionId
    });

    return [
      {
        session: sessionRollup.session,
        ...(runAudit ? { runAudit: runAudit.audit } : {}),
        ...(verification ? { verification: verification.verification } : {}),
        ...(sessionRollup.rawArtifactCount !== undefined
          ? { rawArtifactCount: sessionRollup.rawArtifactCount }
          : {})
      }
    ];
  }

  async #resolveScope(scope: ArchiveExportScope): Promise<ScopeResolution> {
    return this.#resolveScopeWithContext(scope, await this.#loadScopeResolutionContext());
  }

  async #loadScopeResolutionContext(): Promise<ScopeResolutionContext> {
    const [cacheRecords, rawArtifactEntries, sourceRecords] = await Promise.all([
      this.#cacheStore.listLatestRecords(),
      this.#rawArtifactIndex.load(),
      this.#sourceRegistry.listSources()
    ]);
    const merged = mergeNormalizedResults(cacheRecords.map((record) => record.normalized));

    if (!merged) {
      throw new ArchiveExportError(
        "archive-export.scope-not-found",
        "No cached source data is available for archive export."
      );
    }

    return {
      cacheRecords,
      merged,
      rawArtifactEntries,
      sourceRecords
    };
  }

  #resolveScopeWithContext(
    scope: ArchiveExportScope,
    context: ScopeResolutionContext
  ): ScopeResolution {
    const { cacheRecords, merged, rawArtifactEntries, sourceRecords } = context;

    const selectedProject =
      scope.kind === "project"
        ? merged.projects.find((project) => project.id === scope.projectId)
        : undefined;
    const selectedSession =
      scope.kind === "session"
        ? merged.sessions.find((session) => session.id === scope.sessionId)
        : undefined;

    if (scope.kind === "project" && !selectedProject) {
      throw new ArchiveExportError(
        "archive-export.scope-not-found",
        `Project '${scope.projectId}' could not be resolved for export.`
      );
    }

    if (scope.kind === "session" && !selectedSession) {
      throw new ArchiveExportError(
        "archive-export.scope-not-found",
        `Session '${scope.sessionId}' could not be resolved for export.`
      );
    }

    const sessionIds =
      scope.kind === "project"
        ? merged.sessions
            .filter((session) => session.projectId === selectedProject?.id)
            .map((session) => session.id)
        : selectedSession
          ? [selectedSession.id]
          : [];
    const projectIds =
      scope.kind === "project"
        ? selectedProject
          ? [selectedProject.id]
          : []
        : selectedSession?.projectId
          ? [selectedSession.projectId]
          : [];
    const sourceIds = unique(
      (
        scope.kind === "project"
          ? [
              ...(selectedProject?.sourceId ? [selectedProject.sourceId] : []),
              ...merged.sessions
                .filter((session) => session.projectId === selectedProject?.id)
                .map((session) => session.sourceId)
            ]
          : selectedSession
            ? [selectedSession.sourceId]
            : []
      ).filter((value): value is string => Boolean(value && value.length > 0))
    );

    const selectedProjects = merged.projects.filter((project) => projectIds.includes(project.id));
    const projectRootPathsBySourceId = buildProjectRootPathsBySourceId(selectedProjects);
    const filteredCacheRecords = cacheRecords
      .map((record) => filterCacheRecord(record, { projectIds, sessionIds, sourceIds }))
      .filter((record): record is NormalizedCacheRecord => record !== null);
    const selectedOutputArtifacts = filteredCacheRecords.flatMap(
      (record) => record.normalized.outputArtifacts
    );
    const cacheSourceIds = unique(filteredCacheRecords.map((record) => record.sourceId));
    const matchingRawArtifacts = selectRawArtifactEntries({
      rawArtifactEntries,
      scope,
      cacheSourceIds,
      outputArtifacts: selectedOutputArtifacts,
      projects: selectedProjects,
      sessions: merged.sessions.filter((session) => sessionIds.includes(session.id))
    });
    const archivedSourceScopes = cacheSourceIds.flatMap((cacheSourceId) =>
      resolveArchivedSourceScope({
        cacheSourceId,
        cacheRecords: filteredCacheRecords.filter((record) => record.sourceId === cacheSourceId),
        projectRootPaths: projectRootPathsBySourceId.get(cacheSourceId) ?? [],
        rawArtifactEntries: matchingRawArtifacts.filter((entry) => entry.sourceId === cacheSourceId),
        sourceRecords
      })
    );
    const availability: ArchiveExportAvailability = {
      scopeKind: scope.kind,
      scopeId: scope.kind === "project" ? scope.projectId : scope.sessionId,
      scopeLabel:
        scope.kind === "project"
          ? selectedProject?.displayName ?? selectedProject?.name ?? "Project Archive"
          : selectedSession?.title ?? selectedSession?.nativeId ?? "Session Archive",
      sessionCount: sessionIds.length,
      sourceCount: archivedSourceScopes.length,
      rawArtifactsAvailable: matchingRawArtifacts.length > 0,
      rawArtifactCount: matchingRawArtifacts.length,
      ...(matchingRawArtifacts.length === 0
        ? {
            rawArtifactsReason:
              "No indexed raw artifacts are available for this archive scope."
          }
        : {})
    };

    return {
      availability,
      cacheRecords: filteredCacheRecords,
      projectIds,
      rawArtifactEntries: matchingRawArtifacts,
      sessionIds,
      sourceDiagnostics: uniqueDiagnostics(archivedSourceScopes.flatMap((source) => source.diagnostics)),
      sources: archivedSourceScopes.map((source) => source.archivedSource)
    };
  }

  async #loadRawArtifacts(
    rawArtifactEntries: RawArtifactIndexEntry[]
  ): Promise<ArchivedRawArtifact[]> {
    const indexedEntries = rawArtifactEntries.filter((entry) => entry.path);
    const safeFilesystem = createSafeFilesystem({
      allowedArtifacts: indexedEntries.flatMap((entry) =>
        entry.path ? [{ artifactId: entry.id, path: entry.path }] : []
      ),
      allowedRootPaths: []
    });

    const archivedArtifacts: ArchivedRawArtifact[] = [];

    for (const entry of indexedEntries) {
      archivedArtifacts.push({
        artifactId: entry.id,
        adapterId: entry.adapterId,
        sourceId: entry.sourceId,
        ...(entry.nativeRef ? { nativeRef: entry.nativeRef } : {}),
        nativeId: entry.nativeId,
        artifactKind: entry.artifactKind,
        artifactType: entry.artifactType,
        ...(entry.mediaType ? { mediaType: entry.mediaType } : {}),
        ...(entry.byteLength !== undefined ? { byteLength: entry.byteLength } : {}),
        ...(entry.mtimeMs !== undefined ? { mtimeMs: entry.mtimeMs } : {}),
        parseStrategy: entry.parseStrategy,
        content: await safeFilesystem.readIndexedTextArtifact(entry.id, entry.path ?? "")
      });
    }

    return archivedArtifacts;
  }
}

function stripLegacyDerivedCacheRecord(record: NormalizedCacheRecord): NormalizedCacheRecord {
  const archiveRecord = { ...record } as NormalizedCacheRecord & { derived?: unknown };
  delete archiveRecord.derived;

  return archiveRecord;
}

function filterCacheRecord(
  record: NormalizedCacheRecord,
  scope: { projectIds: string[]; sessionIds: string[]; sourceIds: string[] }
): NormalizedCacheRecord | null {
  if (!scope.sourceIds.includes(record.sourceId)) {
    return null;
  }

  const normalized = record.normalized;
  const sessions = normalized.sessions.filter((session) => scope.sessionIds.includes(session.id));
  const projects = normalized.projects.filter((project) => scope.projectIds.includes(project.id));
  const selectedEntityIds = new Set<string>([
    ...projects.map((project) => project.id),
    ...sessions.map((session) => session.id)
  ]);
  const events = normalized.events.filter((event) => scope.sessionIds.includes(event.sessionId));
  const messages = normalized.messages.filter((message) =>
    scope.sessionIds.includes(message.sessionId)
  );
  const toolCalls = normalized.toolCalls.filter((toolCall) =>
    scope.sessionIds.includes(toolCall.sessionId)
  );
  const shellCommands = normalized.shellCommands.filter((shellCommand) =>
    scope.sessionIds.includes(shellCommand.sessionId)
  );
  const outputArtifacts = normalized.outputArtifacts.filter(
    (artifact) => artifact.sessionId !== undefined && scope.sessionIds.includes(artifact.sessionId)
  );
  const fileMutations = normalized.fileMutations.filter((mutation) =>
    scope.sessionIds.includes(mutation.sessionId)
  );

  for (const collection of [events, messages, toolCalls, shellCommands, outputArtifacts, fileMutations]) {
    for (const entity of collection) {
      selectedEntityIds.add(entity.id);
    }
  }

  const diagnostics = normalized.diagnostics.filter((diagnostic) => {
    if (diagnostic.relatedEntityIds?.some((entityId) => selectedEntityIds.has(entityId))) {
      return true;
    }

    return (
      scope.sourceIds.includes(diagnostic.sourceId ?? "") &&
      (diagnostic.scope === "adapter" || diagnostic.scope === "source")
    );
  });

  if (
    projects.length === 0 &&
    sessions.length === 0 &&
    diagnostics.length === 0 &&
    outputArtifacts.length === 0
  ) {
    return null;
  }

  const derived = filterDerivedRecord(record.derived, {
    projectIds: scope.projectIds,
    sessionIds: scope.sessionIds
  });

  return {
    ...record,
    normalized: {
      ...normalized,
      projects,
      sessions,
      events,
      messages,
      toolCalls,
      shellCommands,
      outputArtifacts,
      fileMutations,
      diagnostics
    },
    ...(derived ? { derived } : {})
  };
}

function filterDerivedRecord(
  derived: DerivedCacheRecord | undefined,
  scope: { projectIds: string[]; sessionIds: string[] }
): DerivedCacheRecord | undefined {
  if (!derived) {
    return undefined;
  }

  const sessions = derived.sessions.filter((session) => scope.sessionIds.includes(session.sessionId));
  const projects = derived.projects?.filter((project) => scope.projectIds.includes(project.projectId));

  if (sessions.length === 0 && (!projects || projects.length === 0)) {
    return undefined;
  }

  return {
    sessions,
    ...(projects && projects.length > 0 ? { projects } : {})
  };
}

function selectRawArtifactEntries(args: {
  rawArtifactEntries: RawArtifactIndexEntry[];
  scope: ArchiveExportScope;
  cacheSourceIds: string[];
  outputArtifacts: OutputArtifact[];
  projects: Project[];
  sessions: Session[];
}): RawArtifactIndexEntry[] {
  const matches = new Map<string, RawArtifactIndexEntry>();
  const relevantEntries = args.rawArtifactEntries.filter(
    (entry) => entry.path && args.cacheSourceIds.includes(entry.sourceId)
  );

  const scope = args.scope;
  const selectedSession =
    scope.kind === "session"
      ? args.sessions.find((session) => session.id === scope.sessionId)
      : undefined;
  const selectedProject =
    scope.kind === "project"
      ? args.projects[0]
      : args.projects.find((project) => project.id === selectedSession?.projectId);
  const scopedSessions =
    scope.kind === "project" ? args.sessions : selectedSession ? [selectedSession] : [];
  const scopedArtifactRefs = [
    ...(selectedProject?.harnessRefs ?? [])
      .filter(
        (harnessRef) =>
          args.cacheSourceIds.includes(harnessRef.sourceId) &&
          (!selectedSession || harnessRef.sourceId === selectedSession.sourceId)
      )
      .flatMap((harnessRef) => harnessRef.rawArtifactRefs ?? []),
    ...scopedSessions.flatMap((session) => session.rawArtifactRefs ?? [])
  ];

  for (const artifactRef of scopedArtifactRefs) {
    const match = findRawArtifactEntryForRef(artifactRef, relevantEntries);

    if (match) {
      matches.set(match.id, match);
    }
  }

  for (const artifact of args.outputArtifacts) {
    const match =
      relevantEntries.find(
        (entry) => entry.sourceId === artifact.sourceId && entry.nativeId === artifact.nativeId
      ) ??
      relevantEntries.find(
        (entry) => entry.sourceId === artifact.sourceId && artifact.path && entry.nativeId === artifact.path
      ) ??
      relevantEntries.find(
        (entry) =>
          entry.sourceId === artifact.sourceId &&
          artifact.path &&
          entry.path?.endsWith(path.normalize(artifact.path))
      );

    if (match) {
      matches.set(match.id, match);
    }
  }

  return [...matches.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function findRawArtifactEntryForRef(
  artifactRef: AdapterRawArtifactRef,
  rawArtifactEntries: RawArtifactIndexEntry[]
): RawArtifactIndexEntry | undefined {
  return (
    rawArtifactEntries.find((entry) => entry.id === artifactRef.id) ??
    rawArtifactEntries.find(
      (entry) =>
        entry.sourceId === artifactRef.sourceId &&
        normalizeComparableRef(entry.nativeRef ?? entry.nativeId) ===
          normalizeComparableRef(artifactRef.nativeRef ?? artifactRef.nativeId)
    ) ??
    rawArtifactEntries.find(
      (entry) =>
        entry.sourceId === artifactRef.sourceId &&
        normalizeComparablePath(entry.path) === normalizeComparablePath(artifactRef.path)
    )
  );
}

function normalizeComparableRef(value: string | undefined): string | undefined {
  return value ? path.normalize(value) : undefined;
}

function normalizeComparablePath(value: string | undefined): string | undefined {
  return value ? path.resolve(value) : undefined;
}

function shouldIncludeStoreDiagnostic(
  diagnostic: Diagnostic,
  selectedEntityIds: Set<string>,
  sourceId: string
): boolean {
  if (diagnostic.relatedEntityIds?.some((entityId) => selectedEntityIds.has(entityId))) {
    return true;
  }

  return (
    diagnostic.sourceId === sourceId &&
    (diagnostic.scope === "adapter" || diagnostic.scope === "source")
  );
}

function selectRawArtifactMetadata(args: {
  outputArtifacts: OutputArtifact[];
  projects: Project[];
  rawArtifactMetadata: WorkbenchRawArtifactMetadataRecord[];
  sessions: Session[];
}): WorkbenchRawArtifactMetadataRecord[] {
  const matches = new Map<string, WorkbenchRawArtifactMetadataRecord>();
  const sessionById = new Map(args.sessions.map((session) => [session.id, session] as const));

  for (const project of args.projects) {
    for (const harnessRef of project.harnessRefs ?? []) {
      for (const rawArtifactRef of harnessRef.rawArtifactRefs ?? []) {
        const match = findRawArtifactMetadataForRef(rawArtifactRef, args.rawArtifactMetadata);

        if (match) {
          matches.set(match.artifactId, match);
        }
      }
    }
  }

  for (const session of args.sessions) {
    for (const rawArtifactRef of session.rawArtifactRefs ?? []) {
      const match = findRawArtifactMetadataForRef(rawArtifactRef, args.rawArtifactMetadata);

      if (match) {
        matches.set(match.artifactId, match);
      }
    }
  }

  for (const metadata of args.rawArtifactMetadata) {
    if (metadata.sessionId && sessionById.has(metadata.sessionId)) {
      matches.set(metadata.artifactId, metadata);
    }
  }

  for (const artifact of args.outputArtifacts) {
    const match =
      args.rawArtifactMetadata.find((metadata) => metadata.outputArtifactId === artifact.id) ??
      args.rawArtifactMetadata.find(
        (metadata) =>
          metadata.sourceId === artifact.sourceId &&
          metadata.entry?.nativeId === artifact.nativeId
      ) ??
      args.rawArtifactMetadata.find(
        (metadata) =>
          metadata.sourceId === artifact.sourceId &&
          artifact.path &&
          metadata.entry?.nativeId === artifact.path
      ) ??
      args.rawArtifactMetadata.find(
        (metadata) =>
          metadata.sourceId === artifact.sourceId &&
          artifact.path &&
          metadata.entry?.path?.endsWith(path.normalize(artifact.path))
      );

    if (match) {
      matches.set(match.artifactId, match);
    }
  }

  return [...matches.values()].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
}

function findRawArtifactMetadataForRef(
  artifactRef: AdapterRawArtifactRef,
  rawArtifactMetadata: WorkbenchRawArtifactMetadataRecord[]
): WorkbenchRawArtifactMetadataRecord | undefined {
  return (
    rawArtifactMetadata.find((metadata) => metadata.artifactId === artifactRef.id) ??
    rawArtifactMetadata.find(
      (metadata) =>
        metadata.sourceId === artifactRef.sourceId &&
        normalizeComparableRef(metadata.entry?.nativeRef ?? metadata.entry?.nativeId) ===
          normalizeComparableRef(artifactRef.nativeRef ?? artifactRef.nativeId)
    ) ??
    rawArtifactMetadata.find(
      (metadata) =>
        metadata.sourceId === artifactRef.sourceId &&
        normalizeComparablePath(metadata.entry?.path) === normalizeComparablePath(artifactRef.path)
    )
  );
}

function sanitizeArchivedProjectRollup(projectRollup: WorkbenchProjectRollup): WorkbenchProjectRollup {
  return {
    ...projectRollup,
    ...(projectRollup.project ? { project: sanitizeArchivedProject(projectRollup.project) } : {})
  };
}

function sanitizeArchivedSessionRollup(sessionRollup: WorkbenchSessionRollup): WorkbenchSessionRollup {
  return {
    ...sessionRollup,
    ...(sessionRollup.session ? { session: sanitizeArchivedSession(sessionRollup.session) } : {})
  };
}

function sanitizeArchivedRawArtifactMetadataRecord(
  metadata: WorkbenchRawArtifactMetadataRecord
): WorkbenchRawArtifactMetadataRecord {
  const { blob: _blob, ...rest } = metadata;

  return {
    ...rest,
    ...(metadata.entry
      ? {
          entry: (() => {
            const sanitizedEntry = { ...metadata.entry };
            delete sanitizedEntry.path;
            return sanitizedEntry;
          })()
        }
      : {})
  };
}

function isExportableRawArtifactMetadata(
  metadata: WorkbenchRawArtifactMetadataRecord
): metadata is WorkbenchRawArtifactMetadataRecord & { entry: RawArtifactIndexEntry } {
  return metadata.status === "available" && Boolean(metadata.entry?.path);
}

function buildExportableRawArtifactCountByProjectId(
  projectRollups: WorkbenchProjectRollup[],
  rawArtifactMetadata: WorkbenchRawArtifactMetadataRecord[]
): ReadonlyMap<string, number> {
  const exportableRawArtifactIdsBySessionId = new Map<string, string[]>();
  const exportableRawArtifactCountByProjectId = new Map<string, number>();
  const exportableRawArtifactMetadata = rawArtifactMetadata.filter(
    (
      metadata
    ): metadata is WorkbenchRawArtifactMetadataRecord & { entry: RawArtifactIndexEntry } =>
      isExportableRawArtifactMetadata(metadata)
  );

  for (const metadata of exportableRawArtifactMetadata) {
    if (!metadata.sessionId) {
      continue;
    }

    const current = exportableRawArtifactIdsBySessionId.get(metadata.sessionId) ?? [];

    current.push(metadata.artifactId);
    exportableRawArtifactIdsBySessionId.set(metadata.sessionId, current);
  }

  for (const projectRollup of projectRollups) {
    if (!projectRollup.projectId) {
      continue;
    }

    const exportableArtifactIds = new Set<string>();

    for (const sessionId of projectRollup.sessionIds) {
      for (const artifactId of exportableRawArtifactIdsBySessionId.get(sessionId) ?? []) {
        exportableArtifactIds.add(artifactId);
      }
    }

    for (const harnessRef of projectRollup.project?.harnessRefs ?? []) {
      for (const rawArtifactRef of harnessRef.rawArtifactRefs ?? []) {
        const match = findRawArtifactMetadataForRef(rawArtifactRef, exportableRawArtifactMetadata);

        if (match) {
          exportableArtifactIds.add(match.artifactId);
        }
      }
    }

    exportableRawArtifactCountByProjectId.set(
      projectRollup.projectId,
      exportableArtifactIds.size
    );
  }

  return exportableRawArtifactCountByProjectId;
}

async function listAllSessionRecordsForSource(
  entityStore: WorkbenchEntityStore,
  query: WorkbenchCurrentRunScope & { projectId?: string }
): Promise<WorkbenchSessionRecord[]> {
  const sessions: WorkbenchSessionRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await entityStore.listSessionsPage({
      ...query,
      ...(cursor ? { cursor } : {}),
      limit: STORE_EXPORT_PAGE_LIMIT
    });

    sessions.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  } while (cursor);

  return sessions;
}

async function forEachTimelineRecord(
  entityStore: WorkbenchEntityStore,
  scope: WorkbenchCurrentRunScope & { sessionId: string },
  visit: (timelineRecord: WorkbenchTimelineRecord) => void | Promise<void>
): Promise<void> {
  let cursor: string | undefined;

  do {
    const page = await entityStore.getSessionTimelinePage({
      ...scope,
      ...(cursor ? { cursor } : {}),
      limit: STORE_EXPORT_PAGE_LIMIT
    });

    for (const timelineRecord of page.items) {
      await visit(timelineRecord);
    }

    cursor = page.pageInfo.nextCursor;
  } while (cursor);
}

function resolveArchivedSourceScope(args: {
  cacheSourceId: string;
  cacheRecords: NormalizedCacheRecord[];
  projectRootPaths: string[];
  rawArtifactEntries: RawArtifactIndexEntry[];
  sourceRecords: SourceRecord[];
}): ArchivedSourceScope[] {
  const exactSourceRecord = args.sourceRecords.find((source) => source.sourceId === args.cacheSourceId);
  const sourceRecord =
    exactSourceRecord ??
    selectBestSourceRecord({
      ...(args.cacheRecords[0]?.adapterId
        ? { adapterId: args.cacheRecords[0].adapterId }
        : {}),
      projectRootPaths: args.projectRootPaths,
      rawArtifactEntries: args.rawArtifactEntries,
      sourceRecords: args.sourceRecords
    });

  if (!sourceRecord) {
    return [];
  }

  return [
    {
      archivedSource: toArchivedSourceRecord(sourceRecord, args.cacheSourceId),
      diagnostics: sourceRecord.diagnostics.map((diagnostic) =>
        rebaseSourceDiagnostic(diagnostic, args.cacheSourceId)
      )
    }
  ];
}

function selectBestSourceRecord(args: {
  adapterId?: string;
  projectRootPaths: string[];
  rawArtifactEntries: RawArtifactIndexEntry[];
  sourceRecords: SourceRecord[];
}): SourceRecord | undefined {
  const adapterScopedRecords = args.adapterId
    ? args.sourceRecords.filter((source) => source.adapterId === args.adapterId)
    : args.sourceRecords;
  const recordsByProjectRoot = adapterScopedRecords.filter((source) =>
    args.projectRootPaths.some(
      (projectRootPath) =>
        isSamePath(source.rootPath, projectRootPath) ||
        isPathWithinDirectory(source.rootPath, projectRootPath)
    )
  );

  if (recordsByProjectRoot.length > 0) {
    return recordsByProjectRoot.sort((left, right) => left.rootPath.length - right.rootPath.length)[0];
  }

  const recordsByArtifactPath = adapterScopedRecords.filter((source) =>
    args.rawArtifactEntries.some(
      (entry) =>
        entry.path &&
        (isSamePath(source.rootPath, entry.path) || isPathWithinDirectory(source.rootPath, entry.path))
    )
  );

  if (recordsByArtifactPath.length > 0) {
    return recordsByArtifactPath.sort((left, right) => left.rootPath.length - right.rootPath.length)[0];
  }

  return adapterScopedRecords.length === 1 ? adapterScopedRecords[0] : undefined;
}

function buildProjectRootPathsBySourceId(projects: Project[]): Map<string, string[]> {
  const projectRootsBySourceId = new Map<string, Set<string>>();

  for (const project of projects) {
    const rootPath = project.primaryRootPath ?? project.rootPath;

    if (!rootPath || !project.sourceId) {
      continue;
    }

    const rootPaths = projectRootsBySourceId.get(project.sourceId) ?? new Set<string>();

    rootPaths.add(rootPath);
    projectRootsBySourceId.set(project.sourceId, rootPaths);
  }

  return new Map(
    [...projectRootsBySourceId.entries()].map(([sourceId, rootPaths]) => [
      sourceId,
      [...rootPaths].sort((left, right) => left.localeCompare(right))
    ])
  );
}

function toArchivedSourceRecord(
  source: SourceRecord,
  archivedSourceId: string = source.sourceId
): ArchivedSourceRecord {
  const archivedRootPath = buildArchivedSourcePath(archivedSourceId);

  return {
    sourceId: archivedSourceId,
    adapterId: source.adapterId,
    ...(source.displayName ? { displayName: source.displayName } : {}),
    rootPath: archivedRootPath,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    validation: {
      status: source.validation.status,
      ...(source.validation.normalizedPath
        ? { normalizedPath: archivedRootPath }
        : {}),
      ...(source.validation.updatedAt ? { updatedAt: source.validation.updatedAt } : {})
    },
    scan: {
      status: source.scan.status,
      ...(source.scan.artifactCount !== undefined ? { artifactCount: source.scan.artifactCount } : {}),
      ...(source.scan.sessionCount !== undefined ? { sessionCount: source.scan.sessionCount } : {}),
      ...(source.scan.updatedAt ? { updatedAt: source.scan.updatedAt } : {}),
      ...(source.scan.reason ? { reason: source.scan.reason } : {})
    },
    cache: {
      status: source.cache.status,
      ...(source.cache.cacheKey ? { cacheKey: source.cache.cacheKey } : {}),
      ...(source.cache.updatedAt ? { updatedAt: source.cache.updatedAt } : {}),
      ...(source.cache.reason ? { reason: source.cache.reason } : {})
    }
  };
}

function buildArchivedSourcePath(sourceId: string): string {
  return path.posix.join("archived-sources", sourceId);
}

function sanitizeArchivedCacheRecord(record: NormalizedCacheRecord): NormalizedCacheRecord {
  const sanitizedRecord = stripLegacyDerivedCacheRecord(record);

  return {
    ...sanitizedRecord,
    normalized: {
      ...sanitizedRecord.normalized,
      projects: sanitizedRecord.normalized.projects.map(sanitizeArchivedProject),
      sessions: sanitizedRecord.normalized.sessions.map(sanitizeArchivedSession),
      events: sanitizedRecord.normalized.events.map(sanitizeArchivedEvent),
      messages: sanitizedRecord.normalized.messages.map(sanitizeArchivedMessage),
      toolCalls: sanitizedRecord.normalized.toolCalls.map(sanitizeArchivedToolCall),
      shellCommands: sanitizedRecord.normalized.shellCommands.map(sanitizeArchivedShellCommand),
      outputArtifacts: sanitizedRecord.normalized.outputArtifacts.map(sanitizeArchivedOutputArtifact),
      fileMutations: sanitizedRecord.normalized.fileMutations.map(sanitizeArchivedFileMutation)
    },
    ...(sanitizedRecord.rawArtifactIndex
      ? {
          rawArtifactIndex: {
            ...sanitizedRecord.rawArtifactIndex,
            entries: sanitizedRecord.rawArtifactIndex.entries.map((entry) => {
              const sanitizedEntry = { ...entry };
              delete sanitizedEntry.path;
              return sanitizedEntry;
            })
          }
        }
      : {})
  };
}

function sanitizeArchivedProject(project: Project): Project {
  const sanitizedProject = { ...project };

  delete sanitizedProject.primaryRootPath;
  delete sanitizedProject.rootPath;

  if (sanitizedProject.harnessRefs) {
    sanitizedProject.harnessRefs = sanitizedProject.harnessRefs.map((harnessRef) => {
      const sanitizedHarnessRef = {
        ...harnessRef,
        rawArtifactRefs: harnessRef.rawArtifactRefs.map(sanitizeArchivedRawArtifactRef)
      };

      delete sanitizedHarnessRef.nativeProjectPath;
      delete sanitizedHarnessRef.projectRootPath;
      return sanitizedHarnessRef;
    });
  }

  return sanitizedProject;
}

function sanitizeArchivedSession(session: Session): Session {
  return {
    ...session,
    ...(session.rawArtifactRefs
      ? { rawArtifactRefs: session.rawArtifactRefs.map(sanitizeArchivedRawArtifactRef) }
      : {})
  };
}

function sanitizeArchivedEvent(event: SessionEvent): SessionEvent {
  return {
    ...event,
    ...(event.raw ? { raw: sanitizeArchivedPointer(event.raw) } : {})
  };
}

function sanitizeArchivedMessage(message: SessionMessage): SessionMessage {
  return {
    ...message,
    ...(message.source ? { source: sanitizeArchivedPointer(message.source) } : {})
  };
}

function sanitizeArchivedToolCall(toolCall: ToolCall): ToolCall {
  return {
    ...toolCall,
    ...(toolCall.source ? { source: sanitizeArchivedPointer(toolCall.source) } : {})
  };
}

function sanitizeArchivedShellCommand(command: ShellCommandEvidence): ShellCommandEvidence {
  return {
    ...command,
    ...(command.source ? { source: sanitizeArchivedPointer(command.source) } : {})
  };
}

function sanitizeArchivedOutputArtifact(artifact: OutputArtifact): OutputArtifact {
  const sanitizedArtifact = { ...artifact };

  delete sanitizedArtifact.path;

  return {
    ...sanitizedArtifact,
    ...(artifact.source ? { source: sanitizeArchivedPointer(artifact.source) } : {}),
    ...(artifact.ref ? { ref: sanitizeArchivedPointer(artifact.ref) } : {})
  };
}

function sanitizeArchivedFileMutation(mutation: FileMutationEvidence): FileMutationEvidence {
  return {
    ...mutation,
    ...(mutation.source ? { source: sanitizeArchivedPointer(mutation.source) } : {})
  };
}

function sanitizeArchivedRawArtifactRef(artifact: ModelRawArtifactRef): ModelRawArtifactRef {
  const { nativeRef, path: _path, ...rest } = artifact;

  // Preserve a non-local handle so normalized cache records remain schema-valid
  // after path provenance is stripped from exported archives.
  const sanitizedNativeRef =
    nativeRef && !looksLikeFilesystemPath(nativeRef)
      ? nativeRef
      : `archive-ref:${String((artifact as { id?: unknown }).id ?? "unknown")}`;

  return {
    ...rest,
    nativeRef: sanitizedNativeRef
  };
}

function sanitizeArchivedPointer<
  T extends {
    artifactPath?: string | undefined;
    nativeRef?: string | undefined;
    path?: string | undefined;
  }
>(pointer: T): T {
  const {
    artifactPath: _artifactPath,
    nativeRef: _nativeRef,
    path: _path,
    ...rest
  } = pointer;

  return rest as T;
}

function looksLikeFilesystemPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

function rebaseSourceDiagnostic(diagnostic: Diagnostic, sourceId: string): Diagnostic {
  if (!diagnostic.sourceId) {
    return diagnostic;
  }

  return {
    ...diagnostic,
    id: createDiagnosticId({
      adapterId: diagnostic.adapterId,
      sourceId,
      nativeId: diagnostic.code
    }),
    sourceId
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const byId = new Map<string, Diagnostic>();

  for (const diagnostic of diagnostics) {
    byId.set(diagnostic.id, diagnostic);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function writeArchiveV3(input: {
  destinationPath: string;
  entityStore: WorkbenchEntityStore;
  exportableRawArtifacts: Array<WorkbenchRawArtifactMetadataRecord & { entry: RawArtifactIndexEntry }>;
  manifest: ArchiveV3Manifest;
  sourcePlans: StoreSourcePlan[];
}): Promise<void> {
  const stream = createWriteStream(input.destinationPath, { encoding: "utf8" });
  const aggregateTracker = new ArchiveAggregateTracker(input.manifest.aggregateLimits);
  const exportableRawArtifactsById = new Map(
    input.exportableRawArtifacts.map((rawArtifact) => [rawArtifact.artifactId, rawArtifact] as const)
  );
  const safeFilesystem = createSafeFilesystem({
    allowedArtifacts: input.exportableRawArtifacts.map((rawArtifact) => ({
      artifactId: rawArtifact.artifactId,
      path: rawArtifact.entry.path!
    })),
    allowedRootPaths: []
  });
  let sequence = 0;

  try {
    await writeNdjsonLine(stream, {
      kind: "manifest",
      manifest: input.manifest
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts.sources,
      name: "sources",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          await writeV3Entity(stream, aggregateTracker, "sources", sourcePlan.archivedSource.sourceId, sourcePlan.archivedSource);
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts.projects,
      name: "projects",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const project of sourcePlan.projects) {
            await writeV3Entity(stream, aggregateTracker, "projects", project.id, project);
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts.sessions,
      name: "sessions",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const session of sourcePlan.sessions) {
            await writeV3Entity(stream, aggregateTracker, "sessions", session.id, session);
          }
        }
      }
    });

    sequence = await writeTimelineSection({
      count: input.manifest.sectionEntityCounts["timeline-events"],
      input,
      name: "timeline-events",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeRecord: async (streamScope, timelineRecord) => {
        await writeV3Entity(
          streamScope.stream,
          streamScope.tracker,
          "timeline-events",
          timelineRecord.event.id,
          sanitizeArchivedEvent(timelineRecord.event)
        );
      }
    });

    sequence = await writeTimelineSection({
      count: input.manifest.sectionEntityCounts.messages,
      input,
      name: "messages",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeRecord: async (streamScope, timelineRecord) => {
        if (timelineRecord.message) {
          await writeV3Entity(
            streamScope.stream,
            streamScope.tracker,
            "messages",
            timelineRecord.message.id,
            sanitizeArchivedMessage(timelineRecord.message)
          );
        }
      }
    });

    sequence = await writeTimelineSection({
      count: input.manifest.sectionEntityCounts["tool-calls"],
      input,
      name: "tool-calls",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeRecord: async (streamScope, timelineRecord) => {
        if (timelineRecord.toolCall) {
          await writeV3Entity(
            streamScope.stream,
            streamScope.tracker,
            "tool-calls",
            timelineRecord.toolCall.id,
            sanitizeArchivedToolCall(timelineRecord.toolCall)
          );
        }
      }
    });

    sequence = await writeTimelineSection({
      count: input.manifest.sectionEntityCounts["shell-commands"],
      input,
      name: "shell-commands",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeRecord: async (streamScope, timelineRecord) => {
        if (timelineRecord.shellCommand) {
          await writeV3Entity(
            streamScope.stream,
            streamScope.tracker,
            "shell-commands",
            timelineRecord.shellCommand.id,
            sanitizeArchivedShellCommand(timelineRecord.shellCommand)
          );
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["output-artifacts"],
      name: "output-artifacts",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const outputArtifact of sourcePlan.outputArtifacts) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "output-artifacts",
              outputArtifact.id,
              outputArtifact
            );
          }
        }
      }
    });

    sequence = await writeTimelineSection({
      count: input.manifest.sectionEntityCounts["file-mutations"],
      input,
      name: "file-mutations",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeRecord: async (streamScope, timelineRecord) => {
        if (timelineRecord.fileMutation) {
          await writeV3Entity(
            streamScope.stream,
            streamScope.tracker,
            "file-mutations",
            timelineRecord.fileMutation.id,
            sanitizeArchivedFileMutation(timelineRecord.fileMutation)
          );
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts.diagnostics,
      name: "diagnostics",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const diagnostic of sourcePlan.storeDiagnostics) {
            await writeV3Entity(stream, aggregateTracker, "diagnostics", diagnostic.id, diagnostic);
          }

          for (const diagnostic of sourcePlan.sourceDiagnostics) {
            aggregateTracker.recordSourceDiagnostic();
            await writeV3Entity(stream, aggregateTracker, "diagnostics", diagnostic.id, diagnostic);
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["verification-snapshots"],
      name: "verification-snapshots",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const snapshot of sourcePlan.verificationSnapshots) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "verification-snapshots",
              snapshot.sessionId,
              snapshot
            );
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["run-audit-snapshots"],
      name: "run-audit-snapshots",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const snapshot of sourcePlan.runAuditSnapshots) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "run-audit-snapshots",
              snapshot.sessionId,
              snapshot
            );
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["git-snapshots"],
      name: "git-snapshots",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const projectRollup of sourcePlan.projectRollups) {
            if (projectRollup.git) {
              await writeV3Entity(stream, aggregateTracker, "git-snapshots", projectRollup.projectId ?? projectRollup.project?.id ?? sourcePlan.sourceId, {
                projectId: projectRollup.projectId ?? projectRollup.project?.id ?? sourcePlan.sourceId,
                git: projectRollup.git
              } satisfies StoredProjectGitSnapshot);
            }
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["github-snapshots"],
      name: "github-snapshots",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const projectRollup of sourcePlan.projectRollups) {
            if (projectRollup.github) {
              await writeV3Entity(stream, aggregateTracker, "github-snapshots", projectRollup.projectId ?? projectRollup.project?.id ?? sourcePlan.sourceId, {
                projectId: projectRollup.projectId ?? projectRollup.project?.id ?? sourcePlan.sourceId,
                github: projectRollup.github
              } satisfies StoredProjectGitHubSnapshot);
            }
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["overview-rollups"],
      name: "overview-rollups",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          if (sourcePlan.overviewRollup) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "overview-rollups",
              sourcePlan.sourceId,
              sourcePlan.overviewRollup
            );
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["project-rollups"],
      name: "project-rollups",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const projectRollup of sourcePlan.projectRollups) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "project-rollups",
              projectRollup.projectId ?? projectRollup.project?.id ?? sourcePlan.sourceId,
              projectRollup
            );
          }
        }
      }
    });

    sequence = await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["session-rollups"],
      name: "session-rollups",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const sessionRollup of sourcePlan.sessionRollups) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "session-rollups",
              sessionRollup.sessionId,
              sessionRollup
            );
          }
        }
      }
    });

    await writeV3EntitySection({
      count: input.manifest.sectionEntityCounts["raw-artifact-entries"],
      name: "raw-artifact-entries",
      sequence,
      stream,
      tracker: aggregateTracker,
      writeEntities: async () => {
        for (const sourcePlan of input.sourcePlans) {
          for (const rawArtifactMetadata of sourcePlan.rawArtifactMetadata) {
            await writeV3Entity(
              stream,
              aggregateTracker,
              "raw-artifact-entries",
              rawArtifactMetadata.artifactId,
              sanitizeArchivedRawArtifactMetadataRecord(rawArtifactMetadata)
            );

            const exportableRawArtifact = exportableRawArtifactsById.get(rawArtifactMetadata.artifactId);

            if (!exportableRawArtifact) {
              continue;
            }

            let chunkIndex = 0;

            for await (const chunkContent of safeFilesystem.readIndexedTextArtifactChunks(
              exportableRawArtifact.artifactId,
              exportableRawArtifact.entry.path!,
              {
                chunkBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes
              }
            )) {
              aggregateTracker.recordRawArtifactChunk({
                artifactId: exportableRawArtifact.artifactId,
                content: chunkContent
              });
              await writeNdjsonLine(stream, {
                kind: "raw-artifact-chunk",
                manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
                chunk: {
                  artifactId: exportableRawArtifact.artifactId,
                  chunkIndex,
                  content: chunkContent
                }
              });
              chunkIndex += 1;
            }
          }
        }
      }
    });

    const aggregateSnapshot = aggregateTracker.snapshot();

    for (const sectionName of ARCHIVE_V3_ENTITY_SECTION_NAMES) {
      if (aggregateSnapshot.sectionEntityCounts[sectionName] !== input.manifest.sectionEntityCounts[sectionName]) {
        throw new Error(`Archive v3 ${sectionName} count drifted during export.`);
      }
    }

    if (aggregateSnapshot.totalEntityCount !== input.manifest.counts.totalEntities) {
      throw new Error("Archive v3 total entity count drifted during export.");
    }

    if (aggregateSnapshot.sourceDiagnosticCount !== input.manifest.counts.sourceDiagnostics) {
      throw new Error("Archive v3 source diagnostic count drifted during export.");
    }
  } finally {
    stream.end();
    await once(stream, "finish");
  }
}

async function writeTimelineSection(input: {
  count: number;
  input: {
    entityStore: WorkbenchEntityStore;
    sourcePlans: StoreSourcePlan[];
  };
  name: ArchiveV3EntitySectionName;
  sequence: number;
  stream: NodeJS.WritableStream;
  tracker: ArchiveAggregateTracker;
  writeRecord: (scope: {
    stream: NodeJS.WritableStream;
    tracker: ArchiveAggregateTracker;
  }, timelineRecord: WorkbenchTimelineRecord) => Promise<void>;
}): Promise<number> {
  const streamScope = {
    stream: input.stream,
    tracker: input.tracker
  };

  return writeV3EntitySection({
    count: input.count,
    name: input.name,
    sequence: input.sequence,
    stream: input.stream,
    tracker: input.tracker,
    writeEntities: async () => {
      for (const sourcePlan of input.input.sourcePlans) {
        for (const session of sourcePlan.sessions) {
          await forEachTimelineRecord(
            input.input.entityStore,
            {
              sourceId: sourcePlan.sourceId,
              sessionId: session.id
            },
            async (timelineRecord) => {
              await input.writeRecord(streamScope, timelineRecord);
            }
          );
        }
      }
    }
  });
}

async function writeV3EntitySection(input: {
  count: number;
  name: ArchiveV3EntitySectionName;
  sequence: number;
  stream: NodeJS.WritableStream;
  tracker: ArchiveAggregateTracker;
  writeEntities: () => Promise<void>;
}): Promise<number> {
  if (input.count === 0) {
    return input.sequence;
  }

  await writeNdjsonLine(input.stream, {
    kind: "entity-section",
    manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
    section: {
      name: input.name,
      sequence: input.sequence,
      entityCount: input.count
    }
  });
  await input.writeEntities();
  return input.sequence + 1;
}

async function writeV3Entity(
  stream: NodeJS.WritableStream,
  tracker: ArchiveAggregateTracker,
  section: ArchiveV3EntitySectionName,
  entityId: string,
  payload: unknown
): Promise<void> {
  tracker.recordEntity(section);
  await writeNdjsonLine(stream, {
    kind: "entity",
    manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
    section,
    entityId,
    payload
  });
}

async function writeArchiveV2(input: {
  cacheRecords: NormalizedCacheRecord[];
  destinationPath: string;
  manifest: ArchiveManifest;
  rawArtifacts: ArchivedRawArtifact[];
  sourceDiagnostics: Diagnostic[];
  sources: ArchivedSourceRecord[];
}): Promise<void> {
  const stream = createWriteStream(input.destinationPath, { encoding: "utf8" });

  try {
    await writeNdjsonLine(stream, {
      kind: "manifest",
      manifest: input.manifest
    });

    for (const source of input.sources) {
      await writeNdjsonLine(stream, {
        kind: "source",
        source
      });
    }

    for (const record of input.cacheRecords) {
      await writeNdjsonLine(stream, {
        kind: "cache-record",
        record
      });
    }

    for (const diagnostic of input.sourceDiagnostics) {
      await writeNdjsonLine(stream, {
        kind: "source-diagnostic",
        diagnostic
      });
    }

    for (const artifact of input.rawArtifacts) {
      const { content, ...metadata } = artifact;

      await writeNdjsonLine(stream, {
        kind: "raw-artifact",
        artifact: metadata
      });

      for (
        let offset = 0, chunkIndex = 0;
        offset < content.length;
        offset += DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes, chunkIndex += 1
      ) {
        await writeNdjsonLine(stream, {
          kind: "raw-artifact-chunk",
          chunk: {
            artifactId: artifact.artifactId,
            chunkIndex,
            content: content.slice(
              offset,
              offset + DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes
            )
          }
        });
      }
    }
  } finally {
    stream.end();
    await once(stream, "finish");
  }
}

async function writeNdjsonLine(
  stream: NodeJS.WritableStream,
  value: unknown
): Promise<void> {
  if (!stream.write(`${JSON.stringify(value)}\n`, "utf8")) {
    await once(stream, "drain");
  }
}
