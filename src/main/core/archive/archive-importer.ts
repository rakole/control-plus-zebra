import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
import {
  archiveLineSchema,
  type ArchiveManifest,
  type ArchivedRawArtifact,
  type ArchivedSourceRecord
} from "./archive-manifest.js";

export interface ImportArchiveInput {
  archivePath: string;
  displayName?: string;
}

export interface ImportArchiveResult {
  archivePath: string;
  manifest: ArchiveManifest;
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

interface ArchiveImporterOptions {
  appDataDir?: string;
  cacheStore: FileBackedCacheStore;
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

export class ArchiveImporter {
  readonly #appDataDir: string | undefined;
  readonly #cacheStore: FileBackedCacheStore;
  readonly #now: () => Date;
  readonly #rawArtifactIndex: RawArtifactIndex | undefined;
  readonly #sourceRegistry: SourceRegistry;

  constructor(options: ArchiveImporterOptions) {
    this.#appDataDir = options.appDataDir;
    this.#cacheStore = options.cacheStore;
    this.#now = options.now ?? (() => new Date());
    this.#rawArtifactIndex = options.rawArtifactIndex;
    this.#sourceRegistry = options.sourceRegistry;
  }

  async importArchive(input: ImportArchiveInput): Promise<ImportArchiveResult> {
    const archivePath = path.resolve(input.archivePath);
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
          sourceDiagnostics: preparedTarget.target.sourceDiagnostics,
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

        const parsed = archiveLineSchema.parse(JSON.parse(trimmed));

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
  manifest: ArchiveManifest;
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
    args.mergedNormalized.diagnostics,
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
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    events: args.mergedNormalized.events.map((event) =>
      rebaseEvent(event, diagnosticIds, args.importedSourceId, {
        eventIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds
      })
    ),
    messages: args.mergedNormalized.messages.map((message) =>
      rebaseMessage(message, diagnosticIds, args.importedSourceId, {
        eventIds,
        messageIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        toolCallIds
      })
    ),
    toolCalls: args.mergedNormalized.toolCalls.map((toolCall) =>
      rebaseToolCall(toolCall, diagnosticIds, args.importedSourceId, {
        fileMutationIds,
        outputArtifactIds,
        rawArtifactIds: args.rawArtifactIds,
        sessionIds,
        shellCommandIds,
        toolCallIds
      })
    ),
    shellCommands: args.mergedNormalized.shellCommands.map((command) =>
      rebaseShellCommand(command, diagnosticIds, args.importedSourceId, {
        outputArtifactIds,
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
        outputArtifactIds,
        args.rawArtifactIds,
        sessionIds
      )
    ),
    fileMutations: args.mergedNormalized.fileMutations.map((mutation) =>
      rebaseFileMutation(
        mutation,
        diagnosticIds,
        args.importedSourceId,
        fileMutationIds,
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
    }
  };
}

function rebaseProject(
  project: Project,
  diagnosticIds: Map<string, string>,
  importedSourceId: string,
  idMaps: {
    projectIds: Map<string, string>;
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
              new Map<string, string>(),
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
        new Map<string, string>(),
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
      ? { raw: rebasePointer(event.raw, importedSourceId, idMaps.rawArtifactIds) }
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
              new Map<string, string>(),
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
      ? { source: rebasePointer(message.source, importedSourceId, idMaps.rawArtifactIds) }
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
              new Map<string, string>(),
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
    fileMutationIds: Map<string, string>;
    outputArtifactIds: Map<string, string>;
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
      ? { source: rebasePointer(toolCall.source, importedSourceId, idMaps.rawArtifactIds) }
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
              new Map<string, string>(),
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
    outputArtifactIds: Map<string, string>;
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
      ? { source: rebasePointer(command.source, importedSourceId, idMaps.rawArtifactIds) }
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
              new Map<string, string>(),
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
  outputArtifactIds: Map<string, string>,
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
      ? { source: rebasePointer(artifact.source, importedSourceId, rawArtifactIds) }
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
              new Map<string, string>(),
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
  fileMutationIds: Map<string, string>,
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
      ? { source: rebasePointer(mutation.source, importedSourceId, rawArtifactIds) }
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
              new Map<string, string>(),
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
    nativeRef?: string | undefined;
    path?: string | undefined;
    rawArtifactId?: string | undefined;
    sourceId?: string | undefined;
  }
>(
  pointer: T,
  importedSourceId: string,
  rawArtifactIds: Map<string, string>
): T {
  return {
    ...stripPathProvenance(pointer),
    ...(pointer.sourceId !== undefined ? { sourceId: importedSourceId } : {}),
    ...(pointer.artifactId
      ? { artifactId: rawArtifactIds.get(pointer.artifactId) ?? pointer.artifactId }
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
  artifact: ArchivedRawArtifact,
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
