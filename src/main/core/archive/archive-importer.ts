import { createHash } from "node:crypto";
import path from "node:path";

import type { AdapterNormalizationResult } from "../adapter-contract/types.js";
import {
  type DerivedCacheRecord,
  type DerivedProjectCacheRecord,
  type DerivedSessionCacheRecord,
  type FileBackedCacheStore,
  type NormalizedCacheRecord
} from "../cache/file-backed-cache-store.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { mergeNormalizedResults } from "../ingestion/index.js";
import {
  createDiagnosticId,
  createFileMutationEvidenceId,
  createOutputArtifactId,
  createProjectId,
  createSessionEventId,
  createSessionId,
  createSessionMessageId,
  createShellCommandEvidenceId,
  createSourceId,
  createToolCallId
} from "../model/identifiers.js";
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
import { createSafeFilesystem } from "../security/safe-filesystem.js";
import {
  archiveDocumentSchema,
  type ArchiveDocument,
  type ArchiveManifest
} from "./archive-manifest.js";
import {
  ARCHIVE_READER_ADAPTER_ID,
  archiveReaderCapabilities
} from "./archive-reader-shared.js";

export interface ImportArchiveInput {
  archivePath: string;
  displayName?: string;
}

export interface ImportArchiveResult {
  archivePath: string;
  manifest: ArchiveManifest;
  sourceId: string;
  sourceRecord: SourceRecord;
}

export class ArchiveImportError extends Error {
  readonly code:
    | "archive-import.empty-payload"
    | "archive-import.invalid-archive";

  constructor(code: ArchiveImportError["code"], message: string) {
    super(message);
    this.name = "ArchiveImportError";
    this.code = code;
  }
}

interface ArchiveImporterOptions {
  cacheStore: FileBackedCacheStore;
  now?: () => Date;
  sourceRegistry: SourceRegistry;
}

interface RebasedArchivePayload {
  normalized: AdapterNormalizationResult;
  derived: DerivedCacheRecord | undefined;
  sourceDiagnostics: Diagnostic[];
}

export class ArchiveImporter {
  readonly #cacheStore: FileBackedCacheStore;
  readonly #now: () => Date;
  readonly #sourceRegistry: SourceRegistry;

  constructor(options: ArchiveImporterOptions) {
    this.#cacheStore = options.cacheStore;
    this.#now = options.now ?? (() => new Date());
    this.#sourceRegistry = options.sourceRegistry;
  }

  async importArchive(input: ImportArchiveInput): Promise<ImportArchiveResult> {
    const archivePath = path.resolve(input.archivePath);
    const document = await this.#readArchiveDocument(archivePath);
    const importedAt = this.#now().toISOString();
    const sourceId = createSourceId(ARCHIVE_READER_ADAPTER_ID, archivePath);
    const rebased = rebaseArchivePayload(document, sourceId);
    const previousCacheRecords = await this.#cacheStore.load();
    const nextRecord = buildImportedCacheRecord({
      archivePath,
      importedAt,
      manifest: document.manifest,
      payload: rebased,
      sourceId
    }) as NormalizedCacheRecord;
    const nextCacheRecords = previousCacheRecords.filter(
      (record) => record.sourceId !== sourceId
    );

    nextCacheRecords.push(nextRecord as NormalizedCacheRecord);
    await this.#cacheStore.save(nextCacheRecords);

    const previousSource = await this.#sourceRegistry.getSource(sourceId);
    const sourceRecord = buildImportedSourceRecord({
      archivePath,
      importedAt,
      manifest: document.manifest,
      sourceDiagnostics: rebased.sourceDiagnostics,
      sourceId,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(previousSource?.createdAt
        ? { existingCreatedAt: previousSource.createdAt }
        : {})
    });

    try {
      await this.#sourceRegistry.replaceSource(sourceRecord);
    } catch (error) {
      await this.#cacheStore.save(previousCacheRecords);
      throw error;
    }

    return {
      archivePath,
      manifest: document.manifest,
      sourceId,
      sourceRecord
    };
  }

  async #readArchiveDocument(archivePath: string): Promise<ArchiveDocument> {
    const safeFilesystem = createSafeFilesystem({
      allowedRootPaths: [archivePath]
    });

