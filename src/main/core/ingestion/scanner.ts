import { createHash } from "node:crypto";

import type { SessionSourceAdapter } from "../adapter-contract/session-source-adapter.js";
import type {
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  RawHarnessEvent
} from "../adapter-contract/types.js";
import type { FileBackedCacheStore, NormalizedCacheRecord } from "../cache/file-backed-cache-store.js";
import { createCacheKey } from "../cache/cache-keys.js";
import { buildDiagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../model/confidence.js";
import { createSourceId } from "../model/identifiers.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { createSafeFilesystem, type SafeFilesystem } from "../security/safe-filesystem.js";
import type { RawArtifactIndex } from "./raw-artifact-index.js";
import { createRawArtifactIndexEntries, fingerprintEntries, RAW_ARTIFACT_SCHEMA_VERSION } from "./raw-artifact-index.js";
import { validateNormalizedResult, NORMALIZATION_SCHEMA_VERSION } from "./normalization-validator.js";
import { mergeNormalizedResults } from "./session-merger.js";
import type { AdapterRegistry } from "../registry/adapter-registry.js";
import type { SourceRecord, SourceRegistry } from "../registry/source-registry.js";
import type { WatchOrchestrator } from "../watcher/watch-orchestrator.js";
import { parseShellCommandEvidence } from "../shell/shell-command-parser.js";
import type { LoadedArtifactDiagnostics } from "../shell/types.js";
import { deriveVerificationForSession } from "../verification/verification-classifier.js";
import { deriveRunAuditForSession } from "../audit/run-audit-engine.js";
import { GitSnapshotProvider, type ProjectGitSnapshotResult } from "../git/git-snapshot-provider.js";
import { GitHubSnapshotProvider } from "../github/github-snapshot-provider.js";
import type { Project } from "../model/entities.js";

export interface ScannerOptions {
  adapterRegistry: AdapterRegistry;
  cacheStore: FileBackedCacheStore;
  githubSnapshotProvider?: GitHubSnapshotProvider;
  gitSnapshotProvider?: GitSnapshotProvider;
  projectDir: string;
  rawArtifactIndex: RawArtifactIndex;
  sourceRegistry: SourceRegistry;
  watchOrchestrator: WatchOrchestrator;
}

export interface SourceValidationExecution {
  source: SourceRecord;
}

export interface SourceScanExecution {
  cachedRecord?: NormalizedCacheRecord;
  source: SourceRecord;
}

type RuntimeAdapterContext = AdapterContext & { safeFilesystem: SafeFilesystem };

export class Scanner {
  readonly #adapterRegistry: AdapterRegistry;
  readonly #cacheStore: FileBackedCacheStore;
  readonly #githubSnapshotProvider: GitHubSnapshotProvider;
  readonly #gitSnapshotProvider: GitSnapshotProvider;
  readonly #projectDir: string;
  readonly #rawArtifactIndex: RawArtifactIndex;
  readonly #sourceRegistry: SourceRegistry;
  readonly #watchOrchestrator: WatchOrchestrator;

  constructor(options: ScannerOptions) {
    this.#adapterRegistry = options.adapterRegistry;
    this.#cacheStore = options.cacheStore;
    this.#githubSnapshotProvider = options.githubSnapshotProvider ?? new GitHubSnapshotProvider();
    this.#gitSnapshotProvider = options.gitSnapshotProvider ?? new GitSnapshotProvider();
    this.#projectDir = options.projectDir;
    this.#rawArtifactIndex = options.rawArtifactIndex;
    this.#sourceRegistry = options.sourceRegistry;
    this.#watchOrchestrator = options.watchOrchestrator;
  }

  async validateSource(sourceId: string): Promise<SourceValidationExecution> {
    const source = await this.requireSource(sourceId);
    const adapter = this.#adapterRegistry.require(source.adapterId);
    const context = this.createContext({
      allowedRootPaths: [source.rootPath]
    });

    await this.#sourceRegistry.saveValidationSummary(source.sourceId, {
      status: "validating",
      diagnostics: source.validation.diagnostics
    });

    const validation = await adapter.validateSourceRoot(
      {
        rootPath: source.rootPath,
        ...(source.displayName ? { displayName: source.displayName } : {})
      },
      context
    );
    let nextSource = source;
    const normalizedPath = validation.normalizedPath ?? source.rootPath;
    const nextSourceId = createSourceIdentity(adapter, normalizedPath);

    if (nextSource.sourceId !== nextSourceId) {
      nextSource = await this.#sourceRegistry.replaceSourceIdentity(source.sourceId, nextSourceId);
    }

    nextSource = await this.#sourceRegistry.updateSource({
      sourceId: nextSource.sourceId,
      rootPath: normalizedPath
    });
    nextSource = await this.#sourceRegistry.saveValidationSummary(nextSource.sourceId, {
      status: toValidationStatus(validation.ok, validation.capabilities?.sourceValidation.status),
      diagnostics: validation.diagnostics,
      ...(validation.normalizedPath ? { normalizedPath: validation.normalizedPath } : {})
    });

    return {
      source: nextSource
    };
  }

  async reconcileSource(sourceId: string): Promise<SourceRecord> {
    const source = await this.requireSource(sourceId);

    if (source.validation.status !== "valid") {
      return source;
    }

    const adapter = this.#adapterRegistry.require(source.adapterId);
    const validationContext = this.createContext({
      allowedRootPaths: [source.rootPath]
    });
    const discoveredSources = await collectAsync(
      adapter.discoverSources(
        {
          rootPath: source.rootPath,
          ...(source.displayName ? { displayName: source.displayName } : {})
        },
        validationContext
      )
    );
    const discoveredSource = discoveredSources[0];

    if (!discoveredSource) {
      return source;
    }

    const artifactContext = this.createContext({
      allowedRootPaths: [source.rootPath]
    });
    const artifacts = await collectAsync(adapter.discoverArtifacts(discoveredSource, artifactContext));
    const diagnosticsHash = createDiagnosticsHash(source.diagnostics);
    const indexEntries = createRawArtifactIndexEntries({
      adapterVersion: adapter.descriptor.adapterVersion,
      artifacts,
      diagnosticsHash,
      parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
      schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
    });
    const change = await this.#rawArtifactIndex.hasSourceChanged(source.sourceId, indexEntries);

    if (!change.changed) {
      return source;
    }

    const staleReason = "Source contents changed since the last cached scan.";

    await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
      status: "stale",
      diagnostics: source.diagnostics,
      reason: staleReason
    });

    return (
      await this.#sourceRegistry.saveScanSummary(source.sourceId, {
        ...source.scan,
        status: source.scan.status === "never-scanned" ? "never-scanned" : "stale",
        diagnostics: source.diagnostics,
        reason: staleReason
      })
    );
  }

  async scanSource(sourceId: string): Promise<SourceScanExecution> {
    const source = await this.requireSource(sourceId);

    if (!source.enabled) {
      throw new Error("Disabled sources cannot be scanned.");
    }

    if (source.validation.status !== "valid") {
      throw new Error("Sources must validate before scanning.");
    }

    const adapter = this.#adapterRegistry.require(source.adapterId);
    const validationContext = this.createContext({
      allowedRootPaths: [source.rootPath]
    });
    const configuredRoot = {
      rootPath: source.rootPath,
      ...(source.displayName ? { displayName: source.displayName } : {})
    };

    await this.#sourceRegistry.saveScanSummary(source.sourceId, {
      status: "scanning",
      diagnostics: source.diagnostics
    });

    try {
      const discoveredSources = await collectAsync(
        adapter.discoverSources(configuredRoot, validationContext)
      );

      if (discoveredSources.length === 0) {
        const missingSourceDiagnostic = buildDiagnostic(
          adapter.descriptor.id,
          "scanner.source.missing",
          "The adapter did not discover any sources for the configured root.",
          "error",
          "source",
          HIGH_CONFIDENCE,
          {
            sourceId: source.sourceId,
            nativeId: source.rootPath
          }
        );
        const nextSource = await this.#sourceRegistry.saveScanSummary(source.sourceId, {
          status: "scan-failed",
          diagnostics: [missingSourceDiagnostic]
        });

        await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
          status: "unknown",
          diagnostics: [missingSourceDiagnostic]
        });

        return {
          source: nextSource
        };
      }

      const normalizedResults = [];
      let scanDiagnostics = [...source.validation.diagnostics];
      let totalArtifacts = 0;
      let totalSessions = 0;
      let cacheRecord: NormalizedCacheRecord | undefined;

      for (const discoveredSource of discoveredSources) {
        const discoveryContext = this.createContext({
          allowedRootPaths: [discoveredSource.rootPath]
        });
        const artifacts = await collectAsync(
          adapter.discoverArtifacts(discoveredSource, discoveryContext)
        );
        totalArtifacts += artifacts.length;
        const artifactPaths = artifacts.flatMap((artifact) => (artifact.path ? [artifact.path] : []));
        const parseContext = this.createContext({
          allowedArtifactPaths: artifactPaths,
          allowedRootPaths: [discoveredSource.rootPath]
        });
        const artifactsWithMetadata: RawArtifactRef[] = await Promise.all(
          artifacts.map(async (artifact) => {
            if (!artifact.path) {
              return artifact;
            }

            const fileStat = await parseContext.safeFilesystem.statPath(artifact.path);

            return applySafeArtifactMetadata(artifact, fileStat);
          })
        );
        const rawEvents = await collectRawEvents(adapter, artifactsWithMetadata, parseContext);
        const normalized = await adapter.normalize(
          {
            source: discoveredSource,
            artifacts: artifactsWithMetadata,
            rawEvents
          },
          parseContext
        );
        const validation = validateNormalizedResult(normalized);

        if (!validation.ok) {
          scanDiagnostics = [...scanDiagnostics, ...validation.diagnostics];
          continue;
        }

        const watchRecord = await this.#watchOrchestrator.planForSource(
          adapter,
          discoveredSource,
          parseContext
        );

        await this.#sourceRegistry.saveWatchSummary(source.sourceId, {
          status: watchRecord.status,
          ...(watchRecord.reason ? { reason: watchRecord.reason } : {}),
          strategy: watchRecord.strategy
        });

        const shellDerivation = await deriveShellSessions({
          adapter,
          context: parseContext,
          normalized
        });
        const normalizedWithShellDiagnostics = {
          ...normalized,
          diagnostics: dedupeDiagnostics([
            ...normalized.diagnostics,
            ...shellDerivation.diagnostics
          ])
        };
        const projectGitDerivation = await deriveProjectGitSnapshots(
          normalizedWithShellDiagnostics.projects,
          this.#gitSnapshotProvider
        );
        const projectGitHubDerivation = await deriveProjectGitHubSnapshots(
          normalizedWithShellDiagnostics.projects,
          projectGitDerivation.projects,
          this.#githubSnapshotProvider
        );
        const normalizedWithDerivedDiagnostics = {
          ...normalizedWithShellDiagnostics,
          diagnostics: dedupeDiagnostics([
            ...normalizedWithShellDiagnostics.diagnostics,
            ...projectGitDerivation.diagnostics,
            ...projectGitHubDerivation.diagnostics
          ])
        };
        const indexDiagnosticsHash = createDiagnosticsHash(normalizedWithDerivedDiagnostics.diagnostics);
        const indexEntries = createRawArtifactIndexEntries({
          adapterVersion: adapter.descriptor.adapterVersion,
          artifacts: artifactsWithMetadata,
          diagnosticsHash: indexDiagnosticsHash,
          parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
          schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
        });

        await this.#rawArtifactIndex.replaceSourceEntries(source.sourceId, indexEntries);

        const artifactFingerprint = fingerprintEntries(indexEntries);
        const cacheKey = createCacheKey({
          adapterId: normalized.adapterId,
          sourceId: normalized.sourceId,
          adapterVersion: adapter.descriptor.adapterVersion,
          parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
          schemaVersion: NORMALIZATION_SCHEMA_VERSION,
          diagnosticsHash: indexDiagnosticsHash,
          artifacts: indexEntries
        });
        const now = new Date().toISOString();

      const derivedSessions = shellDerivation.sessions.map((sessionDerivation) => {
        const session = normalizedWithDerivedDiagnostics.sessions.find(
          (candidate) => candidate.id === sessionDerivation.sessionId
        );

        if (!session) {
          throw new Error(`Expected derived shell session '${sessionDerivation.sessionId}' to exist.`);
        }

        const sessionCapabilities = normalizedWithDerivedDiagnostics.capabilities.sessions.find(
          (candidate) => candidate.sessionId === session.id
        );

        const sessionEvents = normalizedWithDerivedDiagnostics.events.filter(
          (event) => event.sessionId === session.id
        );
        const sessionMessages = normalizedWithDerivedDiagnostics.messages.filter(
          (message) => message.sessionId === session.id
        );
        const sessionToolCalls = normalizedWithDerivedDiagnostics.toolCalls.filter(
          (toolCall) => toolCall.sessionId === session.id
        );
        const sessionDiagnostics = getSessionDiagnostics(
          normalizedWithDerivedDiagnostics.diagnostics,
          session,
          sessionDerivation
        );
        const verification = deriveVerificationForSession({
          adapterCapabilities: normalizedWithDerivedDiagnostics.capabilities.adapter,
          parsedShellCommands: sessionDerivation.shellCommands,
          session,
          sessionMessages,
          ...(sessionCapabilities ? { sessionCapabilities } : {}),
          sourceCapabilities: normalizedWithDerivedDiagnostics.capabilities.source
        });

        return {
          ...sessionDerivation,
          verification,
          audit: deriveRunAuditForSession({
            adapterCapabilities: normalizedWithDerivedDiagnostics.capabilities.adapter,
            diagnostics: sessionDiagnostics,
            parsedShellCommands: sessionDerivation.shellCommands,
            session,
            sessionEvents,
            sessionFileMutations: normalizedWithDerivedDiagnostics.fileMutations.filter(
              (fileMutation) => fileMutation.sessionId === session.id
            ),
            sessionMessages,
            sessionToolCalls,
            verification,
            ...(sessionCapabilities ? { sessionCapabilities } : {}),
            sourceCapabilities: normalizedWithDerivedDiagnostics.capabilities.source
          })
        };
      });

      const projectSnapshots = projectGitDerivation.projects.map((projectGitSnapshot) => {
        const githubSnapshot = projectGitHubDerivation.projectsByProjectId.get(
          projectGitSnapshot.projectId
        );

        return {
          ...projectGitSnapshot,
          ...(githubSnapshot ? { github: githubSnapshot } : {})
        };
      });

      const nextCacheRecord: NormalizedCacheRecord = {
        cacheKey,
        adapterId: normalizedWithDerivedDiagnostics.adapterId,
        sourceId: normalizedWithDerivedDiagnostics.sourceId,
        artifactFingerprint,
        createdAt: now,
        updatedAt: now,
        normalized: normalizedWithDerivedDiagnostics,
        derived: {
          sessions: derivedSessions,
          projects: projectSnapshots
        }
      };
      cacheRecord = nextCacheRecord;

        await this.#cacheStore.writeRecord(nextCacheRecord);
        normalizedResults.push(normalizedWithDerivedDiagnostics);
        scanDiagnostics = [...scanDiagnostics, ...normalizedWithDerivedDiagnostics.diagnostics];
        totalSessions += normalizedWithDerivedDiagnostics.sessions.length;
      }

      const merged = mergeNormalizedResults(normalizedResults);
      const nextScanStatus =
        normalizedResults.length === 0
          ? "scan-failed"
          : scanDiagnostics.some((diagnostic) => diagnostic.severity === "error") ||
              scanDiagnostics.length > source.validation.diagnostics.length
            ? "scanned-with-diagnostics"
            : "cached";
      const nextCacheStatus =
        normalizedResults.length === 0
          ? "unknown"
          : "cached";
      const nextSource = await this.#sourceRegistry.saveScanSummary(source.sourceId, {
        status: nextScanStatus,
        diagnostics: scanDiagnostics,
        artifactCount: totalArtifacts,
        sessionCount: totalSessions
      });

      await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
        status: nextCacheStatus,
        diagnostics: scanDiagnostics,
        ...(cacheRecord ? { cacheKey: cacheRecord.cacheKey } : {})
      });

      return {
        ...(cacheRecord ? { cachedRecord: cacheRecord } : {}),
        source: merged
          ? await this.#sourceRegistry
              .getSource(source.sourceId)
              .then((record) => record ?? nextSource)
          : nextSource
      };
    } catch (error) {
      const executionFailedDiagnostic = buildDiagnostic(
        adapter.descriptor.id,
        "scanner.scan.execution-failed",
        error instanceof Error
          ? error.message
          : "The scan failed before cache persistence could complete.",
        "error",
        "source",
        HIGH_CONFIDENCE,
        {
          sourceId: source.sourceId,
          nativeId: source.rootPath
        }
      );
      const failureDiagnostics = [...source.validation.diagnostics, executionFailedDiagnostic];

      await this.#sourceRegistry.saveScanSummary(source.sourceId, {
        status: "scan-failed",
        diagnostics: failureDiagnostics
      });
      await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
        status: "unknown",
        diagnostics: failureDiagnostics
      });

      throw error;
    }
  }

  private createContext(input: {
    allowedArtifactPaths?: string[];
    allowedRootPaths: string[];
  }): RuntimeAdapterContext {
    return {
      projectDir: this.#projectDir,
      platform: process.platform,
      safeFilesystem: createSafeFilesystem({
        allowedRootPaths: input.allowedRootPaths,
        ...(input.allowedArtifactPaths ? { allowedArtifactPaths: input.allowedArtifactPaths } : {})
      })
    };
  }

  private async requireSource(sourceId: string): Promise<SourceRecord> {
    const source = await this.#sourceRegistry.getSource(sourceId);

    if (!source) {
      throw new Error(`Source '${sourceId}' is not registered.`);
    }

    return source;
  }
}

