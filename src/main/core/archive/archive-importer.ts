import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import type { AdapterNormalizationResult } from "../adapter-contract/types.js";
import type {
  FileBackedCacheStore,
  NormalizedCacheRecord
} from "../cache/file-backed-cache-store.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import {
  assertBoundedLine,
  BoundedIngestionError,
  DEFAULT_BOUNDED_INGESTION_LIMITS
} from "../ingestion/bounded-ingestion.js";
import { mergeNormalizedResults } from "../ingestion/index.js";
import type {
  RawArtifactIndex,
  RawArtifactIndexEntry
} from "../ingestion/raw-artifact-index.js";
import {
  createDiagnosticId,
  createFileMutationEvidenceId,
  createOutputArtifactId,
  createProjectId,
  createRawArtifactId,
  createSessionEventId,
  createSessionId,
  createSessionMessageId,
  createShellCommandEvidenceId,
  createSourceId,
  createToolCallId
} from "../model/identifiers.js";
import type { RawEventPointer } from "../model/identifiers.js";
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
import type {
  ImportedArchiveMetadata,
  SourceRecord,
  SourceRegistry
} from "../registry/source-registry.js";
import type { RunAuditResult } from "../audit/types.js";
import type { VerificationResult } from "../verification/types.js";
import type { ParsedShellCommand } from "../shell/types.js";
import type { EntityWriter } from "../store/entity-writer.js";
import type {
  StoredProjectGitHubSnapshot,
  StoredProjectGitSnapshot,
  StoredSessionRunAuditSnapshot,
  StoredSessionVerificationSnapshot,
  WorkbenchEntityStore,
  WorkbenchOverviewRollup,
  WorkbenchProjectRollup,
  WorkbenchRawArtifactMetadataRecord,
  WorkbenchSessionRollup
} from "../store/workbench-entity-store.js";
import {
  ARCHIVE_V3_MANIFEST_VERSION,
  ArchiveAggregateLimitError,
  ArchiveAggregateTracker,
  archiveVersionedLineSchema,
  archiveLineSchema,
  type ArchiveV3EntitySectionName,
  type ArchiveV3Manifest,
  type ArchiveManifest,
  type ArchivedRawArtifact,
  type ArchivedRawArtifactMetadata,
  type ArchiveV3EntitySection,
  type ArchivedSourceRecord,
  type VersionedArchiveManifest
} from "./archive-manifest.js";

export interface ImportArchiveInput {
  archivePath: string;
  displayName?: string;
}

export interface ImportArchiveResult {
  archivePath: string;
  manifest: VersionedArchiveManifest;
  sourceId: string;
  sourceIds: string[];
  sourceRecord: SourceRecord;
  sourceRecords: SourceRecord[];
}

export class ArchiveImportError extends Error {
  readonly code:
    | "archive-import.empty-payload"
    | "archive-import.invalid-archive"
    | "archive-import.line-too-large"
    | "archive-import.raw-chunk-too-large";

  constructor(code: ArchiveImportError["code"], message: string) {
    super(message);
    this.name = "ArchiveImportError";
    this.code = code;
  }
}

const V3_REPLAY_SECTION_ORDER: ArchiveV3EntitySectionName[] = [
  "projects",
  "sessions",
  "timeline-events",
  "messages",
  "tool-calls",
  "shell-commands",
  "output-artifacts",
  "file-mutations",
  "diagnostics",
  "verification-snapshots",
  "run-audit-snapshots",
  "git-snapshots",
  "github-snapshots",
  "overview-rollups",
  "project-rollups",
  "session-rollups",
  "raw-artifact-entries"
];

function createV3ArchiveImportState(): V3ArchiveImportState {
  return {
    idMaps: {
      diagnosticIds: new Map<string, string>(),
      eventIds: new Map<string, string>(),
      fileMutationIds: new Map<string, string>(),
      messageIds: new Map<string, string>(),
      outputArtifactIds: new Map<string, string>(),
      projectIds: new Map<string, string>(),
      rawArtifactIds: new Map<string, string>(),
      relatedEntityIds: new Map<string, string>(),
      sessionIds: new Map<string, string>(),
      shellCommandIds: new Map<string, string>(),
      toolCallIds: new Map<string, string>()
    },
    ownerByArchivedDiagnosticId: new Map<string, string>(),
    ownerByArchivedEventId: new Map<string, string>(),
    ownerByArchivedFileMutationId: new Map<string, string>(),
    ownerByArchivedMessageId: new Map<string, string>(),
    ownerByArchivedOutputArtifactId: new Map<string, string>(),
    ownerByArchivedProjectId: new Map<string, string>(),
    ownerByArchivedRawArtifactId: new Map<string, string>(),
    ownerByArchivedSessionId: new Map<string, string>(),
    ownerByArchivedShellCommandId: new Map<string, string>(),
    ownerByArchivedToolCallId: new Map<string, string>(),
    sectionCounts: new Map<ArchiveV3EntitySectionName, number>()
  };
}

