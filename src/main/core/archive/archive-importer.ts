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
      (record) => record.normalized as unknown as AdapterNormalizationResult
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
        adapterId: project.adapterId ?? ARCHIVE_READER_ADAPTER_ID,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(project)
      })
  );
  const sessionIds = buildIdMap(
    mergedNormalized.sessions,
    importedSourceId,
    (session) =>
      createSessionId({
        adapterId: session.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(session)
      })
  );
  const eventIds = buildIdMap(
    mergedNormalized.events,
    importedSourceId,
    (event) =>
      createSessionEventId({
        adapterId: event.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(event)
      })
  );
  const messageIds = buildIdMap(
    mergedNormalized.messages,
    importedSourceId,
    (message) =>
      createSessionMessageId({
        adapterId: message.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(message)
      })
  );
  const toolCallIds = buildIdMap(
    mergedNormalized.toolCalls,
    importedSourceId,
    (toolCall) =>
      createToolCallId({
        adapterId: toolCall.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(toolCall)
      })
  );
  const shellCommandIds = buildIdMap(
    mergedNormalized.shellCommands,
    importedSourceId,
    (command) =>
      createShellCommandEvidenceId({
        adapterId: command.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(command)
      })
  );
  const outputArtifactIds = buildIdMap(
    mergedNormalized.outputArtifacts,
    importedSourceId,
    (artifact) =>
      createOutputArtifactId({
        adapterId: artifact.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(artifact)
      })
  );
  const fileMutationIds = buildIdMap(
    mergedNormalized.fileMutations,
    importedSourceId,
    (mutation) =>
      createFileMutationEvidenceId({
        adapterId: mutation.adapterId,
        sourceId: importedSourceId,
        nativeId: buildImportedNativeId(mutation)
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
      rebaseProject(
        project,
        diagnosticIds,
        importedSourceId,
        projectIds,
        sessionIds
      )
    ),
    sessions: mergedNormalized.sessions.map((session) =>
      rebaseSession(session, diagnosticIds, importedSourceId, {
        messageIds,
        outputArtifactIds,
        projectIds,
        sessionIds,
        shellCommandIds,
        toolCallIds,
        eventIds,
        fileMutationIds
      })
    ),
    events: mergedNormalized.events.map((event) =>
      rebaseEvent(event, diagnosticIds, importedSourceId, {
        eventIds,
        sessionIds
      })
    ),
    messages: mergedNormalized.messages.map((message) =>
      rebaseMessage(
        message,
        diagnosticIds,
        importedSourceId,
        eventIds,
        sessionIds,
        messageIds,
        toolCallIds
      )
    ),
    toolCalls: mergedNormalized.toolCalls.map((toolCall) =>
      rebaseToolCall(toolCall, diagnosticIds, importedSourceId, {
        fileMutationIds,
        outputArtifactIds,
        sessionIds,
        shellCommandIds,
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
        outputArtifactIds,
        sessionIds
      )
    ),
    fileMutations: mergedNormalized.fileMutations.map((mutation) =>
      rebaseFileMutation(
        mutation,
        diagnosticIds,
        importedSourceId,
        fileMutationIds,
        sessionIds,
        toolCallIds
      )
    ),
    diagnostics
      } as unknown as AdapterNormalizationResult;

  return {
    normalized,
    derived: rebaseDerivedRecords(
      document.payload.cacheRecords as unknown as NormalizedCacheRecord[],
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
  projectIds: Map<string, string>,
  sessionIds: Map<string, string>
): Project {
  return {
    ...project,
    id: projectIds.get(project.id) ?? project.id,
    sourceId: importedSourceId,
    ...(project.sessionIds
      ? { sessionIds: mapIds(project.sessionIds, sessionIds) }
      : {}),
    ...(project.diagnosticIds
      ? { diagnosticIds: mapIds(project.diagnosticIds, diagnosticIds) }
      : {})
  };
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
      sessionIds: idMaps.sessionIds,
      messageIds: idMaps.messageIds,
      shellCommandIds: idMaps.shellCommandIds,
      toolCallIds: idMaps.toolCallIds
    }) as NonNullable<Session["runAudit"]>;
  }

  if (session.diagnosticIds) {
    rebasedSession.diagnosticIds = mapIds(session.diagnosticIds, diagnosticIds);
  }

  return rebasedSession;
}

function rebaseEvent(
  event: SessionEvent,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    eventIds: Map<string, string>;
    sessionIds: Map<string, string>;
  }
): SessionEvent {
  return {
    ...event,
    id: idMaps.eventIds.get(event.id) ?? event.id,
    sourceId: importedSourceId,
    sessionId: idMaps.sessionIds.get(event.sessionId) ?? event.sessionId,
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
  messageIds: Map<string, string>,
  toolCallIds: Map<string, string>
): SessionMessage {
  return {
    ...message,
    id: messageIds.get(message.id) ?? message.id,
    sourceId: importedSourceId,
    sessionId: sessionIds.get(message.sessionId) ?? message.sessionId,
    ...(message.toolCallIds
      ? { toolCallIds: mapIds(message.toolCallIds, toolCallIds) }
      : {}),
    ...(message.eventIds ? { eventIds: mapIds(message.eventIds, eventIds) } : {}),
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
    fileMutationIds: Map<string, string>;
    outputArtifactIds: Map<string, string>;
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
    ...(command.diagnosticIds
      ? { diagnosticIds: mapIds(command.diagnosticIds, diagnosticIds) }
      : {})
  };
}

function rebaseOutputArtifact(
  artifact: OutputArtifact,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
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
    uri: `awb-archive://${encodeURIComponent(importedSourceId)}/${encodeURIComponent(nextArtifactId)}`,
    ...(artifact.sessionId
      ? { sessionId: sessionIds.get(artifact.sessionId) ?? artifact.sessionId }
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
      : {})
  };
}

function rebaseFileMutation(
  mutation: FileMutationEvidence,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  fileMutationIds: Map<string, string>,
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

function buildIdMap<T extends { id: string; adapterId?: string; nativeId?: string; sourceId?: string }>(
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