function createSourceIdentity(adapter: SessionSourceAdapter, normalizedPath: string): string {
  return createSourceId(adapter.descriptor.id, normalizedPath);
}

function toValidationStatus(
  ok: boolean,
  sourceValidationCapability?: "supported" | "unsupported" | "unknown"
) {
  if (sourceValidationCapability === "unsupported") {
    return "unsupported";
  }

  if (sourceValidationCapability === "unknown") {
    return "unknown";
  }

  return ok ? "valid" : "validation-failed";
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

async function collectRawEvents(
  adapter: SessionSourceAdapter,
  artifacts: RawArtifactRef[],
  context: AdapterContext
): Promise<RawHarnessEvent[]> {
  const rawEvents: RawHarnessEvent[] = [];

  for (const artifact of artifacts) {
    rawEvents.push(...(await collectAsync(adapter.parseArtifact(artifact, context))));
  }

  return rawEvents;
}

export function applySafeArtifactMetadata<
  TArtifact extends {
    byteLength?: number;
    inode?: number;
    mtimeMs?: number;
  }
>(artifact: TArtifact, fileStat: { byteLength?: number; inode?: number; mtimeMs: number }): TArtifact {
  return {
    ...artifact,
    ...(artifact.byteLength !== undefined
      ? { byteLength: artifact.byteLength }
      : fileStat.byteLength !== undefined
        ? { byteLength: fileStat.byteLength }
        : {}),
    ...(artifact.inode !== undefined
      ? { inode: artifact.inode }
      : fileStat.inode !== undefined
        ? { inode: fileStat.inode }
        : {}),
    ...(artifact.mtimeMs !== undefined ? { mtimeMs: artifact.mtimeMs } : { mtimeMs: fileStat.mtimeMs })
  };
}

function createDiagnosticsHash(diagnostics: Array<{ code: string; message: string; severity: string }>) {
  const stable = diagnostics
    .map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}:${diagnostic.message}`)
    .sort()
    .join("|");

  return createHash("sha256").update(stable).digest("hex");
}

async function deriveShellSessions(args: {
  adapter: SessionSourceAdapter;
  context: RuntimeAdapterContext;
  normalized: Awaited<ReturnType<SessionSourceAdapter["normalize"]>>;
}): Promise<LoadedArtifactDiagnostics & { sessions: NonNullable<NormalizedCacheRecord["derived"]>["sessions"] }> {
  const diagnostics: Diagnostic[] = [];
  const outputArtifactsById = new Map(
    args.normalized.outputArtifacts.map((artifact) => [artifact.id, artifact] as const)
  );

  const sessions = [];

  for (const session of args.normalized.sessions) {
    const shellCommands = args.normalized.shellCommands
      .filter((shellCommand) => shellCommand.sessionId === session.id)
      .sort((left, right) => {
        const leftTime = left.startedAt ?? left.endedAt ?? "";
        const rightTime = right.startedAt ?? right.endedAt ?? "";
        return leftTime.localeCompare(rightTime);
      });
    const parsedShellCommands = [];

    for (const shellCommand of shellCommands) {
      const artifactLoad = await loadShellArtifacts({
        adapter: args.adapter,
        context: args.context,
        outputArtifactsById,
        shellCommand
      });
      const relatedDiagnostics = dedupeDiagnostics([
        ...artifactLoad.diagnostics,
        ...getRelatedDiagnostics(args.normalized.diagnostics, shellCommand)
      ]);

      diagnostics.push(...artifactLoad.diagnostics);
      parsedShellCommands.push(
        parseShellCommandEvidence({
          shellCommand,
          artifacts: artifactLoad.loadedArtifacts,
          relatedDiagnostics
        })
      );
    }

    sessions.push({
      sessionId: session.id,
      shellCommands: parsedShellCommands
    });
  }

  return {
    diagnostics,
    loadedArtifacts: [],
    sessions
  };
}

async function loadShellArtifacts(args: {
  adapter: SessionSourceAdapter;
  context: RuntimeAdapterContext;
  outputArtifactsById: Map<string, Awaited<ReturnType<SessionSourceAdapter["normalize"]>>["outputArtifacts"][number]>;
  shellCommand: Awaited<ReturnType<SessionSourceAdapter["normalize"]>>["shellCommands"][number];
}): Promise<LoadedArtifactDiagnostics> {
  if (!args.adapter.loadOutputArtifact || !args.shellCommand.artifactIds?.length) {
    return {
      diagnostics: [],
      loadedArtifacts: []
    };
  }

  const diagnostics: Diagnostic[] = [];
  const loadedArtifacts = [];

  for (const artifactId of args.shellCommand.artifactIds) {
    const artifact = args.outputArtifactsById.get(artifactId);

    if (!artifact) {
      diagnostics.push(
        buildDiagnostic(
          args.shellCommand.adapterId,
          "shell.output-artifact.missing",
          "Shared shell parsing could not find a referenced output artifact.",
          "warning",
          "shell-command",
          HIGH_CONFIDENCE,
          {
            sourceId: args.shellCommand.sourceId,
            nativeId: args.shellCommand.nativeId,
            relatedEntityIds: [
              args.shellCommand.id,
              artifactId,
              ...(args.shellCommand.toolCallId ? [args.shellCommand.toolCallId] : [])
            ]
          }
        )
      );
      continue;
    }

    try {
      const loaded = await args.adapter.loadOutputArtifact(artifact, args.context);

      loadedArtifacts.push({
        artifactId,
        ...(loaded.mediaType ? { mediaType: loaded.mediaType } : {}),
        ...(loaded.text !== undefined ? { text: loaded.text } : {})
      });
    } catch (error) {
      diagnostics.push(
        buildDiagnostic(
          args.shellCommand.adapterId,
          "shell.output-artifact.unreadable",
          error instanceof Error
            ? error.message
            : "Shared shell parsing could not read the output artifact text.",
          "warning",
          "shell-command",
          HIGH_CONFIDENCE,
          {
            sourceId: args.shellCommand.sourceId,
            nativeId: args.shellCommand.nativeId,
            relatedEntityIds: [
              args.shellCommand.id,
              artifactId,
              ...(args.shellCommand.toolCallId ? [args.shellCommand.toolCallId] : [])
            ]
          }
        )
      );
    }
  }

  return {
    diagnostics,
    loadedArtifacts
  };
}

function getRelatedDiagnostics(
  diagnostics: Diagnostic[],
  shellCommand: Awaited<ReturnType<SessionSourceAdapter["normalize"]>>["shellCommands"][number]
): Diagnostic[] {
  const relatedIds = new Set([
    shellCommand.id,
    ...(shellCommand.toolCallId ? [shellCommand.toolCallId] : []),
    ...(shellCommand.artifactIds ?? [])
  ]);

  return diagnostics.filter((diagnostic) =>
    diagnostic.relatedEntityIds?.some((relatedId) => relatedIds.has(relatedId)) === true
  );
}

function getSessionDiagnostics(
  diagnostics: Diagnostic[],
  session: Awaited<ReturnType<SessionSourceAdapter["normalize"]>>["sessions"][number],
  sessionDerivation: NonNullable<NormalizedCacheRecord["derived"]>["sessions"][number]
): Diagnostic[] {
  const relatedIds = new Set([
    session.id,
    ...sessionDerivation.shellCommands.flatMap((shellCommand) => [
      shellCommand.shellCommandId,
      ...(shellCommand.toolCallId ? [shellCommand.toolCallId] : []),
      ...(shellCommand.artifactIds ?? []),
      ...(shellCommand.diagnosticIds ?? [])
    ])
  ]);

  return diagnostics.filter(
    (diagnostic) =>
      relatedIds.has(diagnostic.id) ||
      diagnostic.relatedEntityIds?.some((relatedId) => relatedIds.has(relatedId)) === true ||
      session.diagnosticIds?.includes(diagnostic.id) === true
  );
}

async function deriveProjectGitSnapshots(
  projects: Project[],
  gitSnapshotProvider: GitSnapshotProvider
): Promise<{
  diagnostics: Diagnostic[];
  projects: Array<{
    git: ProjectGitSnapshotResult["git"];
    projectId: string;
  }>;
}> {
  const snapshotResults = await Promise.all(
    projects.map(async (project) => ({
      projectId: project.id,
      ...(await gitSnapshotProvider.collect(project))
    }))
  );

  return {
    diagnostics: dedupeDiagnostics(
      snapshotResults.flatMap((result) => result.diagnostics)
    ),
    projects: snapshotResults.map((result) => ({
      projectId: result.projectId,
      git: result.git
    }))
  };
}

async function deriveProjectGitHubSnapshots(
  projects: Project[],
  gitProjects: Array<{
    git: ProjectGitSnapshotResult["git"];
    projectId: string;
  }>,
  githubSnapshotProvider: GitHubSnapshotProvider
): Promise<{
  diagnostics: Diagnostic[];
  projectsByProjectId: Map<string, Awaited<ReturnType<GitHubSnapshotProvider["collect"]>>["github"]>;
}> {
  const gitProjectsById = new Map(gitProjects.map((project) => [project.projectId, project.git] as const));
  const snapshotResults = await Promise.all(
    projects.map(async (project) => ({
      projectId: project.id,
      ...(await githubSnapshotProvider.collect(project, gitProjectsById.get(project.id) ?? {
        status: "unknown",
        rootConfidence: "unknown",
        diagnosticIds: [],
        reason: "GitHub context is unavailable because a validated git snapshot is required first."
      }))
    }))
  );

  return {
    diagnostics: dedupeDiagnostics(
      snapshotResults.flatMap((result) => result.diagnostics)
    ),
    projectsByProjectId: new Map(
      snapshotResults.map((result) => [result.projectId, result.github] as const)
    )
  };
}

function dedupeDiagnostics<T extends { id: string }>(diagnostics: T[]): T[] {
  const seen = new Map<string, T>();

  for (const diagnostic of diagnostics) {
    seen.set(diagnostic.id, diagnostic);
  }

  return [...seen.values()];
}