async function appendV3StageLine(
  stageDir: string,
  sourcePlan: V3SourcePlan,
  sectionName: ArchiveV3EntitySectionName,
  payload: unknown
): Promise<void> {
  const stageFilePath =
    sourcePlan.sectionFiles[sectionName] ??
    path.join(
      stageDir,
      "sections",
      sanitizePathSegment(sourcePlan.importedSourceId) || "source",
      `${sectionName}.ndjson`
    );

  sourcePlan.sectionFiles[sectionName] = stageFilePath;
  await mkdir(path.dirname(stageFilePath), { recursive: true });
  await appendFile(stageFilePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function resolveV3SourcePlanForEntity(args: {
  payload: unknown;
  section: ArchiveV3EntitySectionName;
  sourcePlans: Map<string, V3SourcePlan>;
  state: V3ArchiveImportState;
}): V3SourcePlan | undefined {
  const payload = args.payload as Record<string, unknown>;
  const directSourceId =
    typeof payload.sourceId === "string" ? payload.sourceId : undefined;

  if (directSourceId) {
    return args.sourcePlans.get(directSourceId);
  }

  if (args.section === "diagnostics") {
    const relatedEntityIds = Array.isArray(payload.relatedEntityIds)
      ? payload.relatedEntityIds.filter((value): value is string => typeof value === "string")
      : [];

    for (const relatedEntityId of relatedEntityIds) {
      for (const ownerMap of [
        args.state.ownerByArchivedProjectId,
        args.state.ownerByArchivedSessionId,
        args.state.ownerByArchivedEventId,
        args.state.ownerByArchivedMessageId,
        args.state.ownerByArchivedToolCallId,
        args.state.ownerByArchivedShellCommandId,
        args.state.ownerByArchivedOutputArtifactId,
        args.state.ownerByArchivedFileMutationId,
        args.state.ownerByArchivedRawArtifactId
      ]) {
        const ownerSourceId = ownerMap.get(relatedEntityId);

        if (ownerSourceId) {
          return args.sourcePlans.get(ownerSourceId);
        }
      }
    }

    if (typeof payload.adapterId === "string") {
      const matchingSources = [...args.sourcePlans.values()].filter(
        (sourcePlan) => sourcePlan.archivedSource.adapterId === payload.adapterId
      );

      if (matchingSources.length === 1) {
        return matchingSources[0];
      }
    }
  }

  const ownerMap = ownerMapForSection(args.state, args.section);
  const lookupId = lookupOwnerIdForSection(args.section, payload);

  return lookupId ? args.sourcePlans.get(ownerMap.get(lookupId) ?? "") : undefined;
}

function ownerMapForSection(
  state: V3ArchiveImportState,
  section: ArchiveV3EntitySectionName
): Map<string, string> {
  switch (section) {
    case "projects":
    case "git-snapshots":
    case "github-snapshots":
    case "project-rollups":
      return state.ownerByArchivedProjectId;
    case "sessions":
    case "verification-snapshots":
    case "run-audit-snapshots":
    case "session-rollups":
      return state.ownerByArchivedSessionId;
    case "timeline-events":
      return state.ownerByArchivedEventId;
    case "messages":
      return state.ownerByArchivedMessageId;
    case "tool-calls":
      return state.ownerByArchivedToolCallId;
    case "shell-commands":
      return state.ownerByArchivedShellCommandId;
    case "output-artifacts":
      return state.ownerByArchivedOutputArtifactId;
    case "file-mutations":
      return state.ownerByArchivedFileMutationId;
    case "raw-artifact-entries":
      return state.ownerByArchivedRawArtifactId;
    case "diagnostics":
      return state.ownerByArchivedDiagnosticId;
    default:
      return new Map<string, string>();
  }
}

function lookupOwnerIdForSection(
  section: ArchiveV3EntitySectionName,
  payload: Record<string, unknown>
): string | undefined {
  switch (section) {
    case "projects":
      return typeof payload.id === "string" ? payload.id : undefined;
    case "sessions":
    case "verification-snapshots":
    case "run-audit-snapshots":
    case "session-rollups":
      return typeof payload.sessionId === "string"
        ? payload.sessionId
        : isRecord(payload.session) && typeof payload.session.id === "string"
          ? payload.session.id
        : typeof payload.id === "string"
          ? payload.id
          : undefined;
    case "timeline-events":
    case "messages":
    case "tool-calls":
    case "shell-commands":
    case "output-artifacts":
    case "file-mutations":
      return typeof payload.id === "string" ? payload.id : undefined;
    case "git-snapshots":
    case "github-snapshots":
    case "project-rollups":
      return typeof payload.projectId === "string"
        ? payload.projectId
        : isRecord(payload.project) && typeof payload.project.id === "string"
          ? payload.project.id
          : undefined;
    case "raw-artifact-entries":
      return typeof payload.artifactId === "string" ? payload.artifactId : undefined;
    case "diagnostics":
      return typeof payload.id === "string" ? payload.id : undefined;
    default:
      return undefined;
  }
}

function registerV3EntityIds(args: {
  payload: unknown;
  section: ArchiveV3EntitySectionName;
  sourcePlan: V3SourcePlan;
  state: V3ArchiveImportState;
}): void {
  const payload = args.payload as Record<string, unknown>;
  const ownerId = lookupOwnerIdForSection(args.section, payload);

  if (!ownerId) {
    return;
  }

  switch (args.section) {
    case "projects":
      registerOwnedImportedId(
        args.state.ownerByArchivedProjectId,
        args.state.idMaps.projectIds,
        ownerId,
        buildImportedProjectId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "sessions":
      registerOwnedImportedId(
        args.state.ownerByArchivedSessionId,
        args.state.idMaps.sessionIds,
        ownerId,
        buildImportedSessionId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "timeline-events":
      registerOwnedImportedId(
        args.state.ownerByArchivedEventId,
        args.state.idMaps.eventIds,
        ownerId,
        buildImportedEventId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "messages":
      registerOwnedImportedId(
        args.state.ownerByArchivedMessageId,
        args.state.idMaps.messageIds,
        ownerId,
        buildImportedMessageId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "tool-calls":
      registerOwnedImportedId(
        args.state.ownerByArchivedToolCallId,
        args.state.idMaps.toolCallIds,
        ownerId,
        buildImportedToolCallId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "shell-commands":
      registerOwnedImportedId(
        args.state.ownerByArchivedShellCommandId,
        args.state.idMaps.shellCommandIds,
        ownerId,
        buildImportedShellCommandId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "output-artifacts":
      registerOwnedImportedId(
        args.state.ownerByArchivedOutputArtifactId,
        args.state.idMaps.outputArtifactIds,
        ownerId,
        buildImportedOutputArtifactId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "file-mutations":
      registerOwnedImportedId(
        args.state.ownerByArchivedFileMutationId,
        args.state.idMaps.fileMutationIds,
        ownerId,
        buildImportedFileMutationId(payload, args.sourcePlan),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "raw-artifact-entries":
      registerOwnedImportedId(
        args.state.ownerByArchivedRawArtifactId,
        args.state.idMaps.rawArtifactIds,
        ownerId,
        buildImportedRawArtifactMetadataId(
          payload as unknown as WorkbenchRawArtifactMetadataRecord,
          args.sourcePlan
        ),
        args.sourcePlan,
        args.state.idMaps.relatedEntityIds
      );
      break;
    case "diagnostics":
      registerOwnedImportedId(
        args.state.ownerByArchivedDiagnosticId,
        args.state.idMaps.diagnosticIds,
        ownerId,
        buildImportedDiagnosticId(payload, args.sourcePlan),
        args.sourcePlan
      );
      break;
  }
}

function registerOwnedImportedId(
  ownerMap: Map<string, string>,
  idMap: Map<string, string>,
  archivedId: string,
  importedId: string,
  sourcePlan: V3SourcePlan,
  relatedEntityIds?: Map<string, string>
): void {
  ownerMap.set(archivedId, sourcePlan.archivedSource.sourceId);
  idMap.set(archivedId, importedId);
  relatedEntityIds?.set(archivedId, importedId);
}

function buildImportedProjectId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createProjectId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedSessionId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createSessionId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedEventId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createSessionEventId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedMessageId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createSessionMessageId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedToolCallId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createToolCallId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedShellCommandId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createShellCommandEvidenceId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedOutputArtifactId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createOutputArtifactId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedFileMutationId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createFileMutationEvidenceId({
    adapterId: readAdapterId(payload, sourcePlan),
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedNativeId(payload as { id: string; nativeId?: string; sourceId?: string })
  });
}

function buildImportedRawArtifactMetadataId(
  metadata: WorkbenchRawArtifactMetadataRecord,
  sourcePlan: V3SourcePlan
): string {
  const entry = metadata.entry;

  return createRawArtifactId({
    adapterId: entry?.adapterId ?? sourcePlan.archivedSource.adapterId,
    sourceId: sourcePlan.importedSourceId,
    nativeId: buildImportedArtifactNativeId({
      id: metadata.artifactId,
      nativeId: entry?.nativeId,
      nativeRef: entry?.nativeRef,
      path: entry?.path,
      sourceId:
        typeof metadata.sourceId === "string" ? metadata.sourceId : sourcePlan.archivedSource.sourceId
    })
  });
}

function buildImportedDiagnosticId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return createDiagnosticId({
    adapterId:
      typeof payload.adapterId === "string"
        ? payload.adapterId
        : sourcePlan.archivedSource.adapterId,
    sourceId: sourcePlan.importedSourceId,
    nativeId: String(payload.id)
  });
}

function readAdapterId(
  payload: Record<string, unknown>,
  sourcePlan: V3SourcePlan
): string {
  return typeof payload.adapterId === "string"
    ? payload.adapterId
    : sourcePlan.archivedSource.adapterId;
}

function buildImportedArchiveMaterializedRoot(
  appDataDir: string,
  archivePath: string,
  importedSourceId: string,
  importedAt: string
): string {
  return path.join(
    appDataDir,
    "imports",
    "archives",
    buildHash(`${archivePath}|${importedSourceId}|${importedAt}`)
  );
}

function shouldCleanupImportedArchiveMaterializedRoot(args: {
  appDataDir: string | undefined;
  nextRootPath: string;
  previousRootPath: string | undefined;
}): boolean {
  if (!args.appDataDir || !args.previousRootPath) {
    return false;
  }

  const managedImportsRoot = path.resolve(args.appDataDir, "imports", "archives");
  const previousRootPath = path.resolve(args.previousRootPath);
  const nextRootPath = path.resolve(args.nextRootPath);
  const relativePath = path.relative(managedImportsRoot, previousRootPath);

  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath) &&
    previousRootPath !== nextRootPath
  );
}

function buildArchiveIngestRunId(importedSourceId: string, importedAt: string): string {
  return `archive-import-${buildHash(`${importedSourceId}|${importedAt}`)}`;
}

function buildV3StagedMaterializedArtifactPath(args: {
  metadata: WorkbenchRawArtifactMetadataRecord;
  rebasedArtifactId: string;
  sourcePlan: V3SourcePlan;
  stageDir: string;
}): string {
  const sourceRootPath = path.join(
    args.stageDir,
    "materialized",
    buildHash(args.sourcePlan.importedSourceId)
  );
  const archivedArtifact = toArchivedRawArtifactMetadata(args.metadata);

  return buildMaterializedArtifactPath(
    sourceRootPath,
    archivedArtifact,
    args.rebasedArtifactId
  );
}

function toArchivedRawArtifactMetadata(
  metadata: WorkbenchRawArtifactMetadataRecord
): ArchivedRawArtifactMetadata {
  const entry = metadata.entry;

  return {
    artifactId: metadata.artifactId,
    adapterId: entry?.adapterId ?? "unknown-adapter",
    sourceId: metadata.sourceId,
    ...(entry?.nativeRef ? { nativeRef: entry.nativeRef } : {}),
    nativeId: entry?.nativeId ?? metadata.artifactId,
    artifactKind: entry?.artifactKind ?? "unknown",
    artifactType: entry?.artifactType ?? "text/plain",
    ...(entry?.mediaType ? { mediaType: entry.mediaType } : {}),
    ...(entry?.path ? { originalPath: entry.path } : {}),
    ...(entry?.byteLength !== undefined ? { byteLength: entry.byteLength } : {}),
    ...(entry?.mtimeMs !== undefined ? { mtimeMs: entry.mtimeMs } : {}),
    parseStrategy: entry?.parseStrategy ?? "unknown"
  };
}

function validateV3SectionCounts(
  manifest: ArchiveV3Manifest,
  sectionCounts: Map<ArchiveV3EntitySectionName, number>
): void {
  for (const [sectionName, expectedCount] of Object.entries(manifest.sectionEntityCounts)) {
    const actualCount =
      sectionCounts.get(sectionName as ArchiveV3EntitySectionName) ?? 0;

    if (actualCount !== expectedCount) {
      throw new ArchiveImportError(
        "archive-import.invalid-archive",
        `Archive v3 ${sectionName} section count drifted during import.`
      );
    }
  }
}

function validateV3AggregateSnapshot(args: {
  manifest: ArchiveV3Manifest;
  sectionLineCount: number;
  tracker: ArchiveAggregateTracker;
}): void {
  const expectedSectionLineCount = Object.values(args.manifest.sectionEntityCounts).filter(
    (count) => count > 0
  ).length;

  if (args.sectionLineCount !== expectedSectionLineCount) {
    throw new ArchiveImportError(
      "archive-import.invalid-archive",
      `Archive v3 declared ${args.sectionLineCount} entity sections; expected ${expectedSectionLineCount}.`
    );
  }

  const aggregateSnapshot = args.tracker.snapshot();

  if (aggregateSnapshot.totalEntityCount !== args.manifest.counts.totalEntities) {
    throw new ArchiveImportError(
      "archive-import.invalid-archive",
      "Archive v3 total entity count drifted during import."
    );
  }
}

async function finalizeV3MaterializedArtifacts(args: {
  sourcePlan: V3SourcePlan;
  stageDir: string;
}): Promise<void> {
  if (!args.sourcePlan.materializedSourceRootPath) {
    return;
  }

  const stagedRoot = path.join(
    args.stageDir,
    "materialized",
    buildHash(args.sourcePlan.importedSourceId)
  );

  await mkdir(path.dirname(args.sourcePlan.materializedSourceRootPath), {
    recursive: true
  });
  await rm(args.sourcePlan.materializedSourceRootPath, {
    force: true,
    recursive: true
  });
  await rename(stagedRoot, args.sourcePlan.materializedSourceRootPath);
}

async function replayV3StageSection(args: {
  entityStore: WorkbenchEntityStore & EntityWriter;
  importedSourceId: string;
  materializedSourceRootPath?: string;
  sectionName: ArchiveV3EntitySectionName;
  sourceAdapterId: string;
  sourceDiagnostics: Diagnostic[];
  sourcePlan: V3SourcePlan;
  stageFilePath: string;
  stagePlan: V3ArchiveStagingPlan;
}): Promise<void> {
  switch (args.sectionName) {
    case "projects":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseProject(
            payload as Project,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            {
              projectIds: args.stagePlan.idMaps.projectIds,
              relatedEntityIds: args.stagePlan.idMaps.relatedEntityIds,
              rawArtifactIds: args.stagePlan.idMaps.rawArtifactIds,
              sessionIds: args.stagePlan.idMaps.sessionIds
            }
          ),
        (items) => ({
          projects: items
        })
      );
      return;
    case "sessions":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseSession(
            payload as Session,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            {
              eventIds: args.stagePlan.idMaps.eventIds,
              fileMutationIds: args.stagePlan.idMaps.fileMutationIds,
              messageIds: args.stagePlan.idMaps.messageIds,
              outputArtifactIds: args.stagePlan.idMaps.outputArtifactIds,
              projectIds: args.stagePlan.idMaps.projectIds,
              relatedEntityIds: args.stagePlan.idMaps.relatedEntityIds,
              rawArtifactIds: args.stagePlan.idMaps.rawArtifactIds,
              sessionIds: args.stagePlan.idMaps.sessionIds,
              shellCommandIds: args.stagePlan.idMaps.shellCommandIds,
              toolCallIds: args.stagePlan.idMaps.toolCallIds
            }
          ),
        (items) => ({
          sessions: items
        })
      );
      return;
    case "timeline-events":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseEvent(
            payload as SessionEvent,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            {
              eventIds: args.stagePlan.idMaps.eventIds,
              relatedEntityIds: args.stagePlan.idMaps.relatedEntityIds,
              rawArtifactIds: args.stagePlan.idMaps.rawArtifactIds,
              sessionIds: args.stagePlan.idMaps.sessionIds
            }
          ),
        (items) => ({
          events: items
        })
      );
      return;
    case "messages":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseMessage(
            payload as SessionMessage,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            {
              eventIds: args.stagePlan.idMaps.eventIds,
              messageIds: args.stagePlan.idMaps.messageIds,
              relatedEntityIds: args.stagePlan.idMaps.relatedEntityIds,
              rawArtifactIds: args.stagePlan.idMaps.rawArtifactIds,
              sessionIds: args.stagePlan.idMaps.sessionIds,
              toolCallIds: args.stagePlan.idMaps.toolCallIds
            }
          ),
        (items) => ({
          messages: items
        })
      );
      return;
    case "tool-calls":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseToolCall(
            payload as ToolCall,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            {
              eventIds: args.stagePlan.idMaps.eventIds,
              fileMutationIds: args.stagePlan.idMaps.fileMutationIds,
              outputArtifactIds: args.stagePlan.idMaps.outputArtifactIds,
              relatedEntityIds: args.stagePlan.idMaps.relatedEntityIds,
              rawArtifactIds: args.stagePlan.idMaps.rawArtifactIds,
              sessionIds: args.stagePlan.idMaps.sessionIds,
              shellCommandIds: args.stagePlan.idMaps.shellCommandIds,
              toolCallIds: args.stagePlan.idMaps.toolCallIds
            }
          ),
        (items) => ({
          toolCalls: items
        })
      );
      return;
    case "shell-commands":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseShellCommand(
            payload as ShellCommandEvidence,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            {
              eventIds: args.stagePlan.idMaps.eventIds,
              outputArtifactIds: args.stagePlan.idMaps.outputArtifactIds,
              relatedEntityIds: args.stagePlan.idMaps.relatedEntityIds,
              rawArtifactIds: args.stagePlan.idMaps.rawArtifactIds,
              sessionIds: args.stagePlan.idMaps.sessionIds,
              shellCommandIds: args.stagePlan.idMaps.shellCommandIds,
              toolCallIds: args.stagePlan.idMaps.toolCallIds
            }
          ),
        (items) => ({
          shellCommands: items
        })
      );
      return;
    case "output-artifacts":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseOutputArtifact(
            payload as OutputArtifact,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            args.stagePlan.idMaps.eventIds,
            args.stagePlan.idMaps.outputArtifactIds,
            args.stagePlan.idMaps.relatedEntityIds,
            args.stagePlan.idMaps.rawArtifactIds,
            args.stagePlan.idMaps.sessionIds
          ),
        (items) => ({
          outputArtifacts: items
        })
      );
      return;
    case "file-mutations":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseFileMutation(
            payload as FileMutationEvidence,
            args.stagePlan.idMaps.diagnosticIds,
            args.importedSourceId,
            args.stagePlan.idMaps.eventIds,
            args.stagePlan.idMaps.fileMutationIds,
            args.stagePlan.idMaps.relatedEntityIds,
            args.stagePlan.idMaps.rawArtifactIds,
            args.stagePlan.idMaps.sessionIds,
            args.stagePlan.idMaps.toolCallIds
          ),
        (items) => ({
          fileMutations: items
        })
      );
      return;
    case "diagnostics":
      await replayBufferedSection(
        args,
        (payload) => {
          const diagnostic = rebaseDiagnostic(
            payload as Diagnostic,
            args.stagePlan.idMaps.diagnosticIds,
            args.stagePlan.idMaps.relatedEntityIds,
            args.importedSourceId
          );

          if (isSourceDiagnosticCandidate(diagnostic)) {
            args.sourceDiagnostics.push(diagnostic);
          }

          return diagnostic;
        },
        (items) => ({
          diagnostics: items
        })
      );
      replaceArrayContents(
        args.sourceDiagnostics,
        dedupeByKey(args.sourceDiagnostics, (diagnostic) => diagnostic.id)
      );
      return;
    case "verification-snapshots":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseStoredSessionVerificationSnapshot(
            payload as StoredSessionVerificationSnapshot,
            args.stagePlan.idMaps
          ),
        (items) => ({
          verificationSnapshots: items
        })
      );
      return;
    case "run-audit-snapshots":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseStoredSessionRunAuditSnapshot(
            payload as StoredSessionRunAuditSnapshot,
            args.stagePlan.idMaps
          ),
        (items) => ({
          runAuditSnapshots: items
        })
      );
      return;
    case "git-snapshots":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseStoredProjectGitSnapshot(
            payload as StoredProjectGitSnapshot,
            args.stagePlan.idMaps
          ),
        (items) => ({
          gitSnapshots: items
        })
      );
      return;
    case "github-snapshots":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseStoredProjectGitHubSnapshot(
            payload as StoredProjectGitHubSnapshot,
            args.stagePlan.idMaps
          ),
        (items) => ({
          githubSnapshots: items
        })
      );
      return;
    case "overview-rollups":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseWorkbenchOverviewRollup(
            payload as WorkbenchOverviewRollup,
            args.importedSourceId
          ),
        (items) =>
          items[0]
            ? {
                overviewRollup: items[0]
              }
            : {}
      );
      return;
    case "project-rollups":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseWorkbenchProjectRollup(
            payload as WorkbenchProjectRollup,
            args.importedSourceId,
            args.stagePlan.idMaps
          ),
        (items) => ({
          projectRollups: items
        })
      );
      return;
    case "session-rollups":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseWorkbenchSessionRollup(
            payload as WorkbenchSessionRollup,
            args.importedSourceId,
            args.stagePlan.idMaps
          ),
        (items) => ({
          sessionRollups: items
        })
      );
      return;
    case "raw-artifact-entries":
      await replayBufferedSection(
        args,
        (payload) =>
          rebaseWorkbenchRawArtifactMetadata(
            payload as WorkbenchRawArtifactMetadataRecord,
            args.importedSourceId,
            args.materializedSourceRootPath,
            args.stagePlan.idMaps
          ),
        (items) => ({
          rawArtifacts: items
        })
      );
  }
}

async function replayBufferedSection<TInput, TOutput>(args: {
  entityStore: WorkbenchEntityStore & EntityWriter;
  importedSourceId: string;
  sectionName: ArchiveV3EntitySectionName;
  sourceAdapterId: string;
  sourcePlan: V3SourcePlan;
  stageFilePath: string;
}, mapItem: (payload: TInput) => TOutput, buildBatch: (items: TOutput[]) => Partial<{
  diagnostics: Diagnostic[];
  events: SessionEvent[];
  fileMutations: FileMutationEvidence[];
  githubSnapshots: StoredProjectGitHubSnapshot[];
  gitSnapshots: StoredProjectGitSnapshot[];
  messages: SessionMessage[];
  outputArtifacts: OutputArtifact[];
  overviewRollup: WorkbenchOverviewRollup;
  projects: Project[];
  projectRollups: WorkbenchProjectRollup[];
  rawArtifacts: WorkbenchRawArtifactMetadataRecord[];
  runAuditSnapshots: StoredSessionRunAuditSnapshot[];
  sessionRollups: WorkbenchSessionRollup[];
  sessions: Session[];
  shellCommands: ShellCommandEvidence[];
  toolCalls: ToolCall[];
  verificationSnapshots: StoredSessionVerificationSnapshot[];
}>): Promise<void> {
  const bufferedItems: TOutput[] = [];

  for await (const payload of readStagedJsonLines<TInput>(args.stageFilePath)) {
    bufferedItems.push(mapItem(payload));

    if (bufferedItems.length >= DEFAULT_BOUNDED_INGESTION_LIMITS.maxEntityBatchSize) {
      await args.entityStore.writeBatch({
        ingestRunId: args.sourcePlan.ingestRunId,
        adapterId: args.sourceAdapterId,
        sourceId: args.importedSourceId,
        ...buildBatch(bufferedItems.splice(0))
      });
    }
  }

  if (bufferedItems.length > 0) {
    await args.entityStore.writeBatch({
      ingestRunId: args.sourcePlan.ingestRunId,
      adapterId: args.sourceAdapterId,
      sourceId: args.importedSourceId,
      ...buildBatch(bufferedItems)
    });
  }
}

