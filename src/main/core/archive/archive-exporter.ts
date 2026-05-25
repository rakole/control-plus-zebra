import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdapterNormalizationResult,
  RawArtifactRef
} from "../adapter-contract/types.js";
import type {
  DerivedCacheRecord,
  FileBackedCacheStore,
  NormalizedCacheRecord
} from "../cache/file-backed-cache-store.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { mergeNormalizedResults } from "../ingestion/index.js";
import type { RawArtifactIndex, RawArtifactIndexEntry } from "../ingestion/raw-artifact-index.js";
import type { OutputArtifact, Project, Session } from "../model/entities.js";
import { createDiagnosticId } from "../model/identifiers.js";
import type { SourceRecord, SourceRegistry } from "../registry/source-registry.js";
import {
  createSafeFilesystem,
  isPathWithinDirectory,
  isSamePath
} from "../security/index.js";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_MANIFEST_VERSION,
  archiveDocumentSchema,
  type ArchiveDocument,
  type ArchiveManifest,
  type ArchivedRawArtifact,
  type ArchivedSourceRecord
} from "./archive-manifest.js";

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
  manifest: ArchiveManifest;
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

export class ArchiveExporter {
  readonly #cacheStore: FileBackedCacheStore;
  readonly #now: () => Date;
  readonly #rawArtifactIndex: RawArtifactIndex;
  readonly #sourceRegistry: SourceRegistry;

  constructor(options: ArchiveExporterOptions) {
    this.#cacheStore = options.cacheStore;
    this.#now = options.now ?? (() => new Date());
    this.#rawArtifactIndex = options.rawArtifactIndex;
    this.#sourceRegistry = options.sourceRegistry;
  }

  async getScopeAvailability(
    scope: ArchiveExportScope
  ): Promise<ArchiveExportAvailability> {
    return (await this.#resolveScope(scope)).availability;
  }

  async getScopeAvailabilities(
    scopes: ArchiveExportScope[]
  ): Promise<ArchiveExportAvailability[]> {
    if (scopes.length === 0) {
      return [];
    }

    const context = await this.#loadScopeResolutionContext();

    return scopes.map((scope) => this.#resolveScopeWithContext(scope, context).availability);
  }

  async createArchive(input: CreateArchiveInput): Promise<CreateArchiveResult> {
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
      ? await this.#loadRawArtifacts(resolution.rawArtifactEntries, resolution.sources)
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
    const archiveCacheRecords = resolution.cacheRecords.map(stripLegacyDerivedCacheRecord);
    const archiveDocument: ArchiveDocument = archiveDocumentSchema.parse({
      manifest,
      payload: {
        sources: resolution.sources,
        cacheRecords: archiveCacheRecords,
        sourceDiagnostics: resolution.sourceDiagnostics,
        ...(rawArtifacts.length > 0 ? { rawArtifacts } : {})
      }
    });

    await mkdir(path.dirname(input.destinationPath), { recursive: true });
    await writeFile(
      input.destinationPath,
      `${JSON.stringify(archiveDocument, null, 2)}\n`,
      "utf8"
    );

    return {
      archivePath: input.destinationPath,
      manifest,
      rawArtifactCount: rawArtifacts.length
    };
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
    rawArtifactEntries: RawArtifactIndexEntry[],
    archivedSources: ArchivedSourceRecord[]
  ): Promise<ArchivedRawArtifact[]> {
    const indexedEntries = rawArtifactEntries.filter((entry) => entry.path);
    const safeFilesystem = createSafeFilesystem({
      allowedArtifacts: indexedEntries.flatMap((entry) =>
        entry.path ? [{ artifactId: entry.id, path: entry.path }] : []
      ),
      allowedRootPaths: archivedSources.map((source) => source.rootPath)
    });

    return Promise.all(
      indexedEntries.map(async (entry) => ({
        artifactId: entry.id,
        adapterId: entry.adapterId,
        sourceId: entry.sourceId,
        ...(entry.nativeRef ? { nativeRef: entry.nativeRef } : {}),
        nativeId: entry.nativeId,
        artifactKind: entry.artifactKind,
        artifactType: entry.artifactType,
        ...(entry.mediaType ? { mediaType: entry.mediaType } : {}),
        ...(entry.path ? { originalPath: entry.path } : {}),
        ...(entry.byteLength !== undefined ? { byteLength: entry.byteLength } : {}),
        ...(entry.mtimeMs !== undefined ? { mtimeMs: entry.mtimeMs } : {}),
        parseStrategy: entry.parseStrategy,
        content: await safeFilesystem.readIndexedTextArtifact(entry.id, entry.path ?? "")
      }))
    );
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
  artifactRef: RawArtifactRef,
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
  return {
    sourceId: archivedSourceId,
    adapterId: source.adapterId,
    ...(source.displayName ? { displayName: source.displayName } : {}),
    rootPath: source.rootPath,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    validation: {
      status: source.validation.status,
      ...(source.validation.normalizedPath
        ? { normalizedPath: source.validation.normalizedPath }
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