    try {
      const source = await safeFilesystem.readTextFile(archivePath);
      return archiveDocumentSchema.parse(JSON.parse(source));
    } catch {
      throw new ArchiveImportError(
        "archive-import.invalid-archive",
        "Archive is unreadable or does not match the supported harness-neutral format."
      );
    }
  }
}

function buildImportedSourceRecord(args: {
  archivePath: string;
  displayName?: string;
  existingCreatedAt?: string;
  importedAt: string;
  manifest: ArchiveManifest;
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
    adapterId: ARCHIVE_READER_ADAPTER_ID,
    displayName:
      args.displayName?.trim() || `${args.manifest.scope.label} Archive`,
    rootPath: args.archivePath,
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
  manifest: ArchiveManifest;
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
    adapterId: ARCHIVE_READER_ADAPTER_ID,
    sourceId: args.sourceId,
    artifactFingerprint: fingerprint,
    createdAt: args.importedAt,
    updatedAt: args.importedAt,
    normalized: args.payload.normalized,
    ...(args.payload.derived ? { derived: args.payload.derived } : {})
  } as NormalizedCacheRecord;
}

function rebaseArchivePayload(
  document: ArchiveDocument,
  importedSourceId: string
): RebasedArchivePayload {
  const archivedSourceDiagnostics = document.payload.sourceDiagnostics as Diagnostic[];
  const mergedNormalized = mergeNormalizedResults(
    document.payload.cacheRecords.map(
      (record) => record.normalized as AdapterNormalizationResult
    )
  );

  if (!mergedNormalized) {
    throw new ArchiveImportError(
      "archive-import.empty-payload",
      "Archive does not contain any cached normalized data to import."
    );
  }

  const projectIds = buildIdMap(
    mergedNormalized.projects,
    importedSourceId,
    (project) =>
      createProjectId({
        adapterId: project.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(project.sourceId, project.nativeId)
      })
  );
  const sessionIds = buildIdMap(
    mergedNormalized.sessions,
    importedSourceId,
    (session) =>
      createSessionId({
        adapterId: session.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(session.sourceId, session.nativeId)
      })
  );
  const eventIds = buildIdMap(
    mergedNormalized.events,
    importedSourceId,
    (event) =>
      createSessionEventId({
        adapterId: event.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(event.sourceId, event.nativeId)
      })
  );
  const messageIds = buildIdMap(
    mergedNormalized.messages,
    importedSourceId,
    (message) =>
      createSessionMessageId({
        adapterId: message.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(message.sourceId, message.nativeId)
      })
  );
  const toolCallIds = buildIdMap(
    mergedNormalized.toolCalls,
    importedSourceId,
    (toolCall) =>
      createToolCallId({
        adapterId: toolCall.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(toolCall.sourceId, toolCall.nativeId)
      })
  );
  const shellCommandIds = buildIdMap(
    mergedNormalized.shellCommands,
    importedSourceId,
    (command) =>
      createShellCommandEvidenceId({
        adapterId: command.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(command.sourceId, command.nativeId)
      })
  );
  const outputArtifactIds = buildIdMap(
    mergedNormalized.outputArtifacts,
    importedSourceId,
    (artifact) =>
      createOutputArtifactId({
        adapterId: artifact.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(artifact.sourceId, artifact.nativeId)
      })
  );
  const fileMutationIds = buildIdMap(
    mergedNormalized.fileMutations,
    importedSourceId,
    (mutation) =>
      createFileMutationEvidenceId({
        adapterId: mutation.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(mutation.sourceId, mutation.nativeId)
      })
  );
  const diagnosticIds = buildDiagnosticIdMap(
    mergedNormalized.diagnostics,
    archivedSourceDiagnostics,
    importedSourceId
  );
  const relatedEntityIds = new Map<string, string>([
    ...projectIds,
    ...sessionIds,
    ...eventIds,
    ...messageIds,
    ...toolCallIds,
    ...shellCommandIds,
    ...outputArtifactIds,
    ...fileMutationIds
  ]);

  const diagnostics: Diagnostic[] = mergedNormalized.diagnostics.map((diagnostic) =>
    rebaseDiagnostic(diagnostic, diagnosticIds, relatedEntityIds, importedSourceId)
  );
  const sourceDiagnostics: Diagnostic[] = archivedSourceDiagnostics.map((diagnostic) =>
    rebaseDiagnostic(diagnostic, diagnosticIds, relatedEntityIds, importedSourceId)
  );

  const normalized = {
    adapterId: ARCHIVE_READER_ADAPTER_ID,
    sourceId: importedSourceId,
    capabilities: {
      adapter: {
        adapterId: ARCHIVE_READER_ADAPTER_ID,
        capabilities: archiveReaderCapabilities
      },
      source: {
        adapterId: ARCHIVE_READER_ADAPTER_ID,
        sourceId: importedSourceId,
        capabilities: archiveReaderCapabilities
      },
      sessions: dedupeByKey(
        mergedNormalized.capabilities.sessions.map((capability) => ({
          adapterId: capability.adapterId,
          sourceId: importedSourceId,
          sessionId: sessionIds.get(capability.sessionId) ?? capability.sessionId,
          capabilities: capability.capabilities
        })),
        (capability) => capability.sessionId
      )
    },
    projects: mergedNormalized.projects.map((project) =>
      rebaseProject(project, diagnosticIds, importedSourceId, projectIds)
    ),
    sessions: mergedNormalized.sessions.map((session) =>
      rebaseSession(session, diagnosticIds, importedSourceId, projectIds, sessionIds)
    ),
    events: mergedNormalized.events.map((event) =>
      rebaseEvent(event, diagnosticIds, importedSourceId, {
        eventIds,
        fileMutationIds,
        messageIds,
        outputArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    messages: mergedNormalized.messages.map((message) =>
      rebaseMessage(message, diagnosticIds, importedSourceId, eventIds, sessionIds, messageIds)
    ),
    toolCalls: mergedNormalized.toolCalls.map((toolCall) =>
      rebaseToolCall(toolCall, diagnosticIds, importedSourceId, {
        eventIds,
        fileMutationIds,
        outputArtifactIds,
        sessionIds,
        toolCallIds
      })
    ),
    shellCommands: mergedNormalized.shellCommands.map((command) =>
      rebaseShellCommand(command, diagnosticIds, importedSourceId, {
        eventIds,
        outputArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    outputArtifacts: mergedNormalized.outputArtifacts.map((artifact) =>
      rebaseOutputArtifact(
        artifact,
        diagnosticIds,
        importedSourceId,
        eventIds,
        outputArtifactIds,
        sessionIds
      )
    ),
    fileMutations: mergedNormalized.fileMutations.map((mutation) =>
      rebaseFileMutation(
        mutation,
        diagnosticIds,
        importedSourceId,
        eventIds,
        fileMutationIds,
        sessionIds,
        toolCallIds
      )
    ),
    diagnostics
  } as AdapterNormalizationResult;

  return {
    normalized,
    derived: rebaseDerivedRecords(
      document.payload.cacheRecords as NormalizedCacheRecord[],
      diagnosticIds,
      outputArtifactIds,
      projectIds,
      sessionIds,
      messageIds,
      toolCallIds,
      shellCommandIds
    ),
    sourceDiagnostics
  };
}

function rebaseProject(
  project: Project,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  projectIds: Map<string, string>
): Project {
  return {
    ...project,
    id: projectIds.get(project.id) ?? project.id,
    sourceId: importedSourceId,
    ...(project.diagnosticIds
      ? { diagnosticIds: mapIds(project.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseSession(
  session: Session,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  projectIds: Map<string, string>,
  sessionIds: Map<string, string>
): Session {
  return {
    ...session,
    id: sessionIds.get(session.id) ?? session.id,
    sourceId: importedSourceId,
    ...(session.projectId
      ? { projectId: projectIds.get(session.projectId) ?? session.projectId }
      : {}),
    ...(session.diagnosticIds
      ? { diagnosticIds: mapIds(session.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseEvent(
  event: SessionEvent,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    fileMutationIds: Map<string, string>;
    messageIds: Map<string, string>;
    outputArtifactIds: Map<string, string>;
    sessionIds: Map<string, string>;
    shellCommandIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): SessionEvent {
  return {
    ...event,
    id: idMaps.eventIds.get(event.id) ?? event.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(event.sessionId) ?? event.sessionId,
    ...(event.messageId ? { messageId: idMaps.messageIds.get(event.messageId) ?? event.messageId } : {}),
    ...(event.toolCallId ? { toolCallId: idMaps.toolCallIds.get(event.toolCallId) ?? event.toolCallId } : {}),
    ...(event.shellCommandId
      ? {
          shellCommandId:
            idMaps.shellCommandIds.get(event.shellCommandId) ?? event.shellCommandId
        }
      : {}),
    ...(event.outputArtifactId
      ? {
          outputArtifactId:
            idMaps.outputArtifactIds.get(event.outputArtifactId) ?? event.outputArtifactId
        }
      : {}),
    ...(event.fileMutationId
      ? {
          fileMutationId:
            idMaps.fileMutationIds.get(event.fileMutationId) ?? event.fileMutationId
        }
      : {}),
    ...(event.diagnosticIds
      ? { diagnosticIds: mapIds(event.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseMessage(
  message: SessionMessage,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  eventIds: Map<string, string>,
  sessionIds: Map<string, string>,
  messageIds: Map<string, string>
): SessionMessage {
  return {
    ...message,
    id: messageIds.get(message.id) ?? message.id,
    sourceId: importedSourceId,
    sessionId: sessionIds.get(message.sessionId) ?? message.sessionId,
    ...(message.eventId ? { eventId: eventIds.get(message.eventId) ?? message.eventId } : {}),
    ...(message.diagnosticIds
      ? { diagnosticIds: mapIds(message.diagnosticIds, diagnosticIds) }
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
    sessionIds: Map<string, string>;
    toolCallIds: Map<string, string>;
  }
): ToolCall {
  return {
    ...toolCall,
    id: idMaps.toolCallIds.get(toolCall.id) ?? toolCall.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(toolCall.sessionId) ?? toolCall.sessionId,
    ...(toolCall.eventId ? { eventId: idMaps.eventIds.get(toolCall.eventId) ?? toolCall.eventId } : {}),
    ...(toolCall.artifactIds
      ? { artifactIds: mapIds(toolCall.artifactIds, idMaps.outputArtifactIds) }
      : {}),
    ...(toolCall.fileMutationIds
      ? { fileMutationIds: mapIds(toolCall.fileMutationIds, idMaps.fileMutationIds) }
      : {}),
    ...(toolCall.diagnosticIds
      ? { diagnosticIds: mapIds(toolCall.diagnosticIds, diagnosticIds) }
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
    ...(command.eventId ? { eventId: idMaps.eventIds.get(command.eventId) ?? command.eventId } : {}),
    ...(command.toolCallId
      ? { toolCallId: idMaps.toolCallIds.get(command.toolCallId) ?? command.toolCallId }
      : {}),
    ...(command.artifactIds
      ? { artifactIds: mapIds(command.artifactIds, idMaps.outputArtifactIds) }
      : {}),
    ...(command.diagnosticIds
      ? { diagnosticIds: mapIds(command.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseOutputArtifact(
  artifact: OutputArtifact,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  eventIds: Map<string, string>,
  outputArtifactIds: Map<string, string>,
  sessionIds: Map<string, string>
): OutputArtifact {
  const nextArtifactId = outputArtifactIds.get(artifact.id) ?? artifact.id;
  const artifactWithoutPath = { ...artifact };

  delete artifactWithoutPath.path;

  return {
    ...artifactWithoutPath,
    id: nextArtifactId,
    sourceId: importedSourceId,
    sessionId: sessionIds.get(artifact.sessionId) ?? artifact.sessionId,
    uri: `awb-archive://${encodeURIComponent(importedSourceId)}/${encodeURIComponent(nextArtifactId)}`,
    ...(artifact.eventId ? { eventId: eventIds.get(artifact.eventId) ?? artifact.eventId } : {}),
    ...(artifact.diagnosticIds
      ? { diagnosticIds: mapIds(artifact.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseFileMutation(
  mutation: FileMutationEvidence,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  eventIds: Map<string, string>,
  fileMutationIds: Map<string, string>,
  sessionIds: Map<string, string>,
  toolCallIds: Map<string, string>
): FileMutationEvidence {
  return {
    ...mutation,
    id: fileMutationIds.get(mutation.id) ?? mutation.id,
    sourceId: importedSourceId,
    sessionId: sessionIds.get(mutation.sessionId) ?? mutation.sessionId,
    ...(mutation.eventId ? { eventId: eventIds.get(mutation.eventId) ?? mutation.eventId } : {}),
    ...(mutation.toolCallId
      ? { toolCallId: toolCallIds.get(mutation.toolCallId) ?? mutation.toolCallId }
      : {}),
    ...(mutation.diagnosticIds
      ? { diagnosticIds: mapIds(mutation.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseDerivedRecords(
  records: NormalizedCacheRecord[],
  diagnosticIds: Map<string, string>,
  outputArtifactIds: Map<string, string>,
  projectIds: Map<string, string>,
  sessionIds: Map<string, string>,
  messageIds: Map<string, string>,
  toolCallIds: Map<string, string>,
  shellCommandIds: Map<string, string>
): DerivedCacheRecord | undefined {
  const sessions = dedupeByKey(
    records.flatMap((record) => record.derived?.sessions ?? []).map((session) =>
      rebaseDerivedSession(
        session,
        diagnosticIds,
        messageIds,
        outputArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      )
    ),
    (session) => session.sessionId
  );
  const projects = dedupeByKey(
    records.flatMap((record) => record.derived?.projects ?? []).map((project) =>
      rebaseDerivedProject(project, diagnosticIds, projectIds)
    ),
    (project) => project.projectId
  );

  if (sessions.length === 0 && projects.length === 0) {
    return undefined;
  }

  return {
    sessions,
    ...(projects.length > 0 ? { projects } : {})
  };
}

function rebaseDerivedSession(
  session: DerivedSessionCacheRecord,
  diagnosticIds: Map<string, string>,
  messageIds: Map<string, string>,
  outputArtifactIds: Map<string, string>,
  sessionIds: Map<string, string>,
  shellCommandIds: Map<string, string>,
  toolCallIds: Map<string, string>
): DerivedSessionCacheRecord {
  return {
    ...session,
    sessionId: sessionIds.get(session.sessionId) ?? session.sessionId,
    shellCommands: session.shellCommands.map((command) => ({
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
    })),
    ...(session.verification
      ? {
          verification: {
            ...session.verification,
            commandIds: mapIds(session.verification.commandIds, shellCommandIds),
            intentResults: session.verification.intentResults.map((result) => ({
              ...result,
              latestCommandId:
                shellCommandIds.get(result.latestCommandId) ?? result.latestCommandId,
              commandIds: mapIds(result.commandIds, shellCommandIds),
              ...(result.diagnosticIds
                ? { diagnosticIds: mapIds(result.diagnosticIds, diagnosticIds) }
                : {})
            })),
            ...(session.verification.diagnosticIds
              ? {
                  diagnosticIds: mapIds(
                    session.verification.diagnosticIds,
                    diagnosticIds
                  )
                }
              : {})
          }
        }
      : {}),
    ...(session.audit
      ? {
          audit: {
            ...session.audit,
            supportingCommandIds: mapIds(session.audit.supportingCommandIds, shellCommandIds),
            supportingToolCallIds: mapIds(
              session.audit.supportingToolCallIds,
              toolCallIds
            ),
            supportingMessageIds: mapIds(session.audit.supportingMessageIds, messageIds),
            ...(session.audit.diagnosticIds
              ? { diagnosticIds: mapIds(session.audit.diagnosticIds, diagnosticIds) }
              : {})
          }
        }
      : {})
  };
}

function rebaseDerivedProject(
  project: DerivedProjectCacheRecord,
  diagnosticIds: Map<string, string>,
  projectIds: Map<string, string>
): DerivedProjectCacheRecord {
  return {
    ...project,
    projectId: projectIds.get(project.projectId) ?? project.projectId,
    git: {
      ...project.git,
      diagnosticIds: mapIds(project.git.diagnosticIds, diagnosticIds)
    },
    ...(project.github
      ? {
          github: {
            ...project.github,
            diagnosticIds: mapIds(project.github.diagnosticIds, diagnosticIds)
          }
        }
      : {})
  };
}

function buildIdMap<T extends { id: string; adapterId: string; nativeId: string; sourceId: string }>(
  entities: T[],
  importedSourceId: string,
  createId: (entity: T, importedSourceId: string) => string
): Map<string, string> {
  return new Map(
    entities.map((entity) => [entity.id, createId(entity, importedSourceId)] as const)
  );
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

function mapIds(ids: string[], idMap: Map<string, string>): string[] {
  return ids.map((id) => idMap.get(id) ?? id);
}

function buildImportedNativeId(sourceId: string, nativeId: string): string {
  return `${sourceId}:${nativeId}`;
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