async function* readStagedJsonLines<TPayload>(
  stageFilePath: string
): AsyncGenerator<TPayload, void, void> {
  const lineReader = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(stageFilePath, { encoding: "utf8" })
  });

  try {
    for await (const line of lineReader) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        continue;
      }

      yield JSON.parse(trimmed) as TPayload;
    }
  } finally {
    lineReader.close();
  }
}

function isSourceDiagnosticCandidate(diagnostic: Diagnostic): boolean {
  return diagnostic.scope === "adapter" || diagnostic.scope === "source";
}

async function readOptionalUtf8File(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function restoreUtf8FileSnapshot(
  filePath: string,
  snapshot: string | undefined
): Promise<void> {
  if (snapshot === undefined) {
    await rm(filePath, { force: true });
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, snapshot, "utf8");
}

function replaceArrayContents<TItem>(target: TItem[], nextItems: TItem[]): void {
  target.splice(0, target.length, ...nextItems);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function rebaseStoredSessionVerificationSnapshot(
  snapshot: StoredSessionVerificationSnapshot,
  idMaps: V3ImportIdMaps
): StoredSessionVerificationSnapshot {
  return {
    sessionId: idMaps.sessionIds.get(snapshot.sessionId) ?? snapshot.sessionId,
    verification: rebaseVerificationResult(
      snapshot.verification,
      idMaps.diagnosticIds,
      idMaps.shellCommandIds
    )
  };
}

function rebaseStoredSessionRunAuditSnapshot(
  snapshot: StoredSessionRunAuditSnapshot,
  idMaps: V3ImportIdMaps
): StoredSessionRunAuditSnapshot {
  return {
    sessionId: idMaps.sessionIds.get(snapshot.sessionId) ?? snapshot.sessionId,
    audit: rebaseRunAuditResult(snapshot.audit, idMaps.diagnosticIds, {
      messageIds: idMaps.messageIds,
      shellCommandIds: idMaps.shellCommandIds,
      toolCallIds: idMaps.toolCallIds
    })
  };
}

function rebaseStoredProjectGitSnapshot(
  snapshot: StoredProjectGitSnapshot,
  idMaps: V3ImportIdMaps
): StoredProjectGitSnapshot {
  return {
    projectId: idMaps.projectIds.get(snapshot.projectId) ?? snapshot.projectId,
    git: {
      ...snapshot.git,
      diagnosticIds: mapIds(snapshot.git.diagnosticIds, idMaps.diagnosticIds)
    }
  };
}

function rebaseStoredProjectGitHubSnapshot(
  snapshot: StoredProjectGitHubSnapshot,
  idMaps: V3ImportIdMaps
): StoredProjectGitHubSnapshot {
  return {
    projectId: idMaps.projectIds.get(snapshot.projectId) ?? snapshot.projectId,
    github: {
      ...snapshot.github,
      diagnosticIds: mapIds(snapshot.github.diagnosticIds, idMaps.diagnosticIds)
    }
  };
}

function rebaseWorkbenchOverviewRollup(
  rollup: WorkbenchOverviewRollup,
  importedSourceId: string
): WorkbenchOverviewRollup {
  return {
    ...rollup,
    sourceId: importedSourceId
  };
}

function rebaseWorkbenchProjectRollup(
  rollup: WorkbenchProjectRollup,
  importedSourceId: string,
  idMaps: V3ImportIdMaps
): WorkbenchProjectRollup {
  return {
    ...rollup,
    sourceId: importedSourceId,
    latestSessionId:
      idMaps.sessionIds.get(rollup.latestSessionId) ?? rollup.latestSessionId,
    ...(rollup.projectId
      ? { projectId: idMaps.projectIds.get(rollup.projectId) ?? rollup.projectId }
      : {}),
    sessionIds: mapIds(rollup.sessionIds, idMaps.sessionIds),
    ...(rollup.project
      ? {
          project: rebaseProject(
            rollup.project,
            idMaps.diagnosticIds,
            importedSourceId,
            {
              projectIds: idMaps.projectIds,
              relatedEntityIds: idMaps.relatedEntityIds,
              rawArtifactIds: idMaps.rawArtifactIds,
              sessionIds: idMaps.sessionIds
            }
          )
        }
      : {}),
    ...(rollup.latestRunAudit
      ? {
          latestRunAudit: rebaseRunAuditResult(
            rollup.latestRunAudit,
            idMaps.diagnosticIds,
            {
              messageIds: idMaps.messageIds,
              shellCommandIds: idMaps.shellCommandIds,
              toolCallIds: idMaps.toolCallIds
            }
          )
        }
      : {}),
    ...(rollup.latestVerification
      ? {
          latestVerification: rebaseVerificationResult(
            rollup.latestVerification,
            idMaps.diagnosticIds,
            idMaps.shellCommandIds
          )
        }
      : {}),
    ...(rollup.git
      ? {
          git: {
            ...rollup.git,
            diagnosticIds: mapIds(rollup.git.diagnosticIds, idMaps.diagnosticIds)
          }
        }
      : {}),
    ...(rollup.github
      ? {
          github: {
            ...rollup.github,
            diagnosticIds: mapIds(rollup.github.diagnosticIds, idMaps.diagnosticIds)
          }
        }
      : {})
  };
}

function rebaseWorkbenchSessionRollup(
  rollup: WorkbenchSessionRollup,
  importedSourceId: string,
  idMaps: V3ImportIdMaps
): WorkbenchSessionRollup {
  return {
    ...rollup,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(rollup.sessionId) ?? rollup.sessionId,
    ...(rollup.projectId
      ? { projectId: idMaps.projectIds.get(rollup.projectId) ?? rollup.projectId }
      : {}),
    ...(rollup.runAudit
      ? {
          runAudit: rebaseRunAuditResult(rollup.runAudit, idMaps.diagnosticIds, {
            messageIds: idMaps.messageIds,
            shellCommandIds: idMaps.shellCommandIds,
            toolCallIds: idMaps.toolCallIds
          })
        }
      : {}),
    ...(rollup.session
      ? {
          session: rebaseSession(
            rollup.session,
            idMaps.diagnosticIds,
            importedSourceId,
            {
              eventIds: idMaps.eventIds,
              fileMutationIds: idMaps.fileMutationIds,
              messageIds: idMaps.messageIds,
              outputArtifactIds: idMaps.outputArtifactIds,
              projectIds: idMaps.projectIds,
              relatedEntityIds: idMaps.relatedEntityIds,
              rawArtifactIds: idMaps.rawArtifactIds,
              sessionIds: idMaps.sessionIds,
              shellCommandIds: idMaps.shellCommandIds,
              toolCallIds: idMaps.toolCallIds
            }
          )
        }
      : {}),
    ...(rollup.verification
      ? {
          verification: rebaseVerificationResult(
            rollup.verification,
            idMaps.diagnosticIds,
            idMaps.shellCommandIds
          )
        }
      : {})
  };
}

function rebaseWorkbenchRawArtifactMetadata(
  metadata: WorkbenchRawArtifactMetadataRecord,
  importedSourceId: string,
  materializedSourceRootPath: string | undefined,
  idMaps: V3ImportIdMaps
): WorkbenchRawArtifactMetadataRecord {
  const rebasedArtifactId =
    idMaps.rawArtifactIds.get(metadata.artifactId) ?? metadata.artifactId;
  const materializedPath = materializedSourceRootPath
    ? materializedRawArtifactPathForMetadata(
        metadata,
        materializedSourceRootPath,
        rebasedArtifactId
      )
    : undefined;
  const rebasedEntry =
    metadata.entry
      ? {
          ...metadata.entry,
          id: rebasedArtifactId,
          sourceId: importedSourceId,
          ...(materializedPath ? { path: materializedPath } : {})
        }
      : undefined;

  if (rebasedEntry && !rebasedEntry.path) {
    delete rebasedEntry.path;
  }

  return {
    ...metadata,
    artifactId: rebasedArtifactId,
    sourceId: importedSourceId,
    ...(metadata.outputArtifactId
      ? {
          outputArtifactId:
            idMaps.outputArtifactIds.get(metadata.outputArtifactId) ??
            metadata.outputArtifactId
        }
      : {}),
    ...(metadata.sessionId
      ? {
          sessionId:
            idMaps.sessionIds.get(metadata.sessionId) ?? metadata.sessionId
        }
      : {}),
    ...(rebasedEntry ? { entry: rebasedEntry } : {})
  };
}

function materializedRawArtifactPathForMetadata(
  metadata: WorkbenchRawArtifactMetadataRecord,
  sourceRootPath: string,
  rebasedArtifactId: string
): string | undefined {
  const entry = metadata.entry;

  if (!entry) {
    return undefined;
  }

  const archivedArtifact = toArchivedRawArtifactMetadata(metadata);

  return buildMaterializedArtifactPath(sourceRootPath, archivedArtifact, rebasedArtifactId);
}

interface ArchiveImporterOptions {
  appDataDir?: string;
  cacheStore: FileBackedCacheStore;
  entityStore?: WorkbenchEntityStore & EntityWriter;
  now?: () => Date;
  rawArtifactIndex?: RawArtifactIndex;
  sourceRegistry: SourceRegistry;
}

interface ImportTarget {
  archivedSource: ArchivedSourceRecord;
  importedSourceId: string;
  cacheRecords: NormalizedCacheRecord[];
  sourceDiagnostics: Diagnostic[];
}

interface RebasedArchivePayload {
  normalized: AdapterNormalizationResult;
  capabilitySnapshots: NonNullable<NormalizedCacheRecord["capabilitySnapshots"]>;
  diagnostics: NonNullable<NormalizedCacheRecord["diagnostics"]>;
  gitSnapshots?: NormalizedCacheRecord["gitSnapshots"];
  githubSnapshots?: NormalizedCacheRecord["githubSnapshots"];
  rawArtifactIndex?: NormalizedCacheRecord["rawArtifactIndex"];
  runAudits?: NormalizedCacheRecord["runAudits"];
  shellCommands?: NormalizedCacheRecord["shellCommands"];
  sourceDiagnostics: Diagnostic[];
  verificationResults?: NormalizedCacheRecord["verificationResults"];
}

interface PreparedImportTarget {
  payload: RebasedArchivePayload;
  rawArtifactIndexEntries: RawArtifactIndexEntry[];
  sourceRootPath: string;
  target: ImportTarget;
}

interface ArchiveSections {
  cacheRecords: NormalizedCacheRecord[];
  manifest: ArchiveManifest;
  rawArtifacts: ArchivedRawArtifact[];
  sourceDiagnostics: Diagnostic[];
  sources: ArchivedSourceRecord[];
}

interface V3SourcePlan {
  archivedSource: ArchivedSourceRecord;
  finalSourceRootPath: string;
  importedSourceId: string;
  ingestRunId: string;
  materializedSourceRootPath?: string;
  sectionFiles: Partial<Record<ArchiveV3EntitySectionName, string>>;
  sourceDiagnostics: Diagnostic[];
}

interface V3ArchiveStagingPlan {
  archivePath: string;
  idMaps: V3ImportIdMaps;
  importedAt: string;
  manifest: ArchiveV3Manifest;
  sourcePlans: Map<string, V3SourcePlan>;
  stageDir: string;
  stageMaterializedRoots: string[];
}

interface V3ImportIdMaps {
  diagnosticIds: Map<string, string>;
  eventIds: Map<string, string>;
  fileMutationIds: Map<string, string>;
  messageIds: Map<string, string>;
  outputArtifactIds: Map<string, string>;
  projectIds: Map<string, string>;
  rawArtifactIds: Map<string, string>;
  relatedEntityIds: Map<string, string>;
  sessionIds: Map<string, string>;
  shellCommandIds: Map<string, string>;
  toolCallIds: Map<string, string>;
}

interface V3ArchiveImportState {
  currentSection?: ArchiveV3EntitySection;
  idMaps: V3ImportIdMaps;
  ownerByArchivedDiagnosticId: Map<string, string>;
  ownerByArchivedEventId: Map<string, string>;
  ownerByArchivedFileMutationId: Map<string, string>;
  ownerByArchivedMessageId: Map<string, string>;
  ownerByArchivedOutputArtifactId: Map<string, string>;
  ownerByArchivedProjectId: Map<string, string>;
  ownerByArchivedRawArtifactId: Map<string, string>;
  ownerByArchivedSessionId: Map<string, string>;
  ownerByArchivedShellCommandId: Map<string, string>;
  ownerByArchivedToolCallId: Map<string, string>;
  sectionCounts: Map<ArchiveV3EntitySectionName, number>;
}

export class ArchiveImporter {
  readonly #appDataDir: string | undefined;
  readonly #cacheStore: FileBackedCacheStore;
  readonly #entityStore: (WorkbenchEntityStore & EntityWriter) | undefined;
  readonly #now: () => Date;
  readonly #rawArtifactIndex: RawArtifactIndex | undefined;
  readonly #sourceRegistry: SourceRegistry;

  constructor(options: ArchiveImporterOptions) {
    this.#appDataDir = options.appDataDir;
    this.#cacheStore = options.cacheStore;
    this.#entityStore = options.entityStore;
    this.#now = options.now ?? (() => new Date());
    this.#rawArtifactIndex = options.rawArtifactIndex;
    this.#sourceRegistry = options.sourceRegistry;
  }

  async importArchive(input: ImportArchiveInput): Promise<ImportArchiveResult> {
    const archivePath = path.resolve(input.archivePath);

    if ((await this.#readArchiveManifestVersion(archivePath)) === ARCHIVE_V3_MANIFEST_VERSION) {
      return this.#importArchiveV3({
        archivePath,
        ...(input.displayName ? { displayName: input.displayName } : {})
      });
    }

    const archive = await this.#readArchiveSections(archivePath);
    const importedAt = this.#now().toISOString();
    const importTargets = buildImportTargets(archive, archivePath);

    if (importTargets.length === 0) {
      throw new ArchiveImportError(
        "archive-import.empty-payload",
        "Archive does not contain any cached normalized data to import."
      );
    }

    const importedSourceIds = new Set(
      importTargets.map((target) => target.importedSourceId)
    );
    const previousCacheRecords = (
      await Promise.all(
        [...importedSourceIds].map((sourceId) =>
          this.#cacheStore.listSourceRecords(sourceId)
        )
      )
    ).flat();
    const previousRawArtifactIndexEntries = this.#rawArtifactIndex
      ? await this.#rawArtifactIndex.load()
      : [];
    const previousSources = await Promise.all(
      importTargets.map((target) =>
        this.#sourceRegistry.getSource(target.importedSourceId)
      )
    );
    const preparedTargets = await Promise.all(
      importTargets.map((target) =>
        this.#prepareImportTarget({
          archivePath,
          importedAt,
          rawArtifacts: archive.rawArtifacts,
          target
        })
      )
    );
    const importedSourceRecords: SourceRecord[] = [];
    const importedCacheRecords = preparedTargets.map((preparedTarget) =>
      buildImportedCacheRecord({
        archivePath,
        importedAt,
        manifest: archive.manifest,
        payload: preparedTarget.payload,
        sourceId: preparedTarget.target.importedSourceId
      })
    );
    const nextRawArtifactIndexEntries = previousRawArtifactIndexEntries.filter(
      (entry) => !importedSourceIds.has(entry.sourceId)
    );

    nextRawArtifactIndexEntries.push(
      ...preparedTargets.flatMap((preparedTarget) => preparedTarget.rawArtifactIndexEntries)
    );
    await this.#cacheStore.replaceSourceRecords(importedSourceIds, importedCacheRecords);
    if (this.#rawArtifactIndex) {
      await this.#rawArtifactIndex.save(nextRawArtifactIndexEntries);
    }

    try {
      for (const [index, preparedTarget] of preparedTargets.entries()) {
        const sourceRecord = buildImportedSourceRecord({
          archivePath,
          archivedSource: preparedTarget.target.archivedSource,
          ...(input.displayName && preparedTargets.length === 1
            ? { displayName: input.displayName }
            : {}),
          ...(previousSources[index]?.createdAt
            ? { existingCreatedAt: previousSources[index]?.createdAt }
            : {}),
          importedAt,
          manifest: archive.manifest,
          rootPath: preparedTarget.sourceRootPath,
          sourceDiagnostics: preparedTarget.payload.sourceDiagnostics,
          sourceId: preparedTarget.target.importedSourceId
        });

        importedSourceRecords.push(await this.#sourceRegistry.replaceSource(sourceRecord));
      }
    } catch (error) {
      await this.#cacheStore.replaceSourceRecords(importedSourceIds, previousCacheRecords);
      if (this.#rawArtifactIndex) {
        await this.#rawArtifactIndex.save(previousRawArtifactIndexEntries);
      }
      throw error;
    }

    const primarySourceRecord = importedSourceRecords[0];

    if (!primarySourceRecord) {
      throw new ArchiveImportError(
        "archive-import.empty-payload",
        "Archive did not produce any importable source records."
      );
    }

    return {
      archivePath,
      manifest: archive.manifest,
      sourceId: primarySourceRecord.sourceId,
      sourceIds: importedSourceRecords.map((record) => record.sourceId),
      sourceRecord: primarySourceRecord,
      sourceRecords: importedSourceRecords
    };
  }

  async #readArchiveManifestVersion(archivePath: string): Promise<number> {
    const lineReader = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(archivePath, { encoding: "utf8" })
    });

    try {
      for await (const line of lineReader) {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
          continue;
        }

        assertBoundedLine({
          code: "archive-import.line-too-large",
          line: trimmed,
          limitBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxArchiveLineBytes,
          subject: "Archive line"
        });

        const parsed = archiveVersionedLineSchema.parse(
          repairArchiveLineForImport(JSON.parse(trimmed))
        );

        if (parsed.kind !== "manifest") {
          break;
        }

        return parsed.manifest.manifestVersion;
      }
    } catch (error) {
      if (error instanceof BoundedIngestionError) {
        throw new ArchiveImportError("archive-import.line-too-large", error.message);
      }
    } finally {
      lineReader.close();
    }

    throw new ArchiveImportError(
      "archive-import.invalid-archive",
      "Archive is unreadable or does not match the supported harness-neutral format."
    );
  }

  async #importArchiveV3(input: {
    archivePath: string;
    displayName?: string;
  }): Promise<ImportArchiveResult> {
    if (!this.#entityStore) {
      throw new ArchiveImportError(
        "archive-import.invalid-archive",
        "Archive v3 import requires the staged entity-store import path."
      );
    }

    const importedAt = this.#now().toISOString();
    const stagePlan = await this.#stageArchiveV3({
      archivePath: input.archivePath,
      importedAt
    });

    if (stagePlan.sourcePlans.size === 0) {
      await rm(stagePlan.stageDir, { force: true, recursive: true });
      throw new ArchiveImportError(
        "archive-import.empty-payload",
        "Archive does not contain any entity-store source data to import."
      );
    }

    const sourcePlans = [...stagePlan.sourcePlans.values()];
    const previousSourcesBySourceId = new Map(
      await Promise.all(
        sourcePlans.map(async (plan) => [
          plan.importedSourceId,
          await this.#sourceRegistry.getSource(plan.importedSourceId)
        ] as const)
      )
    );
    const previousRunsBySourceId = new Map(
      await Promise.all(
        sourcePlans.map(async (plan) => [
          plan.importedSourceId,
          await this.#entityStore!.getCurrentIngestRun({
            sourceId: plan.importedSourceId
          })
        ] as const)
      )
    );
    const sourceRegistryPath = this.#appDataDir
      ? path.join(this.#appDataDir, "sources.json")
      : undefined;
    const previousSourceRegistrySnapshot = sourceRegistryPath
      ? await readOptionalUtf8File(sourceRegistryPath)
      : undefined;
    const importedSourceRecords: SourceRecord[] = [];
    const publishedSourcePlans: V3SourcePlan[] = [];

    try {
      for (const sourcePlan of sourcePlans) {
        await this.#replayV3SourcePlan(stagePlan, sourcePlan);
      }

      for (const sourcePlan of sourcePlans) {
        const sourceRecord = buildImportedSourceRecord({
          archivePath: stagePlan.archivePath,
          archivedSource: sourcePlan.archivedSource,
          ...(input.displayName && sourcePlans.length === 1
            ? { displayName: input.displayName }
            : {}),
          ...(previousSourcesBySourceId.get(sourcePlan.importedSourceId)?.createdAt
            ? {
                existingCreatedAt:
                  previousSourcesBySourceId.get(sourcePlan.importedSourceId)!.createdAt
              }
            : {}),
          importedAt,
          manifest: stagePlan.manifest,
          rootPath: sourcePlan.materializedSourceRootPath ?? sourcePlan.finalSourceRootPath,
          sourceDiagnostics: sourcePlan.sourceDiagnostics,
          sourceId: sourcePlan.importedSourceId
        });

        importedSourceRecords.push(await this.#sourceRegistry.replaceSource(sourceRecord));
      }

      for (const sourcePlan of sourcePlans) {
        await this.#entityStore.publishIngestRun({
          ingestRunId: sourcePlan.ingestRunId,
          sourceId: sourcePlan.importedSourceId,
          publishedAt: importedAt
        });
        publishedSourcePlans.push(sourcePlan);
      }

      for (const sourcePlan of sourcePlans) {
        const previousRootPath =
          previousSourcesBySourceId.get(sourcePlan.importedSourceId)?.rootPath;
        const nextRootPath =
          sourcePlan.materializedSourceRootPath ?? sourcePlan.finalSourceRootPath;

        if (
          shouldCleanupImportedArchiveMaterializedRoot({
            appDataDir: this.#appDataDir,
            nextRootPath,
            previousRootPath
          })
        ) {
          await rm(previousRootPath!, {
            force: true,
            recursive: true
          });
        }
      }
    } catch (error) {
      await this.#rollbackFailedV3Import({
        previousRunsBySourceId,
        publishedSourcePlans,
        sourcePlans,
        ...(previousSourceRegistrySnapshot
          ? { previousSourceRegistrySnapshot }
          : {}),
        ...(sourceRegistryPath ? { sourceRegistryPath } : {})
      });
      throw error;
    } finally {
      await rm(stagePlan.stageDir, { force: true, recursive: true });
    }

    const primarySourceRecord = importedSourceRecords[0];

    if (!primarySourceRecord) {
      throw new ArchiveImportError(
        "archive-import.empty-payload",
        "Archive did not produce any importable source records."
      );
    }

    return {
      archivePath: input.archivePath,
      manifest: stagePlan.manifest,
      sourceId: primarySourceRecord.sourceId,
      sourceIds: importedSourceRecords.map((record) => record.sourceId),
      sourceRecord: primarySourceRecord,
      sourceRecords: importedSourceRecords
    };
  }

  async #rollbackFailedV3Import(args: {
    previousRunsBySourceId: Map<string, Awaited<ReturnType<WorkbenchEntityStore["getCurrentIngestRun"]>>>;
    previousSourceRegistrySnapshot?: string;
    publishedSourcePlans: V3SourcePlan[];
    sourcePlans: V3SourcePlan[];
    sourceRegistryPath?: string;
  }): Promise<void> {
    if (args.sourceRegistryPath) {
      await restoreUtf8FileSnapshot(
        args.sourceRegistryPath,
        args.previousSourceRegistrySnapshot
      );
    }

    for (const sourcePlan of args.publishedSourcePlans) {
      const previousRun = args.previousRunsBySourceId.get(sourcePlan.importedSourceId);

      if (previousRun) {
        await this.#entityStore!.publishIngestRun({
          ingestRunId: previousRun.ingestRunId,
          sourceId: sourcePlan.importedSourceId,
          publishedAt: this.#now().toISOString()
        });
      } else {
        await this.#entityStore!.clearCurrentIngestRun?.({
          sourceId: sourcePlan.importedSourceId
        });
      }
    }

    for (const sourcePlan of args.sourcePlans) {
      await this.#entityStore!.cleanupStaleRuns({
        beforeUpdatedAt: `${this.#now().toISOString()}~`,
        preservePublished: false,
        sourceId: sourcePlan.importedSourceId
      });

      if (sourcePlan.materializedSourceRootPath) {
        await rm(sourcePlan.materializedSourceRootPath, {
          force: true,
          recursive: true
        });
      }
    }
  }

  async #stageArchiveV3(args: {
    archivePath: string;
    importedAt: string;
  }): Promise<V3ArchiveStagingPlan> {
    const stageDir = await mkdtemp(
      path.join(this.#appDataDir ?? os.tmpdir(), "awb-archive-import-v3-")
    );
    const lineReader = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(args.archivePath, { encoding: "utf8" })
    });
    let manifest: ArchiveV3Manifest | undefined;
    let aggregateTracker: ArchiveAggregateTracker | undefined;
    let sectionLineCount = 0;
    const sourcePlans = new Map<string, V3SourcePlan>();
    const state = createV3ArchiveImportState();
    const rawArtifactMetadataByArchivedId = new Map<
      string,
      WorkbenchRawArtifactMetadataRecord
    >();
    const materializedRootHashes = new Set<string>();

    try {
      for await (const line of lineReader) {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
          continue;
        }

        assertBoundedLine({
          code: "archive-import.line-too-large",
          line: trimmed,
          limitBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxArchiveLineBytes,
          subject: "Archive line"
        });

        const parsed = archiveVersionedLineSchema.parse(
          repairArchiveLineForImport(JSON.parse(trimmed))
        );

        switch (parsed.kind) {
          case "manifest": {
            if (parsed.manifest.manifestVersion !== ARCHIVE_V3_MANIFEST_VERSION) {
              throw new Error("Expected a v3 archive manifest.");
            }

            manifest = parsed.manifest;
            aggregateTracker = new ArchiveAggregateTracker(parsed.manifest.aggregateLimits);
            break;
          }
          case "entity-section": {
            if (!manifest) {
              throw new Error("Archive v3 entity section was encountered before the manifest.");
            }

            sectionLineCount += 1;

            if (sectionLineCount > manifest.aggregateLimits.maxSectionCount) {
              throw new ArchiveAggregateLimitError(
                "archive.aggregate.section-count-exceeded",
                `Archive exceeds the ${manifest.aggregateLimits.maxSectionCount}-section aggregate limit.`
              );
            }

            state.currentSection = parsed.section;
            state.sectionCounts.set(parsed.section.name, 0);
            break;
          }
          case "entity": {
            if (
              !manifest ||
              !aggregateTracker ||
              !state.currentSection ||
              parsed.section !== state.currentSection.name
            ) {
              throw new Error("Archive v3 entity line is missing its declared section context.");
            }

            aggregateTracker.recordEntity(parsed.section);
            state.sectionCounts.set(
              parsed.section,
              (state.sectionCounts.get(parsed.section) ?? 0) + 1
            );

            if (parsed.section === "sources") {
              const archivedSource = parsed.payload as ArchivedSourceRecord;
              const importedSourceId = createImportedSourceId(
                args.archivePath,
                archivedSource
              );

              sourcePlans.set(archivedSource.sourceId, {
                archivedSource,
                finalSourceRootPath: args.archivePath,
                importedSourceId,
                ingestRunId: buildArchiveIngestRunId(importedSourceId, args.importedAt),
                sectionFiles: {},
                sourceDiagnostics: []
              });
              break;
            }

            const sourcePlan = resolveV3SourcePlanForEntity({
              payload: parsed.payload,
              section: parsed.section,
              sourcePlans,
              state
            });

            if (!sourcePlan) {
              throw new Error(`Archive v3 ${parsed.section} entity could not be matched to a source.`);
            }

            registerV3EntityIds({
              payload: parsed.payload,
              section: parsed.section,
              sourcePlan,
              state
            });

            if (parsed.section === "raw-artifact-entries") {
              const metadata = asWorkbenchRawArtifactMetadataRecord(parsed.payload);
              rawArtifactMetadataByArchivedId.set(metadata.artifactId, metadata);
            }

            if (
              parsed.section === "diagnostics" &&
              isSourceDiagnosticCandidate(parsed.payload as unknown as Diagnostic)
            ) {
              aggregateTracker.recordSourceDiagnostic();
            }

            await appendV3StageLine(stageDir, sourcePlan, parsed.section, parsed.payload);
            break;
          }
          case "raw-artifact-chunk": {
            if (!aggregateTracker) {
              throw new Error("Archive v3 raw artifact chunk was encountered before the manifest.");
            }

            const metadata = rawArtifactMetadataByArchivedId.get(parsed.chunk.artifactId);
            const sourceId = state.ownerByArchivedRawArtifactId.get(parsed.chunk.artifactId);
            const sourcePlan =
              sourceId ? sourcePlans.get(sourceId) : undefined;

            if (!metadata || !sourcePlan) {
              throw new Error(
                `Archive v3 raw artifact chunk '${parsed.chunk.artifactId}' is missing metadata.`
              );
            }

            assertBoundedLine({
              code: "artifact.raw-chunk-too-large",
              line: parsed.chunk.content,
              limitBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes,
              subject: `Raw artifact chunk ${parsed.chunk.artifactId}`
            });
            aggregateTracker.recordRawArtifactChunk({
              artifactId: parsed.chunk.artifactId,
              content: parsed.chunk.content
            });

            sourcePlan.materializedSourceRootPath ??= buildImportedArchiveMaterializedRoot(
              this.#appDataDir ?? stageDir,
              args.archivePath,
              sourcePlan.importedSourceId,
              args.importedAt
            );
            materializedRootHashes.add(sourcePlan.materializedSourceRootPath);

            const rebasedArtifactId =
              state.idMaps.rawArtifactIds.get(parsed.chunk.artifactId) ??
              parsed.chunk.artifactId;
            const stageArtifactPath = buildV3StagedMaterializedArtifactPath({
              metadata,
              rebasedArtifactId,
              sourcePlan,
              stageDir
            });

            await mkdir(path.dirname(stageArtifactPath), { recursive: true });
            await appendFile(stageArtifactPath, parsed.chunk.content, "utf8");
            break;
          }
        }
      }
    } catch (error) {
      if (error instanceof BoundedIngestionError) {
        throw new ArchiveImportError(
          error.code === "artifact.raw-chunk-too-large"
            ? "archive-import.raw-chunk-too-large"
            : "archive-import.line-too-large",
          error.message
        );
      }

      if (error instanceof ArchiveAggregateLimitError) {
        throw new ArchiveImportError("archive-import.invalid-archive", error.message);
      }

      throw new ArchiveImportError(
        "archive-import.invalid-archive",
        "Archive is unreadable or does not match the supported harness-neutral format."
      );
    } finally {
      lineReader.close();
    }

    if (!manifest || sourcePlans.size === 0) {
      throw new ArchiveImportError(
        "archive-import.empty-payload",
        "Archive does not contain any entity-store source data to import."
      );
    }

    validateV3SectionCounts(manifest, state.sectionCounts);
    validateV3AggregateSnapshot({
      manifest,
      sectionLineCount,
      tracker:
        aggregateTracker ??
        new ArchiveAggregateTracker(manifest.aggregateLimits)
    });

    return {
      archivePath: args.archivePath,
      idMaps: state.idMaps,
      importedAt: args.importedAt,
      manifest,
      sourcePlans,
      stageDir,
      stageMaterializedRoots: [...materializedRootHashes]
    };
  }

  async #replayV3SourcePlan(
    stagePlan: V3ArchiveStagingPlan,
    sourcePlan: V3SourcePlan
  ): Promise<void> {
    await this.#entityStore!.beginIngestRun({
      adapterId: sourcePlan.archivedSource.adapterId,
      ingestRunId: sourcePlan.ingestRunId,
      sourceId: sourcePlan.importedSourceId,
      startedAt: stagePlan.importedAt
    });

    sourcePlan.sourceDiagnostics = [];

    for (const sectionName of V3_REPLAY_SECTION_ORDER) {
      const stageFilePath = sourcePlan.sectionFiles[sectionName];

      if (!stageFilePath) {
        continue;
      }

      await replayV3StageSection({
        entityStore: this.#entityStore!,
        importedSourceId: sourcePlan.importedSourceId,
        sourceAdapterId: sourcePlan.archivedSource.adapterId,
        sourceDiagnostics: sourcePlan.sourceDiagnostics,
        sourcePlan,
        stageFilePath,
        stagePlan,
        sectionName,
        ...(sourcePlan.materializedSourceRootPath
          ? {
              materializedSourceRootPath: sourcePlan.materializedSourceRootPath
            }
          : {})
      });
    }

    if (sourcePlan.materializedSourceRootPath) {
      await finalizeV3MaterializedArtifacts({
        sourcePlan,
        stageDir: stagePlan.stageDir
      });
    }

    await this.#entityStore!.markLifecycle({
      kind: "source-complete",
      ingestRunId: sourcePlan.ingestRunId,
      adapterId: sourcePlan.archivedSource.adapterId,
      sourceId: sourcePlan.importedSourceId,
      occurredAt: stagePlan.importedAt
    });
  }

  async #prepareImportTarget(args: {
    archivePath: string;
    importedAt: string;
    rawArtifacts: ArchivedRawArtifact[];
    target: ImportTarget;
  }): Promise<PreparedImportTarget> {
    const rebasedIds = buildRebasedArchiveIds({
      cacheRecords: args.target.cacheRecords,
      importedSourceId: args.target.importedSourceId
    });
    const materializedRawArtifacts = await this.#materializeArchivedRawArtifacts({
      archivePath: args.archivePath,
      archivedRawArtifacts: args.rawArtifacts.filter(
        (artifact) => artifact.sourceId === args.target.archivedSource.sourceId
      ),
      importedAt: args.importedAt,
      importedSourceId: args.target.importedSourceId,
      rawArtifactIds: rebasedIds.rawArtifactIds
    });
    const payload = rebaseArchivePayload({
      adapterId: args.target.archivedSource.adapterId,
      cacheRecords: args.target.cacheRecords,
      importedSourceId: args.target.importedSourceId,
      materializedRawArtifactPaths:
        materializedRawArtifacts.pathsByArchivedArtifactId,
      mergedNormalized: rebasedIds.mergedNormalized,
      rawArtifactIds: rebasedIds.rawArtifactIds,
      sourceDiagnostics: args.target.sourceDiagnostics
    });

    return {
      payload,
      rawArtifactIndexEntries: payload.rawArtifactIndex?.entries ?? [],
      sourceRootPath:
        materializedRawArtifacts.sourceRootPath ?? args.archivePath,
      target: args.target
    };
  }

  async #readArchiveSections(archivePath: string): Promise<ArchiveSections> {
    const lineReader = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(archivePath, { encoding: "utf8" })
    });
    let manifest: ArchiveManifest | undefined;
    const sources: ArchivedSourceRecord[] = [];
    const cacheRecords: NormalizedCacheRecord[] = [];
    const sourceDiagnostics: Diagnostic[] = [];
    const rawArtifactMetadata = new Map<string, Omit<ArchivedRawArtifact, "content">>();
    const rawArtifactChunks = new Map<string, Array<{ chunkIndex: number; content: string }>>();

    try {
      for await (const line of lineReader) {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
          continue;
        }

        assertBoundedLine({
          code: "archive-import.line-too-large",
          line: trimmed,
          limitBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxArchiveLineBytes,
          subject: "Archive line"
        });

        const parsed = archiveLineSchema.parse(
          repairArchiveLineForImport(JSON.parse(trimmed))
        );

        switch (parsed.kind) {
          case "manifest":
            manifest = parsed.manifest;
            break;
          case "source":
            sources.push(parsed.source);
            break;
          case "cache-record":
            cacheRecords.push(parsed.record as unknown as NormalizedCacheRecord);
            break;
          case "source-diagnostic":
            sourceDiagnostics.push(parsed.diagnostic as Diagnostic);
            break;
          case "raw-artifact":
            rawArtifactMetadata.set(parsed.artifact.artifactId, parsed.artifact);
            break;
          case "raw-artifact-chunk": {
            assertBoundedLine({
              code: "artifact.raw-chunk-too-large",
              line: parsed.chunk.content,
              limitBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes,
              subject: `Raw artifact chunk ${parsed.chunk.artifactId}`
            });
            const chunks = rawArtifactChunks.get(parsed.chunk.artifactId) ?? [];
            chunks.push({
              chunkIndex: parsed.chunk.chunkIndex,
              content: parsed.chunk.content
            });
            rawArtifactChunks.set(parsed.chunk.artifactId, chunks);
            break;
          }
        }
      }

      if (!manifest || sources.length === 0 || cacheRecords.length === 0) {
        throw new Error("Archive is missing required manifest, source, or cache sections.");
      }

      return {
        manifest,
        sources,
        cacheRecords,
        sourceDiagnostics,
        rawArtifacts: [...rawArtifactMetadata.values()].map((metadata) => ({
          ...metadata,
          content: (rawArtifactChunks.get(metadata.artifactId) ?? [])
            .sort((left, right) => left.chunkIndex - right.chunkIndex)
            .map((chunk) => chunk.content)
            .join("")
        }))
      };
    } catch (error) {
      if (error instanceof BoundedIngestionError) {
        throw new ArchiveImportError(
          error.code === "artifact.raw-chunk-too-large"
            ? "archive-import.raw-chunk-too-large"
            : "archive-import.line-too-large",
          error.message
        );
      }

      throw new ArchiveImportError(
        "archive-import.invalid-archive",
        "Archive is unreadable or does not match the supported harness-neutral format."
      );
    } finally {
      lineReader.close();
    }
  }

  async #materializeArchivedRawArtifacts(args: {
    archivePath: string;
    archivedRawArtifacts: ArchivedRawArtifact[];
    importedAt: string;
    importedSourceId: string;
    rawArtifactIds: Map<string, string>;
  }): Promise<{
    pathsByArchivedArtifactId: Map<string, string>;
    sourceRootPath?: string;
  }> {
    if (!this.#appDataDir || args.archivedRawArtifacts.length === 0) {
      return {
        pathsByArchivedArtifactId: new Map<string, string>()
      };
    }

    const sourceRootPath = path.join(
      this.#appDataDir,
      "imports",
      "archives",
      buildHash(`${args.archivePath}|${args.importedSourceId}|${args.importedAt}`)
    );
    const pathsByArchivedArtifactId = new Map<string, string>();

    for (const archivedArtifact of args.archivedRawArtifacts) {
      const rebasedArtifactId = args.rawArtifactIds.get(archivedArtifact.artifactId);

      if (!rebasedArtifactId) {
        continue;
      }

      const materializedPath = buildMaterializedArtifactPath(
        sourceRootPath,
        archivedArtifact,
        rebasedArtifactId
      );

      await mkdir(path.dirname(materializedPath), { recursive: true });
      await writeFile(materializedPath, archivedArtifact.content, "utf8");
      pathsByArchivedArtifactId.set(archivedArtifact.artifactId, materializedPath);
    }

    return {
      pathsByArchivedArtifactId,
      ...(pathsByArchivedArtifactId.size > 0 ? { sourceRootPath } : {})
    };
  }
}

function buildImportTargets(
  archive: ArchiveSections,
  archivePath: string
): ImportTarget[] {
  const cacheRecordsBySource = new Map<string, NormalizedCacheRecord[]>();

  for (const cacheRecord of archive.cacheRecords) {
    const archivedSourceId = cacheRecord.sourceId;
    const entries = cacheRecordsBySource.get(archivedSourceId) ?? [];

    entries.push(cacheRecord);
    cacheRecordsBySource.set(archivedSourceId, entries);
  }

  return archive.sources.flatMap((archivedSource) => {
    const cacheRecords = cacheRecordsBySource.get(archivedSource.sourceId) ?? [];

    if (cacheRecords.length === 0) {
      return [];
    }

    return [
      {
        archivedSource,
        importedSourceId: createImportedSourceId(archivePath, archivedSource),
        cacheRecords,
        sourceDiagnostics: filterSourceDiagnostics(
          archive.sourceDiagnostics,
          archivedSource
        )
      }
    ];
  });
}

function repairArchiveLineForImport(value: unknown): unknown {
  if (!isRecord(value) || value.kind !== "cache-record" || !isRecord(value.record)) {
    return value;
  }

  return {
    ...value,
    record: repairArchivedCacheRecordForImport(value.record)
  };
}

function repairArchivedCacheRecordForImport(
  record: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(record.normalized)) {
    return record;
  }

  const rawArtifactEntries = buildArchivedRawArtifactEntryMap(record);

  if (rawArtifactEntries.size === 0) {
    return record;
  }

  const normalized = record.normalized;

  return {
    ...record,
    normalized: {
      ...normalized,
      ...(Array.isArray(normalized.projects)
        ? {
            projects: normalized.projects.map((project) =>
              repairArchivedProjectRawArtifactRefs(project, rawArtifactEntries)
            )
          }
        : {}),
      ...(Array.isArray(normalized.sessions)
        ? {
            sessions: normalized.sessions.map((session) =>
              repairArchivedSessionRawArtifactRefs(session, rawArtifactEntries)
            )
          }
        : {})
    }
  };
}

function buildArchivedRawArtifactEntryMap(
  record: Record<string, unknown>
): Map<string, Record<string, unknown>> {
  const entries = isRecord(record.rawArtifactIndex)
    ? record.rawArtifactIndex.entries
    : undefined;

  if (!Array.isArray(entries)) {
    return new Map();
  }

  return new Map(
    entries.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        return [];
      }

      return [[entry.id, entry] as const];
    })
  );
}

function repairArchivedProjectRawArtifactRefs(
  project: unknown,
  rawArtifactEntries: Map<string, Record<string, unknown>>
): unknown {
  if (!isRecord(project) || !Array.isArray(project.harnessRefs)) {
    return project;
  }

  return {
    ...project,
    harnessRefs: project.harnessRefs.map((harnessRef) => {
      if (!isRecord(harnessRef) || !Array.isArray(harnessRef.rawArtifactRefs)) {
        return harnessRef;
      }

      return {
        ...harnessRef,
        rawArtifactRefs: harnessRef.rawArtifactRefs.map((artifact) =>
          repairArchivedRawArtifactRef(artifact, rawArtifactEntries)
        )
      };
    })
  };
}

function repairArchivedSessionRawArtifactRefs(
  session: unknown,
  rawArtifactEntries: Map<string, Record<string, unknown>>
): unknown {
  if (!isRecord(session) || !Array.isArray(session.rawArtifactRefs)) {
    return session;
  }

  return {
    ...session,
    rawArtifactRefs: session.rawArtifactRefs.map((artifact) =>
      repairArchivedRawArtifactRef(artifact, rawArtifactEntries)
    )
  };
}

function repairArchivedRawArtifactRef(
  artifact: unknown,
  rawArtifactEntries: Map<string, Record<string, unknown>>
): unknown {
  if (!isRecord(artifact)) {
    return artifact;
  }

  if (
    (typeof artifact.nativeRef === "string" && artifact.nativeRef.length > 0) ||
    (typeof artifact.path === "string" && artifact.path.length > 0)
  ) {
    return artifact;
  }

  if (typeof artifact.id !== "string") {
    return artifact;
  }

  const entry = rawArtifactEntries.get(artifact.id);

  if (!entry) {
    return artifact;
  }

  const nativeRef =
    typeof entry.nativeRef === "string" && entry.nativeRef.length > 0
      ? entry.nativeRef
      : typeof entry.nativeId === "string" && entry.nativeId.length > 0
        ? entry.nativeId
        : typeof entry.path === "string" && entry.path.length > 0
          ? entry.path
          : undefined;
  const nativeId =
    typeof entry.nativeId === "string" && entry.nativeId.length > 0
      ? entry.nativeId
      : undefined;

  return {
    ...artifact,
    ...(nativeRef ? { nativeRef } : {}),
    ...(nativeId ? { nativeId } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asWorkbenchRawArtifactMetadataRecord(
  value: unknown
): WorkbenchRawArtifactMetadataRecord {
  if (
    !isRecord(value) ||
    typeof value.artifactId !== "string" ||
    typeof value.sourceId !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new ArchiveImportError(
      "archive-import.invalid-archive",
      "Archive raw artifact metadata is missing required fields."
    );
  }

  return value as unknown as WorkbenchRawArtifactMetadataRecord;
}

function createImportedSourceId(
  archivePath: string,
  archivedSource: { adapterId: string; sourceId: string }
): string {
  return createSourceId(
    archivedSource.adapterId,
    `${archivePath}:${archivedSource.sourceId}`
  );
}

function filterSourceDiagnostics(
  diagnostics: Diagnostic[],
  archivedSource: ArchivedSourceRecord
): Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.sourceId === archivedSource.sourceId) {
      return true;
    }

    return (
      diagnostic.sourceId === undefined &&
      diagnostic.adapterId === archivedSource.adapterId &&
      (diagnostic.scope === "adapter" || diagnostic.scope === "source")
    );
  });
}

function buildImportedSourceRecord(args: {
  archivePath: string;
  archivedSource: ArchivedSourceRecord;
  displayName?: string;
  existingCreatedAt?: string;
  importedAt: string;
  manifest: VersionedArchiveManifest;
  rootPath: string;
  sourceDiagnostics: Diagnostic[];
  sourceId: string;
}): SourceRecord {
  const archiveMetadata: ImportedArchiveMetadata = {
    archivePath: args.archivePath,
    exportedAt: args.manifest.exportedAt,
    importedAt: args.importedAt,
    manifestVersion: args.manifest.manifestVersion,
    scopeKind: args.manifest.scope.kind,
    scopeId: args.manifest.scope.id,
    scopeLabel: args.manifest.scope.label,
    sourceCount: args.manifest.counts.sources,
    sessionCount: args.manifest.counts.sessions,
    projectCount: args.manifest.counts.projects,
    rawArtifactCount: args.manifest.counts.rawArtifacts
  };
  const importedCacheReason =
    "Archive contents were imported into the local read-only cache.";
  const readOnlyReason =
    "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import.";

  return {
    sourceId: args.sourceId,
    adapterId: args.archivedSource.adapterId,
    displayName:
      args.displayName?.trim() ||
      args.archivedSource.displayName ||
      `${args.manifest.scope.label} Archive`,
    rootPath: args.rootPath,
    enabled: true,
    sourceKind: "imported-archive",
    addedBy: "import",
    readOnly: true,
    validation: {
      status: "unsupported",
      diagnostics: [],
      updatedAt: args.importedAt
    },
    scan: {
      status: "unsupported",
      diagnostics: [],
      updatedAt: args.importedAt,
      reason: readOnlyReason
    },
    cache: {
      status: "cached",
      diagnostics: args.sourceDiagnostics,
      updatedAt: args.importedAt,
      reason: importedCacheReason,
      cacheKey: buildHash(`${args.sourceId}|${args.manifest.exportedAt}|cache`)
    },
    watch: {
      status: "unsupported",
      reason: readOnlyReason,
      updatedAt: args.importedAt
    },
    diagnostics: args.sourceDiagnostics,
    archive: archiveMetadata,
    createdAt: args.existingCreatedAt ?? args.importedAt,
    updatedAt: args.importedAt
  };
}

function buildImportedCacheRecord(args: {
  archivePath: string;
  importedAt: string;
  manifest: VersionedArchiveManifest;
  payload: RebasedArchivePayload;
  sourceId: string;
}): NormalizedCacheRecord {
  const fingerprintSeed = JSON.stringify({
    archivePath: args.archivePath,
    exportedAt: args.manifest.exportedAt,
    manifestVersion: args.manifest.manifestVersion,
    sourceId: args.sourceId
  });
  const fingerprint = buildHash(fingerprintSeed);

  return {
    cacheKey: `archive-import_${fingerprint}`,
    adapterId: args.payload.normalized.adapterId,
    sourceId: args.sourceId,
    artifactFingerprint: fingerprint,
    createdAt: args.importedAt,
    updatedAt: args.importedAt,
    normalized: args.payload.normalized,
    ...(args.payload.shellCommands ? { shellCommands: args.payload.shellCommands } : {}),
    ...(args.payload.verificationResults
      ? { verificationResults: args.payload.verificationResults }
      : {}),
    ...(args.payload.runAudits ? { runAudits: args.payload.runAudits } : {}),
    ...(args.payload.gitSnapshots ? { gitSnapshots: args.payload.gitSnapshots } : {}),
    ...(args.payload.githubSnapshots
      ? { githubSnapshots: args.payload.githubSnapshots }
      : {}),
    diagnostics: args.payload.diagnostics,
    ...(args.payload.rawArtifactIndex
      ? { rawArtifactIndex: args.payload.rawArtifactIndex }
      : {}),
    capabilitySnapshots: args.payload.capabilitySnapshots
  };
}

function rebaseArchivePayload(args: {
  adapterId: string;
  cacheRecords: NormalizedCacheRecord[];
  importedSourceId: string;
  materializedRawArtifactPaths: Map<string, string>;
  mergedNormalized: AdapterNormalizationResult;
  rawArtifactIds: Map<string, string>;
  sourceDiagnostics: Diagnostic[];
}): RebasedArchivePayload {
  const projectIds = buildIdMap(args.mergedNormalized.projects, (project) =>
    createProjectId({
      adapterId: project.adapterId ?? args.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(project)
    })
  );
  const sessionIds = buildIdMap(args.mergedNormalized.sessions, (session) =>
    createSessionId({
      adapterId: session.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(session)
    })
  );
  const eventIds = buildIdMap(args.mergedNormalized.events, (event) =>
    createSessionEventId({
      adapterId: event.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(event)
    })
  );
  const messageIds = buildIdMap(args.mergedNormalized.messages, (message) =>
    createSessionMessageId({
      adapterId: message.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(message)
    })
  );
  const toolCallIds = buildIdMap(args.mergedNormalized.toolCalls, (toolCall) =>
    createToolCallId({
      adapterId: toolCall.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(toolCall)
    })
  );
  const shellCommandIds = buildIdMap(args.mergedNormalized.shellCommands, (command) =>
    createShellCommandEvidenceId({
      adapterId: command.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(command)
    })
  );
  const outputArtifactIds = buildIdMap(args.mergedNormalized.outputArtifacts, (artifact) =>
    createOutputArtifactId({
      adapterId: artifact.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(artifact)
    })
  );
  const fileMutationIds = buildIdMap(args.mergedNormalized.fileMutations, (mutation) =>
    createFileMutationEvidenceId({
      adapterId: mutation.adapterId,
      sourceId: args.importedSourceId,
      nativeId: buildImportedNativeId(mutation)
    })
  );
  const diagnosticIds = buildDiagnosticIdMap(
    collectNormalizedDiagnostics(args.mergedNormalized),
    args.sourceDiagnostics,
    args.importedSourceId
  );
  const relatedEntityIds = new Map<string, string>([
    ...args.rawArtifactIds,
    ...projectIds,
    ...sessionIds,
    ...eventIds,
    ...messageIds,
    ...toolCallIds,
    ...shellCommandIds,
    ...outputArtifactIds,
    ...fileMutationIds
  ]);
  const diagnostics = args.mergedNormalized.diagnostics.map((diagnostic) =>
    rebaseDiagnostic(
      diagnostic,
      diagnosticIds,
      relatedEntityIds,
      args.importedSourceId
    )
  );
  const sourceDiagnostics = args.sourceDiagnostics.map((diagnostic) =>
    rebaseDiagnostic(
      diagnostic,
      diagnosticIds,
      relatedEntityIds,
      args.importedSourceId
    )
  );

  const normalized = {
    adapterId: args.adapterId,
    sourceId: args.importedSourceId,
    capabilities: {
      adapter: {
        adapterId: args.adapterId,
        capabilities: args.mergedNormalized.capabilities.adapter.capabilities
      },
      source: {
        adapterId: args.adapterId,
        sourceId: args.importedSourceId,
        capabilities: args.mergedNormalized.capabilities.source.capabilities
      },
      sessions: dedupeByKey(
        args.mergedNormalized.capabilities.sessions.map((capability) => ({
          adapterId: args.adapterId,
          sourceId: args.importedSourceId,
          sessionId: sessionIds.get(capability.sessionId) ?? capability.sessionId,
          capabilities: capability.capabilities
        })),
        (capability) => capability.sessionId
      )
    },
    projects: args.mergedNormalized.projects.map((project) =>
      rebaseProject(project, diagnosticIds, args.importedSourceId, {
        projectIds,
        relatedEntityIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds
      })
    ),
    sessions: args.mergedNormalized.sessions.map((session) =>
      rebaseSession(session, diagnosticIds, args.importedSourceId, {
        eventIds,
        fileMutationIds,
        messageIds,
        outputArtifactIds,
        projectIds,
        relatedEntityIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    events: args.mergedNormalized.events.map((event) =>
      rebaseEvent(event, diagnosticIds, args.importedSourceId, {
        eventIds,
        relatedEntityIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds
      })
    ),
    messages: args.mergedNormalized.messages.map((message) =>
      rebaseMessage(message, diagnosticIds, args.importedSourceId, {
        eventIds,
        messageIds,
        relatedEntityIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        toolCallIds
      })
    ),
    toolCalls: args.mergedNormalized.toolCalls.map((toolCall) =>
      rebaseToolCall(toolCall, diagnosticIds, args.importedSourceId, {
        eventIds,
        fileMutationIds,
        outputArtifactIds,
        relatedEntityIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    shellCommands: args.mergedNormalized.shellCommands.map((command) =>
      rebaseShellCommand(command, diagnosticIds, args.importedSourceId, {
        eventIds,
        outputArtifactIds,
        relatedEntityIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    outputArtifacts: args.mergedNormalized.outputArtifacts.map((artifact) =>
      rebaseOutputArtifact(
        artifact,
        diagnosticIds,
        args.importedSourceId,
        eventIds,
        outputArtifactIds,
        relatedEntityIds,
        args.rawArtifactIds,
        sessionIds
      )
    ),
    fileMutations: args.mergedNormalized.fileMutations.map((mutation) =>
      rebaseFileMutation(
        mutation,
        diagnosticIds,
        args.importedSourceId,
        eventIds,
        fileMutationIds,
        relatedEntityIds,
        args.rawArtifactIds,
        sessionIds,
        toolCallIds
      )
    ),
    diagnostics
  } as unknown as AdapterNormalizationResult;

  return {
    normalized,
    shellCommands: rebaseShellCommandSection(
      args.cacheRecords,
      diagnosticIds,
      outputArtifactIds,
      sessionIds,
      shellCommandIds,
      toolCallIds
    ),
    verificationResults: rebaseVerificationResultsSection(
      args.cacheRecords,
      diagnosticIds,
      sessionIds,
      shellCommandIds
    ),
    runAudits: rebaseRunAuditsSection(
      args.cacheRecords,
      diagnosticIds,
      messageIds,
      sessionIds,
      shellCommandIds,
      toolCallIds
    ),
    gitSnapshots: rebaseGitSnapshotsSection(args.cacheRecords, diagnosticIds, projectIds),
    githubSnapshots: rebaseGitHubSnapshotsSection(
      args.cacheRecords,
      diagnosticIds,
      projectIds
    ),
    diagnostics: {
      version: 1,
      entries: diagnostics
    },
    rawArtifactIndex: rebaseRawArtifactIndexSection(
      args.cacheRecords,
      args.importedSourceId,
      args.rawArtifactIds,
      args.materializedRawArtifactPaths
    ),
    capabilitySnapshots: {
      version: 1,
      adapter: normalized.capabilities.adapter,
      source: normalized.capabilities.source,
      sessions: normalized.capabilities.sessions
    },
    sourceDiagnostics
  };
}

function rebaseProject(
  project: Project,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    projectIds: Map<string, string>;
    relatedEntityIds: Map<string, string>;
    rawArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
  }
): Project {
  const rebasedProject = {
    ...project,
    id: idMaps.projectIds.get(project.id) ?? project.id,
    sourceId: importedSourceId,
    ...(project.harnessRefs
      ? {
          harnessRefs: project.harnessRefs.map((harnessRef) => ({
            ...harnessRef,
            sourceId: importedSourceId,
            nativeProjectPath: undefined,
            projectRootPath: undefined,
            rawArtifactRefs: (harnessRef.rawArtifactRefs ?? []).map((artifact) =>
              rebaseRawArtifactRef(artifact, importedSourceId, idMaps.rawArtifactIds)
            )
          }))
        }
      : {}),
    ...(project.sessionIds
      ? { sessionIds: mapIds(project.sessionIds, idMaps.sessionIds) }
      : {}),
    ...(project.diagnosticIds
      ? { diagnosticIds: mapIds(project.diagnosticIds, diagnosticIds) }
      : {}),
    ...(project.diagnostics
      ? {
          diagnostics: project.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              idMaps.relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  } as Project;

  delete rebasedProject.primaryRootPath;
  delete rebasedProject.rootPath;

  if (rebasedProject.harnessRefs) {
    rebasedProject.harnessRefs = rebasedProject.harnessRefs.map((harnessRef) => {
      const sanitizedHarnessRef = { ...harnessRef };

      delete sanitizedHarnessRef.nativeProjectPath;
      delete sanitizedHarnessRef.projectRootPath;
      return sanitizedHarnessRef;
    });
  }

  return rebasedProject;
}

function rebaseSession(
  session: Session,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    fileMutationIds: Map<string, string>;
    messageIds: Map<string, string>;
    outputArtifactIds: Map<string, string>;
    projectIds: Map<string, string>;
    relatedEntityIds: Map<string, string>;
    rawArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
    shellCommandIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): Session {
  const rebasedSession = {
    ...session,
    id: idMaps.sessionIds.get(session.id) ?? session.id,
    sourceId: importedSourceId
  } as Session;

  if (session.projectId) {
    rebasedSession.projectId =
      idMaps.projectIds.get(session.projectId) ?? session.projectId;
  }

  if (session.messageIds) {
    rebasedSession.messageIds = mapIds(session.messageIds, idMaps.messageIds);
  }

  if (session.eventIds) {
    rebasedSession.eventIds = mapIds(session.eventIds, idMaps.eventIds);
  }

  if (session.toolCallIds) {
    rebasedSession.toolCallIds = mapIds(session.toolCallIds, idMaps.toolCallIds);
  }

  if (session.fileMutationIds) {
    rebasedSession.fileMutationIds = mapIds(
      session.fileMutationIds,
      idMaps.fileMutationIds
    );
  }

  if (session.shellCommandIds) {
    rebasedSession.shellCommandIds = mapIds(
      session.shellCommandIds,
      idMaps.shellCommandIds
    );
  }

  if (session.parsedShellCommands) {
    rebasedSession.parsedShellCommands = session.parsedShellCommands.map((command) =>
      rebaseParsedShellCommand(
        command,
        diagnosticIds,
        idMaps.outputArtifactIds,
        idMaps.shellCommandIds,
        idMaps.toolCallIds
      )
    );
  }

  if (session.outputArtifactIds) {
    rebasedSession.outputArtifactIds = mapIds(
      session.outputArtifactIds,
      idMaps.outputArtifactIds
    );
  }

  if (session.verification) {
    rebasedSession.verification = rebaseSessionVerification(
      session.verification,
      diagnosticIds,
      idMaps.shellCommandIds
    ) as NonNullable<Session["verification"]>;
  }

  if (session.runAudit) {
    rebasedSession.runAudit = rebaseSessionRunAudit(session.runAudit, diagnosticIds, {
      messageIds: idMaps.messageIds,
      sessionIds: idMaps.sessionIds,
      shellCommandIds: idMaps.shellCommandIds,
      toolCallIds: idMaps.toolCallIds
    }) as NonNullable<Session["runAudit"]>;
  }

  if (session.rawArtifactRefs) {
    rebasedSession.rawArtifactRefs = session.rawArtifactRefs.map((artifact) =>
      rebaseRawArtifactRef(artifact, importedSourceId, idMaps.rawArtifactIds)
    );
  }

  if (session.diagnosticIds) {
    rebasedSession.diagnosticIds = mapIds(session.diagnosticIds, diagnosticIds);
  }

  if (session.diagnostics) {
    rebasedSession.diagnostics = session.diagnostics.map((diagnostic) =>
      rebaseDiagnostic(
        diagnostic,
        diagnosticIds,
        idMaps.relatedEntityIds,
        importedSourceId
      )
    );
  }

  return rebasedSession;
}

function rebaseEvent(
  event: SessionEvent,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    relatedEntityIds: Map<string, string>;
    rawArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
  }
): SessionEvent {
  return {
    ...event,
    id: idMaps.eventIds.get(event.id) ?? event.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(event.sessionId) ?? event.sessionId,
    ...(event.raw
      ? {
          raw: rebasePointer(
            event.raw,
            importedSourceId,
            idMaps.rawArtifactIds,
            idMaps.eventIds
          )
        }
      : {}),
    ...(event.diagnosticIds
      ? { diagnosticIds: mapIds(event.diagnosticIds, diagnosticIds) }
      : {}),
    ...(event.diagnostics
      ? {
          diagnostics: event.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              idMaps.relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  };
}

function rebaseMessage(
  message: SessionMessage,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    messageIds: Map<string, string>;
    relatedEntityIds: Map<string, string>;
    rawArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): SessionMessage {
  return {
    ...message,
    id: idMaps.messageIds.get(message.id) ?? message.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(message.sessionId) ?? message.sessionId,
    ...(message.toolCallIds
      ? { toolCallIds: mapIds(message.toolCallIds, idMaps.toolCallIds) }
      : {}),
    ...(message.eventIds ? { eventIds: mapIds(message.eventIds, idMaps.eventIds) } : {}),
    ...(message.source
      ? {
          source: rebasePointer(
            message.source,
            importedSourceId,
            idMaps.rawArtifactIds,
            idMaps.eventIds
          )
        }
      : {}),
    ...(message.diagnosticIds
      ? { diagnosticIds: mapIds(message.diagnosticIds, diagnosticIds) }
      : {}),
    ...(message.diagnostics
      ? {
          diagnostics: message.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              idMaps.relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  };
}

function rebaseToolCall(
  toolCall: ToolCall,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    fileMutationIds: Map<string, string>;
    outputArtifactIds: Map<string, string>;
    relatedEntityIds: Map<string, string>;
    rawArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
    shellCommandIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): ToolCall {
  return {
    ...toolCall,
    id: idMaps.toolCallIds.get(toolCall.id) ?? toolCall.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(toolCall.sessionId) ?? toolCall.sessionId,
    ...(toolCall.outputArtifactIds
      ? {
          outputArtifactIds: mapIds(
            toolCall.outputArtifactIds,
            idMaps.outputArtifactIds
          )
        }
      : {}),
    ...(toolCall.fileMutationId
      ? {
          fileMutationId:
            idMaps.fileMutationIds.get(toolCall.fileMutationId) ??
            toolCall.fileMutationId
        }
      : {}),
    ...(toolCall.shellCommandId
      ? {
          shellCommandId:
            idMaps.shellCommandIds.get(toolCall.shellCommandId) ??
            toolCall.shellCommandId
        }
      : {}),
    ...(toolCall.source
      ? {
          source: rebasePointer(
            toolCall.source,
            importedSourceId,
            idMaps.rawArtifactIds,
            idMaps.eventIds
          )
        }
      : {}),
    ...(toolCall.diagnosticIds
      ? { diagnosticIds: mapIds(toolCall.diagnosticIds, diagnosticIds) }
      : {}),
    ...(toolCall.diagnostics
      ? {
          diagnostics: toolCall.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              idMaps.relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  };
}

function rebaseShellCommand(
  command: ShellCommandEvidence,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    outputArtifactIds: Map<string, string>;
    relatedEntityIds: Map<string, string>;
    rawArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
    shellCommandIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): ShellCommandEvidence {
  return {
    ...command,
    id: idMaps.shellCommandIds.get(command.id) ?? command.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(command.sessionId) ?? command.sessionId,
    ...(command.outputArtifactIds
      ? {
          outputArtifactIds: mapIds(
            command.outputArtifactIds,
            idMaps.outputArtifactIds
          )
        }
      : {}),
    ...(command.toolCallId
      ? { toolCallId: idMaps.toolCallIds.get(command.toolCallId) ?? command.toolCallId }
      : {}),
    ...(command.source
      ? {
          source: rebasePointer(
            command.source,
            importedSourceId,
            idMaps.rawArtifactIds,
            idMaps.eventIds
          )
        }
      : {}),
    ...(command.diagnosticIds
      ? { diagnosticIds: mapIds(command.diagnosticIds, diagnosticIds) }
      : {}),
    ...(command.diagnostics
      ? {
          diagnostics: command.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              idMaps.relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  };
}

function rebaseOutputArtifact(
  artifact: OutputArtifact,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  eventIds: Map<string, string>,
  outputArtifactIds: Map<string, string>,
  relatedEntityIds: Map<string, string>,
  rawArtifactIds: Map<string, string>,
  sessionIds: Map<string, string>
): OutputArtifact {
  const nextArtifactId = outputArtifactIds.get(artifact.id) ?? artifact.id;
  const artifactWithoutPath = { ...artifact };

  delete artifactWithoutPath.path;

  return {
    ...artifactWithoutPath,
    id: nextArtifactId,
    sourceId: importedSourceId,
    uri: `awb-archive://${encodeURIComponent(importedSourceId)}/${encodeURIComponent(nextArtifactId)}`,
    ...(artifact.sessionId
      ? { sessionId: sessionIds.get(artifact.sessionId) ?? artifact.sessionId }
      : {}),
    ...(artifact.source
      ? {
          source: rebasePointer(
            artifact.source,
            importedSourceId,
            rawArtifactIds,
            eventIds
          )
        }
      : {}),
    ...(artifact.ref
      ? {
          ref: {
            ...artifact.ref,
            sourceId: importedSourceId,
            ...(artifact.ref.id ? { id: nextArtifactId } : {}),
            ...(artifact.ref.sessionId
              ? {
                  sessionId:
                    sessionIds.get(artifact.ref.sessionId) ?? artifact.ref.sessionId
                }
              : {})
          }
        }
      : {}),
    ...(artifact.diagnosticIds
      ? { diagnosticIds: mapIds(artifact.diagnosticIds, diagnosticIds) }
      : {}),
    ...(artifact.diagnostics
      ? {
          diagnostics: artifact.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  };
}

function rebaseFileMutation(
  mutation: FileMutationEvidence,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  eventIds: Map<string, string>,
  fileMutationIds: Map<string, string>,
  relatedEntityIds: Map<string, string>,
  rawArtifactIds: Map<string, string>,
  sessionIds: Map<string, string>,
  toolCallIds: Map<string, string>
): FileMutationEvidence {
  return {
    ...mutation,
    id: fileMutationIds.get(mutation.id) ?? mutation.id,
    sourceId: importedSourceId,
    sessionId: sessionIds.get(mutation.sessionId) ?? mutation.sessionId,
    ...(mutation.toolCallId
      ? { toolCallId: toolCallIds.get(mutation.toolCallId) ?? mutation.toolCallId }
      : {}),
    ...(mutation.source
      ? {
          source: rebasePointer(
            mutation.source,
            importedSourceId,
            rawArtifactIds,
            eventIds
          )
        }
      : {}),
    ...(mutation.diagnosticIds
      ? { diagnosticIds: mapIds(mutation.diagnosticIds, diagnosticIds) }
      : {}),
    ...(mutation.diagnostics
      ? {
          diagnostics: mutation.diagnostics.map((diagnostic) =>
            rebaseDiagnostic(
              diagnostic,
              diagnosticIds,
              relatedEntityIds,
              importedSourceId
            )
          )
        }
      : {})
  };
}

function rebaseShellCommandSection(
  records: NormalizedCacheRecord[],
  diagnosticIds: Map<string, string>,
  outputArtifactIds: Map<string, string>,
  sessionIds: Map<string, string>,
  shellCommandIds: Map<string, string>,
  toolCallIds: Map<string, string>
): NormalizedCacheRecord["shellCommands"] | undefined {
  const sessions = dedupeByKey(
    records.flatMap((record) => record.shellCommands?.sessions ?? []).map((session) => ({
      sessionId: sessionIds.get(session.sessionId) ?? session.sessionId,
      shellCommands: session.shellCommands.map((command) =>
        rebaseParsedShellCommand(
          command,
          diagnosticIds,
          outputArtifactIds,
          shellCommandIds,
          toolCallIds
        )
      )
    })),
    (session) => session.sessionId
  );

  if (sessions.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    sessions
  };
}

function rebaseVerificationResultsSection(
  records: NormalizedCacheRecord[],
  diagnosticIds: Map<string, string>,
  sessionIds: Map<string, string>,
  shellCommandIds: Map<string, string>
): NormalizedCacheRecord["verificationResults"] | undefined {
  const sessions = dedupeByKey(
    records.flatMap((record) => record.verificationResults?.sessions ?? []).map((session) => ({
      sessionId: sessionIds.get(session.sessionId) ?? session.sessionId,
      verification: rebaseVerificationResult(
        session.verification,
        diagnosticIds,
        shellCommandIds
      )
    })),
    (session) => session.sessionId
  );

  if (sessions.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    sessions
  };
}

function rebaseRunAuditsSection(
  records: NormalizedCacheRecord[],
  diagnosticIds: Map<string, string>,
  messageIds: Map<string, string>,
  sessionIds: Map<string, string>,
  shellCommandIds: Map<string, string>,
  toolCallIds: Map<string, string>
): NormalizedCacheRecord["runAudits"] | undefined {
  const sessions = dedupeByKey(
    records.flatMap((record) => record.runAudits?.sessions ?? []).map((session) => ({
      sessionId: sessionIds.get(session.sessionId) ?? session.sessionId,
      audit: rebaseRunAuditResult(session.audit, diagnosticIds, {
        messageIds,
        shellCommandIds,
        toolCallIds
      })
    })),
    (session) => session.sessionId
  );

  if (sessions.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    sessions
  };
}

function rebaseGitSnapshotsSection(
  records: NormalizedCacheRecord[],
  diagnosticIds: Map<string, string>,
  projectIds: Map<string, string>
): NormalizedCacheRecord["gitSnapshots"] | undefined {
  const projects = dedupeByKey(
    records.flatMap((record) => record.gitSnapshots?.projects ?? []).map((project) => ({
      projectId: projectIds.get(project.projectId) ?? project.projectId,
      git: {
        ...project.git,
        diagnosticIds: mapIds(project.git.diagnosticIds, diagnosticIds)
      }
    })),
    (project) => project.projectId
  );

  if (projects.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    projects
  };
}

function rebaseGitHubSnapshotsSection(
  records: NormalizedCacheRecord[],
  diagnosticIds: Map<string, string>,
  projectIds: Map<string, string>
): NormalizedCacheRecord["githubSnapshots"] | undefined {
  const projects = dedupeByKey(
    records.flatMap((record) => record.githubSnapshots?.projects ?? []).map((project) => ({
      projectId: projectIds.get(project.projectId) ?? project.projectId,
      github: {
        ...project.github,
        diagnosticIds: mapIds(project.github.diagnosticIds, diagnosticIds)
      }
    })),
    (project) => project.projectId
  );

  if (projects.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    projects
  };
}

function rebaseRawArtifactIndexSection(
  records: NormalizedCacheRecord[],
  importedSourceId: string,
  rawArtifactIds: Map<string, string>,
  materializedRawArtifactPaths: Map<string, string>
): NormalizedCacheRecord["rawArtifactIndex"] | undefined {
  const entries = dedupeByKey(
    records.flatMap((record) => record.rawArtifactIndex?.entries ?? []).map((entry) => {
      const materializedPath = materializedRawArtifactPaths.get(entry.id);
      const rebasedEntry = {
        ...entry,
        id: rawArtifactIds.get(entry.id) ?? entry.id,
        sourceId: importedSourceId
      };

      delete rebasedEntry.path;

      return materializedPath
        ? {
            ...rebasedEntry,
            path: materializedPath
          }
        : rebasedEntry;
    }),
    (entry) => entry.id
  );

  if (entries.length === 0) {
    return undefined;
  }

  return {
    version: 1,
    entries
  };
}

function rebaseParsedShellCommand(
  command: ParsedShellCommand,
  diagnosticIds: Map<string, string>,
  outputArtifactIds: Map<string, string>,
  shellCommandIds: Map<string, string>,
  toolCallIds: Map<string, string>
): ParsedShellCommand {
  return {
    ...command,
    shellCommandId:
      shellCommandIds.get(command.shellCommandId) ?? command.shellCommandId,
    ...(command.toolCallId
      ? { toolCallId: toolCallIds.get(command.toolCallId) ?? command.toolCallId }
      : {}),
    ...(command.artifactIds
      ? { artifactIds: mapIds(command.artifactIds, outputArtifactIds) }
      : {}),
    ...(command.diagnosticIds
      ? { diagnosticIds: mapIds(command.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseVerificationResult(
  verification: VerificationResult,
  diagnosticIds: Map<string, string>,
  shellCommandIds: Map<string, string>
): VerificationResult {
  return {
    ...verification,
    commandIds: mapIds(verification.commandIds, shellCommandIds),
    intentResults: verification.intentResults.map((result) => ({
      ...result,
      latestCommandId:
        shellCommandIds.get(result.latestCommandId) ?? result.latestCommandId,
      commandIds: mapIds(result.commandIds, shellCommandIds),
      ...(result.diagnosticIds
        ? { diagnosticIds: mapIds(result.diagnosticIds, diagnosticIds) }
        : {})
    })),
    ...(verification.diagnosticIds
      ? { diagnosticIds: mapIds(verification.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseRunAuditResult(
  audit: RunAuditResult,
  diagnosticIds: Map<string, string>,
  idMaps: {
    messageIds: Map<string, string>;
    shellCommandIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): RunAuditResult {
  return {
    ...audit,
    supportingCommandIds: mapIds(audit.supportingCommandIds, idMaps.shellCommandIds),
    supportingToolCallIds: mapIds(audit.supportingToolCallIds, idMaps.toolCallIds),
    supportingMessageIds: mapIds(audit.supportingMessageIds, idMaps.messageIds),
    ...(audit.diagnosticIds
      ? { diagnosticIds: mapIds(audit.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseSessionVerification(
  verification: NonNullable<Session["verification"]>,
  diagnosticIds: Map<string, string>,
  shellCommandIds: Map<string, string>
) {
  if (!("commandIds" in verification) || !Array.isArray(verification.commandIds)) {
    const legacyVerification = verification as {
      failedCommandIds?: string[];
      passedCommandIds?: string[];
    };

    return {
      ...verification,
      ...(legacyVerification.failedCommandIds
        ? {
            failedCommandIds: mapIds(
              legacyVerification.failedCommandIds,
              shellCommandIds
            )
          }
        : {}),
      ...(legacyVerification.passedCommandIds
        ? {
            passedCommandIds: mapIds(
              legacyVerification.passedCommandIds,
              shellCommandIds
            )
          }
        : {})
    } as Session["verification"];
  }

  return {
    ...verification,
    commandIds: mapIds(verification.commandIds, shellCommandIds),
    intentResults: verification.intentResults.map((result) => ({
      ...result,
      latestCommandId:
        shellCommandIds.get(result.latestCommandId) ?? result.latestCommandId,
      commandIds: mapIds(result.commandIds, shellCommandIds),
      ...(result.diagnosticIds
        ? { diagnosticIds: mapIds(result.diagnosticIds, diagnosticIds) }
        : {})
    })),
    ...(verification.diagnosticIds
      ? { diagnosticIds: mapIds(verification.diagnosticIds, diagnosticIds) }
      : {})
  } as Session["verification"];
}

function rebaseSessionRunAudit(
  runAudit: NonNullable<Session["runAudit"]>,
  diagnosticIds: Map<string, string>,
  idMaps: {
    sessionIds: Map<string, string>;
    messageIds: Map<string, string>;
    shellCommandIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
) {
  if (
    !("supportingCommandIds" in runAudit) ||
    !Array.isArray(runAudit.supportingCommandIds)
  ) {
    const legacyRunAudit = runAudit as { sessionId?: string };

    return {
      ...runAudit,
      ...(legacyRunAudit.sessionId
        ? {
            sessionId:
              idMaps.sessionIds.get(legacyRunAudit.sessionId) ??
              legacyRunAudit.sessionId
          }
        : {})
    } as Session["runAudit"];
  }

  return {
    ...runAudit,
    supportingCommandIds: mapIds(
      runAudit.supportingCommandIds,
      idMaps.shellCommandIds
    ),
    supportingToolCallIds: mapIds(
      runAudit.supportingToolCallIds,
      idMaps.toolCallIds
    ),
    supportingMessageIds: mapIds(
      runAudit.supportingMessageIds,
      idMaps.messageIds
    ),
    ...(runAudit.diagnosticIds
      ? { diagnosticIds: mapIds(runAudit.diagnosticIds, diagnosticIds) }
      : {})
  } as Session["runAudit"];
}

function buildIdMap<T extends { id: string }>(
  entities: T[],
  createId: (entity: T) => string
): Map<string, string> {
  return new Map(entities.map((entity) => [entity.id, createId(entity)] as const));
}

function buildRawArtifactIdMap(
  normalized: AdapterNormalizationResult,
  cacheRecords: NormalizedCacheRecord[],
  importedSourceId: string
): Map<string, string> {
  const artifacts = [
    ...normalized.projects.flatMap((project) =>
      (project.harnessRefs ?? []).flatMap((harnessRef) => harnessRef.rawArtifactRefs ?? [])
    ),
    ...normalized.sessions.flatMap((session) => session.rawArtifactRefs ?? []),
    ...cacheRecords.flatMap((record) => record.rawArtifactIndex?.entries ?? [])
  ];

  return new Map(
    artifacts.map((artifact) => [
      artifact.id,
      createRawArtifactId({
        adapterId: artifact.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedArtifactNativeId(artifact)
      })
    ])
  );
}

function buildRebasedArchiveIds(args: {
  cacheRecords: NormalizedCacheRecord[];
  importedSourceId: string;
}): {
  mergedNormalized: AdapterNormalizationResult;
  rawArtifactIds: Map<string, string>;
} {
  const mergedNormalized = mergeNormalizedResults(
    args.cacheRecords.map((record) => record.normalized)
  );

  if (!mergedNormalized) {
    throw new ArchiveImportError(
      "archive-import.empty-payload",
      "Archive does not contain any cached normalized data to import."
    );
  }

  return {
    mergedNormalized,
    rawArtifactIds: buildRawArtifactIdMap(
      mergedNormalized,
      args.cacheRecords,
      args.importedSourceId
    )
  };
}

function buildDiagnosticIdMap(
  normalizedDiagnostics: Diagnostic[],
  sourceDiagnostics: Diagnostic[],
  importedSourceId: string
): Map<string, string> {
  const diagnostics = dedupeByKey(
    [...normalizedDiagnostics, ...sourceDiagnostics],
    (diagnostic) => diagnostic.id
  );

  return new Map(
    diagnostics.map((diagnostic) => [
      diagnostic.id,
      createDiagnosticId({
        adapterId: diagnostic.adapterId,
        sourceId: importedSourceId,
        nativeId: diagnostic.id
      })
    ])
  );
}

function collectNormalizedDiagnostics(
  normalized: AdapterNormalizationResult
): Diagnostic[] {
  return [
    ...normalized.diagnostics,
    ...normalized.projects.flatMap((project) => project.diagnostics ?? []),
    ...normalized.sessions.flatMap((session) => session.diagnostics ?? []),
    ...normalized.events.flatMap((event) => event.diagnostics ?? []),
    ...normalized.messages.flatMap((message) => message.diagnostics ?? []),
    ...normalized.toolCalls.flatMap((toolCall) => toolCall.diagnostics ?? []),
    ...normalized.shellCommands.flatMap((command) => command.diagnostics ?? []),
    ...normalized.outputArtifacts.flatMap((artifact) => artifact.diagnostics ?? []),
    ...normalized.fileMutations.flatMap((mutation) => mutation.diagnostics ?? [])
  ];
}

function rebaseDiagnostic(
  diagnostic: Diagnostic,
  diagnosticIds: Map<string, string>,
  relatedEntityIds: Map<string, string>,
  importedSourceId: string
): Diagnostic {
  return {
    id: diagnosticIds.get(diagnostic.id) ?? diagnostic.id,
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    scope: diagnostic.scope,
    adapterId: diagnostic.adapterId,
    ...(diagnostic.sourceId !== undefined ? { sourceId: importedSourceId } : {}),
    ...(diagnostic.relatedEntityIds !== undefined
      ? { relatedEntityIds: mapIds(diagnostic.relatedEntityIds, relatedEntityIds) }
      : {}),
    confidence: diagnostic.confidence,
    ...(diagnostic.metadata !== undefined ? { metadata: diagnostic.metadata } : {})
  };
}

function rebaseRawArtifactRef<
  T extends {
    adapterId: string;
    id: string;
    sourceId: string;
    nativeId?: string | undefined;
    nativeRef?: string | undefined;
    path?: string | undefined;
  }
>(
  artifact: T,
  importedSourceId: string,
  rawArtifactIds: Map<string, string>
): T {
  return {
    ...stripPathProvenance(artifact),
    id: rawArtifactIds.get(artifact.id) ?? artifact.id,
    nativeRef: rawArtifactIds.get(artifact.id) ?? artifact.id,
    sourceId: importedSourceId
  } as T;
}

function rebasePointer<
  T extends {
    artifactId?: string | undefined;
    artifactPath?: string | undefined;
    eventId?: string | undefined;
    nativeRef?: string | undefined;
    path?: string | undefined;
    rawEvent?: RawEventPointer | undefined;
    rawArtifactId?: string | undefined;
    sourceId?: string | undefined;
  }
>(
  pointer: T,
  importedSourceId: string,
  rawArtifactIds: Map<string, string>,
  eventIds?: Map<string, string>
): T {
  return {
    ...stripPathProvenance(pointer),
    ...(pointer.sourceId !== undefined ? { sourceId: importedSourceId } : {}),
    ...(pointer.artifactId
      ? { artifactId: rawArtifactIds.get(pointer.artifactId) ?? pointer.artifactId }
      : {}),
    ...(pointer.eventId
      ? { eventId: eventIds?.get(pointer.eventId) ?? pointer.eventId }
      : {}),
    ...(pointer.rawEvent
      ? {
          rawEvent: rebasePointer(
            pointer.rawEvent,
            importedSourceId,
            rawArtifactIds,
            eventIds
          )
        }
      : {}),
    ...(pointer.rawArtifactId
      ? {
          rawArtifactId:
            rawArtifactIds.get(pointer.rawArtifactId) ?? pointer.rawArtifactId
        }
      : {})
  } as T;
}

function stripPathProvenance<
  T extends {
    artifactPath?: string | undefined;
    nativeRef?: string | undefined;
    path?: string | undefined;
  }
>(value: T): Omit<T, "artifactPath" | "nativeRef" | "path"> {
  const {
    artifactPath: _artifactPath,
    nativeRef: _nativeRef,
    path: _path,
    ...rest
  } = value;

  return rest;
}

function mapIds(ids: string[], idMap: Map<string, string>): string[] {
  return ids.map((id) => idMap.get(id) ?? id);
}

function buildImportedNativeId(entity: {
  id: string;
  nativeId?: string;
  sourceId?: string;
}): string {
  if (entity.sourceId && entity.nativeId) {
    return `${entity.sourceId}:${entity.nativeId}`;
  }

  return entity.id;
}

function buildImportedArtifactNativeId(artifact: {
  id: string;
  nativeId?: string | undefined;
  nativeRef?: string | undefined;
  path?: string | undefined;
  sourceId?: string | undefined;
}): string {
  const nativeId = artifact.nativeId ?? artifact.nativeRef ?? artifact.path;

  if (artifact.sourceId && nativeId) {
    return `${artifact.sourceId}:${nativeId}`;
  }

  return artifact.id;
}

function buildMaterializedArtifactPath(
  sourceRootPath: string,
  artifact: ArchivedRawArtifact | ArchivedRawArtifactMetadata,
  rebasedArtifactId: string
): string {
  const artifactDirectory = sanitizePathSegment(artifact.artifactKind) || "unknown";
  const originalName = artifact.originalPath
    ? path.basename(artifact.originalPath)
    : undefined;
  const fallbackName = artifact.nativeRef
    ? path.basename(artifact.nativeRef)
    : path.basename(artifact.nativeId);
  const fileNameBase =
    sanitizePathSegment(originalName ?? fallbackName) || "artifact.txt";

  return path.join(
    sourceRootPath,
    artifactDirectory,
    `${buildHash(rebasedArtifactId)}-${fileNameBase}`
  );
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function buildHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Map<string, T>();

  for (const item of items) {
    seen.set(getKey(item), item);
  }

  return [...seen.values()];
}
