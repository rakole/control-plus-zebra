import { createHash } from "node:crypto";

import {
  normalizeSessionSource,
  streamNormalizedSessionSource,
  type SessionSourceAdapter
} from "../adapter-contract/session-source-adapter.js";
import type {
  AdapterNormalizationResult,
  AdapterBatchStreamingNormalizationInput,
  AdapterCapabilitySnapshots,
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  RawHarnessEvent
} from "../adapter-contract/types.js";
import type { FileBackedCacheStore, NormalizedCacheRecord } from "../cache/file-backed-cache-store.js";
import { createCacheKey } from "../cache/cache-keys.js";
import { buildDiagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../model/confidence.js";
import { createSourceId, type RawArtifactRef as ModelRawArtifactRef } from "../model/identifiers.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { createSafeFilesystem, type SafeFilesystem } from "../security/safe-filesystem.js";
import type { RawArtifactIndex } from "./raw-artifact-index.js";
import {
  compareRawArtifactIndexEntries,
  createRawArtifactIndexEntries,
  fingerprintEntries,
  type RawArtifactIndexEntry,
  type RawArtifactIndexComparison,
  RAW_ARTIFACT_SCHEMA_VERSION
} from "./raw-artifact-index.js";
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
import type { OutputArtifact, Project, Session } from "../model/entities.js";
import type { EntityWriteBatch, EntityWriter } from "../store/entity-writer.js";
import {
  buildProjectRollups,
  buildRawArtifactMetadata,
  buildSessionRollups,
  maxIsoTimestamp
} from "../store/normalized-cache-record-entity-importer.js";
import type { WorkbenchEntityStore } from "../store/workbench-entity-store.js";

export interface ScannerOptions {
  adapterRegistry: AdapterRegistry;
  cacheStore: FileBackedCacheStore;
  entityStore: WorkbenchEntityStore & EntityWriter;
  getSessionStartedAtCutoff?: () => Promise<string | undefined> | string | undefined;
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
type SourceScanOptions = { sessionStartedAtCutoff?: string | undefined };

export class Scanner {
  readonly #adapterRegistry: AdapterRegistry;
  readonly #cacheStore: FileBackedCacheStore;
  readonly #entityStore: WorkbenchEntityStore & EntityWriter;
  readonly #getSessionStartedAtCutoff: () => Promise<string | undefined> | string | undefined;
  readonly #githubSnapshotProvider: GitHubSnapshotProvider;
  readonly #gitSnapshotProvider: GitSnapshotProvider;
  readonly #projectDir: string;
  readonly #rawArtifactIndex: RawArtifactIndex;
  readonly #sourceRegistry: SourceRegistry;
  readonly #watchOrchestrator: WatchOrchestrator;

  constructor(options: ScannerOptions) {
    this.#adapterRegistry = options.adapterRegistry;
    this.#cacheStore = options.cacheStore;
    this.#entityStore = options.entityStore;
    this.#getSessionStartedAtCutoff = options.getSessionStartedAtCutoff ?? (() => undefined);
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
      status: toValidationStatus(
        validation.ok,
        validation.capabilities
          ? validation.capabilities.discovery.defaultRoots
            ? "supported"
            : "unsupported"
          : undefined
      ),
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
    const sessionStartedAtCutoff = await this.#getSessionStartedAtCutoff();
    const validationContext = this.createContext({
      allowedRootPaths: [source.rootPath],
      sessionStartedAtCutoff
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
    if (discoveredSources.length === 0) {
      return source;
    }
    const rebasedArtifacts: RawArtifactRef[] = [];

    for (const discoveredSource of discoveredSources) {
      const artifactContext = this.createContext({
        allowedRootPaths: [discoveredSource.rootPath],
        sessionStartedAtCutoff
      });
      const artifacts = await collectAsync(adapter.discoverArtifacts(discoveredSource, artifactContext));

      rebasedArtifacts.push(
        ...artifacts.map((artifact) => rebaseRawArtifactSourceId(artifact, source.sourceId))
      );
    }

    const diagnosticsHash = createDiagnosticsHash(source.diagnostics);
    const indexEntries = createRawArtifactIndexEntries({
      adapterVersion: adapter.descriptor.adapterVersion,
      artifacts: rebasedArtifacts,
      diagnosticsHash,
      parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
      schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
    });
    const change = await comparePersistedRawArtifactEntriesForSource({
      entityStore: this.#entityStore,
      nextEntries: indexEntries,
      rawArtifactIndex: this.#rawArtifactIndex,
      source
    });

    if (!change.changed) {
      return source;
    }

    const staleReason = buildChangedArtifactStaleReason(
      change.comparison,
      adapter.descriptor.capabilities.live.incrementalParsing
    );

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

  async scanSource(
    sourceId: string,
    scanOptions: SourceScanOptions = {}
  ): Promise<SourceScanExecution> {
    const source = await this.requireSource(sourceId);

    if (!source.enabled) {
      throw new Error("Disabled sources cannot be scanned.");
    }

    if (source.validation.status !== "valid") {
      throw new Error("Sources must validate before scanning.");
    }

    const adapter = this.#adapterRegistry.require(source.adapterId);
    const sessionStartedAtCutoff =
      scanOptions.sessionStartedAtCutoff ?? (await this.#getSessionStartedAtCutoff());
    const validationContext = this.createContext({
      allowedRootPaths: [source.rootPath],
      sessionStartedAtCutoff
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
      const streamedProjects = new Map<string, Project>();
      const streamedSessions = new Map<string, Session>();
      const streamedOutputArtifacts = new Map<string, OutputArtifact>();
      let scanDiagnostics = [...source.validation.diagnostics];
      let totalArtifacts = 0;
      let totalSessions = 0;
      let cacheRecord: NormalizedCacheRecord | undefined;
      const rawArtifactRefs = new Map<string, RawArtifactRef>();
      const shellSessions = new Map<string, NonNullable<NormalizedCacheRecord["shellCommands"]>["sessions"][number]>();
      const verificationResults = new Map<
        string,
        NonNullable<NormalizedCacheRecord["verificationResults"]>["sessions"][number]
      >();
      const runAudits = new Map<string, NonNullable<NormalizedCacheRecord["runAudits"]>["sessions"][number]>();
      const gitSnapshots = new Map<string, NonNullable<NormalizedCacheRecord["gitSnapshots"]>["projects"][number]>();
      const githubSnapshots = new Map<
        string,
        NonNullable<NormalizedCacheRecord["githubSnapshots"]>["projects"][number]
      >();
      let capabilitySnapshots: AdapterCapabilitySnapshots | undefined;
      const streamedIngestRun = adapter.normalizeBatches
        ? await this.#entityStore.beginIngestRun({
            adapterId: source.adapterId,
            sourceId: source.sourceId,
            startedAt: new Date().toISOString()
          })
        : undefined;

      for (const discoveredSource of discoveredSources) {
        const discoveryContext = this.createContext({
          allowedRootPaths: [discoveredSource.rootPath],
          sessionStartedAtCutoff
        });
        const artifacts = await collectAsync(
          adapter.discoverArtifacts(discoveredSource, discoveryContext)
        );
        totalArtifacts += artifacts.length;
        const artifactPaths = artifacts.flatMap((artifact) => (artifact.path ? [artifact.path] : []));
        const parseContext = this.createContext({
          allowedArtifactPaths: artifactPaths,
          allowedRootPaths: [discoveredSource.rootPath],
          sessionStartedAtCutoff
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
        const rebasedArtifacts = artifactsWithMetadata.map((artifact) =>
          rebaseRawArtifactSourceId(artifact, source.sourceId)
        );

        if (adapter.normalizeBatches && streamedIngestRun) {
          const watchRecord = await this.#watchOrchestrator.planForSource(
            adapter,
            discoveredSource,
            parseContext
          );

          await this.#sourceRegistry.saveWatchSummary(source.sourceId, {
            status: watchRecord.status,
            ...(watchRecord.reason ? { reason: watchRecord.reason } : {}),
            strategy: watchRecord.strategy,
            scopePaths: watchRecord.scopePaths,
            plannedAt: watchRecord.plannedAt
          });

          const streamed = await ingestNormalizedBatchesToEntityStore({
            adapter,
            entityStore: this.#entityStore,
            gitSnapshotProvider: this.#gitSnapshotProvider,
            githubSnapshotProvider: this.#githubSnapshotProvider,
            ingestRunId: streamedIngestRun.ingestRunId,
            parseContext,
            sessionStartedAtCutoff,
            sourceId: source.sourceId,
            streamingInput: {
              source: discoveredSource,
              artifacts: rebasedArtifacts,
              rawEvents: streamRawEvents(adapter, artifactsWithMetadata, parseContext)
            }
          });

          scanDiagnostics = [...scanDiagnostics, ...streamed.diagnostics];
          totalSessions += streamed.sessionCount;
          capabilitySnapshots = streamed.capabilitySnapshots
            ? mergeCapabilitySnapshots(capabilitySnapshots, streamed.capabilitySnapshots)
            : capabilitySnapshots;

          for (const artifact of rebasedArtifacts) {
            rawArtifactRefs.set(artifact.id, artifact);
          }

          for (const project of streamed.projects) {
            streamedProjects.set(project.id, project);
          }

          for (const session of streamed.sessions) {
            streamedSessions.set(session.id, session);
          }

          for (const outputArtifact of streamed.outputArtifacts) {
            streamedOutputArtifacts.set(outputArtifact.id, outputArtifact);
          }

          for (const session of streamed.derivedSessions) {
            shellSessions.set(session.sessionId, {
              sessionId: session.sessionId,
              shellCommands: session.shellCommands
            });

            if (session.verification) {
              verificationResults.set(session.sessionId, {
                sessionId: session.sessionId,
                verification: session.verification
              });
            }

            if (session.audit) {
              runAudits.set(session.sessionId, {
                sessionId: session.sessionId,
                audit: session.audit
              });
            }
          }

          for (const projectSnapshot of streamed.projectSnapshots) {
            gitSnapshots.set(projectSnapshot.projectId, {
              projectId: projectSnapshot.projectId,
              git: projectSnapshot.git
            });

            if (projectSnapshot.github) {
              githubSnapshots.set(projectSnapshot.projectId, {
                projectId: projectSnapshot.projectId,
                github: projectSnapshot.github
              });
            }
          }

          continue;
        }

        const rawEvents = await collectRawEvents(adapter, artifactsWithMetadata, parseContext);
        const normalized = await normalizeSessionSource(
          adapter,
          {
            source: discoveredSource,
            artifacts: artifactsWithMetadata,
            rawEvents
          },
          parseContext
        );
        const filteredNormalized = filterNormalizedResultBySessionStartedAt(
          normalized,
          sessionStartedAtCutoff
        );
        const validation = validateNormalizedResult(filteredNormalized);

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
          strategy: watchRecord.strategy,
          scopePaths: watchRecord.scopePaths,
          plannedAt: watchRecord.plannedAt
        });

        const shellDerivation = await deriveShellSessions({
          adapter,
          context: parseContext,
          normalized: filteredNormalized
        });
        const normalizedWithShellDiagnostics = {
          ...filteredNormalized,
          diagnostics: dedupeDiagnostics([
            ...filteredNormalized.diagnostics,
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
        const projectGitSnapshotsByProjectId = new Map(
          projectGitDerivation.projects.map((project) => [project.projectId, project.git] as const)
        );

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
          const projectGitSnapshot = session.projectId
            ? projectGitSnapshotsByProjectId.get(session.projectId)
            : undefined;

          return {
            ...sessionDerivation,
            verification,
            audit: deriveRunAuditForSession({
              adapterCapabilities: normalizedWithDerivedDiagnostics.capabilities.adapter,
              diagnostics: sessionDiagnostics,
              parsedShellCommands: sessionDerivation.shellCommands,
              ...(projectGitSnapshot ? { projectGitSnapshot } : {}),
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
        normalizedResults.push(normalizedWithDerivedDiagnostics);
        scanDiagnostics = [...scanDiagnostics, ...normalizedWithDerivedDiagnostics.diagnostics];
        totalSessions += normalizedWithDerivedDiagnostics.sessions.length;
        capabilitySnapshots = mergeCapabilitySnapshots(
          capabilitySnapshots,
          normalizedWithDerivedDiagnostics.capabilities
        );

        for (const artifact of rebasedArtifacts) {
          rawArtifactRefs.set(artifact.id, artifact);
        }

        for (const session of derivedSessions) {
          shellSessions.set(session.sessionId, {
            sessionId: session.sessionId,
            shellCommands: session.shellCommands
          });

          if (session.verification) {
            verificationResults.set(session.sessionId, {
              sessionId: session.sessionId,
              verification: session.verification
            });
          }

          if (session.audit) {
            runAudits.set(session.sessionId, {
              sessionId: session.sessionId,
              audit: session.audit
            });
          }
        }

        for (const projectSnapshot of projectSnapshots) {
          gitSnapshots.set(projectSnapshot.projectId, {
            projectId: projectSnapshot.projectId,
            git: projectSnapshot.git
          });

          if (projectSnapshot.github) {
            githubSnapshots.set(projectSnapshot.projectId, {
              projectId: projectSnapshot.projectId,
              github: projectSnapshot.github
            });
          }
        }
      }

      const finalDiagnostics = dedupeDiagnostics(scanDiagnostics);
      const merged = streamedIngestRun ? null : mergeNormalizedResults(normalizedResults);
      const rawArtifactEntries =
        (streamedIngestRun || merged) && rawArtifactRefs.size > 0
          ? createRawArtifactIndexEntries({
              adapterVersion: adapter.descriptor.adapterVersion,
              artifacts: [...rawArtifactRefs.values()],
              diagnosticsHash: createDiagnosticsHash(streamedIngestRun ? finalDiagnostics : merged!.diagnostics),
              parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
              schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
            })
          : [];
      let changedArtifactFallbackReason: string | undefined;

      if (streamedIngestRun) {
        const now = new Date().toISOString();
        const streamedRecord = filterNormalizedCacheRecordBySessionStartedAt(
          buildStreamingCompatibilityRecord({
            adapterId: source.adapterId,
            sourceId: source.sourceId,
            capabilitySnapshots,
            diagnostics: finalDiagnostics,
            gitSnapshots,
            githubSnapshots,
            outputArtifacts: [...streamedOutputArtifacts.values()],
            projects: [...streamedProjects.values()],
            rawArtifactEntries,
            runAudits,
            sessions: [...streamedSessions.values()],
            verificationResults
          }),
          sessionStartedAtCutoff
        );
        const rawArtifactMetadata = buildRawArtifactMetadata(streamedRecord);
        const projectRollups = buildProjectRollups(streamedRecord, rawArtifactMetadata);
        const sessionRollups = buildSessionRollups(streamedRecord, rawArtifactMetadata);
        const latestActivityAt = maxIsoTimestamp(
          streamedRecord.normalized.sessions.map((session) => session.lastUpdatedAt ?? session.startedAt)
        );
        const retainedRawArtifactEntries = streamedRecord.rawArtifactIndex?.entries ?? [];

        changedArtifactFallbackReason =
          retainedRawArtifactEntries.length > 0
            ? await getChangedArtifactFallbackReasonForSource({
                adapter,
                entityStore: this.#entityStore,
                rawArtifactEntries: retainedRawArtifactEntries,
                rawArtifactIndex: this.#rawArtifactIndex,
                source
              })
            : undefined;

        await this.#entityStore.writeBatch({
          ingestRunId: streamedIngestRun.ingestRunId,
          adapterId: source.adapterId,
          sourceId: source.sourceId,
          rawArtifacts: rawArtifactMetadata,
          overviewRollup: {
            sourceId: source.sourceId,
            needsAttentionCount: 0,
            projectCount: streamedRecord.normalized.projects.length,
            sessionCount: streamedRecord.normalized.sessions.length,
            ...(latestActivityAt ? { latestActivityAt } : {})
          },
          projectRollups,
          sessionRollups
        });
        await this.#entityStore.markLifecycle({
          kind: "source-complete",
          ingestRunId: streamedIngestRun.ingestRunId,
          adapterId: source.adapterId,
          sourceId: source.sourceId,
          occurredAt: now
        });
        await this.#entityStore.publishIngestRun({
          ingestRunId: streamedIngestRun.ingestRunId,
          sourceId: source.sourceId,
          publishedAt: now
        });
      } else if (merged) {
        const now = new Date().toISOString();
        const artifactFingerprint = fingerprintEntries(rawArtifactEntries);
        const cacheKey = createCacheKey({
          adapterId: merged.adapterId,
          sourceId: merged.sourceId,
          adapterVersion: adapter.descriptor.adapterVersion,
          parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
          schemaVersion: NORMALIZATION_SCHEMA_VERSION,
          diagnosticsHash: createDiagnosticsHash(merged.diagnostics),
          artifacts: rawArtifactEntries
        });
        const derivedSessions = buildDerivedSessionsCompatibility(shellSessions, verificationResults, runAudits);
        const derivedProjects = buildDerivedProjectsCompatibility(gitSnapshots, githubSnapshots);

        cacheRecord = filterNormalizedCacheRecordBySessionStartedAt(
          {
            cacheKey,
            adapterId: merged.adapterId,
            sourceId: merged.sourceId,
            artifactFingerprint,
            createdAt: now,
            updatedAt: now,
            normalized: merged,
            shellCommands: {
              sessions: [...shellSessions.values()]
            },
            verificationResults: {
              sessions: [...verificationResults.values()]
            },
            runAudits: {
              sessions: [...runAudits.values()]
            },
            gitSnapshots: {
              projects: [...gitSnapshots.values()]
            },
            githubSnapshots: {
              projects: [...githubSnapshots.values()]
            },
            diagnostics: {
              entries: merged.diagnostics
            },
            rawArtifactIndex: {
              entries: rawArtifactEntries
            },
            capabilitySnapshots: capabilitySnapshots ?? merged.capabilities,
            derived: {
              sessions: derivedSessions,
              ...(derivedProjects.length > 0 ? { projects: derivedProjects } : {})
            }
          },
          sessionStartedAtCutoff
        );

        const retainedRawArtifactEntries = cacheRecord.rawArtifactIndex?.entries ?? [];

        changedArtifactFallbackReason =
          retainedRawArtifactEntries.length > 0
            ? await getChangedArtifactFallbackReasonForSource({
                adapter,
                entityStore: this.#entityStore,
                rawArtifactEntries: retainedRawArtifactEntries,
                rawArtifactIndex: this.#rawArtifactIndex,
                source
              })
            : undefined;

        await this.#rawArtifactIndex.replaceSourceEntries(source.sourceId, retainedRawArtifactEntries);
        await this.#cacheStore.writeRecord(cacheRecord);
      }

      const scanSucceeded = streamedIngestRun
        ? streamedSessions.size > 0 || finalDiagnostics.every((diagnostic) => diagnostic.severity !== "error")
        : normalizedResults.length > 0;
      const nextScanStatus = !scanSucceeded
        ? "scan-failed"
        : finalDiagnostics.some((diagnostic) => diagnostic.severity === "error") ||
            finalDiagnostics.length > source.validation.diagnostics.length
          ? "scanned-with-diagnostics"
          : "cached";
      const nextCacheStatus = scanSucceeded ? "cached" : "unknown";
      const nextSource = await this.#sourceRegistry.saveScanSummary(source.sourceId, {
        status: nextScanStatus,
        diagnostics: finalDiagnostics,
        artifactCount: totalArtifacts,
        sessionCount: streamedIngestRun
          ? streamedSessions.size
          : cacheRecord?.normalized.sessions.length ?? totalSessions,
        ...(changedArtifactFallbackReason ? { reason: changedArtifactFallbackReason } : {})
      });

      await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
        status: nextCacheStatus,
        diagnostics: finalDiagnostics,
        ...(cacheRecord ? { cacheKey: cacheRecord.cacheKey } : {}),
        ...(changedArtifactFallbackReason ? { reason: changedArtifactFallbackReason } : {})
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
        diagnostics: failureDiagnostics,
        ...(source.cache.cacheKey ? { cacheKey: source.cache.cacheKey } : {})
      });

      throw error;
    }
  }

  private createContext(input: {
    allowedArtifactPaths?: string[];
    allowedRootPaths: string[];
    sessionStartedAtCutoff?: string | undefined;
  }): RuntimeAdapterContext {
    return {
      projectDir: this.#projectDir,
      platform: process.platform,
      ...(input.sessionStartedAtCutoff ? { sessionStartedAtCutoff: input.sessionStartedAtCutoff } : {}),
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

async function* streamRawEvents(
  adapter: SessionSourceAdapter,
  artifacts: RawArtifactRef[],
  context: AdapterContext
): AsyncIterable<RawHarnessEvent> {
  for (const artifact of artifacts) {
    yield* adapter.parseArtifact(artifact, context);
  }
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

function filterNormalizedResultBySessionStartedAt(
  normalized: AdapterNormalizationResult,
  cutoff?: string | undefined
): AdapterNormalizationResult {
  if (!cutoff) {
    return normalized;
  }

  const sessions = normalized.sessions.filter((session) => isSessionRetained(session, cutoff));
  const retainedSessionIds = new Set(sessions.map((session) => session.id));
  const retainedProjectIds = new Set(
    sessions
      .map((session) => session.projectId)
      .filter((projectId): projectId is string => typeof projectId === "string" && projectId.length > 0)
  );
  const outputArtifacts = normalized.outputArtifacts.filter((artifact) =>
    artifact.sessionId ? retainedSessionIds.has(artifact.sessionId) : false
  );
  const retainedOutputArtifactIds = new Set(outputArtifacts.map((artifact) => artifact.id));
  const retainedEntityIds = new Set<string>([
    ...retainedSessionIds,
    ...retainedProjectIds,
    ...retainedOutputArtifactIds
  ]);

  return {
    ...normalized,
    capabilities: {
      ...normalized.capabilities,
      sessions: normalized.capabilities.sessions.filter((capability) =>
        retainedSessionIds.has(capability.sessionId)
      )
    },
    projects: normalized.projects
      .filter((project) => retainedProjectIds.has(project.id))
      .map((project) => filterProjectSessionIds(project, retainedSessionIds)),
    sessions,
    events: normalized.events.filter((event) => retainedSessionIds.has(event.sessionId)),
    messages: normalized.messages.filter((message) => retainedSessionIds.has(message.sessionId)),
    toolCalls: normalized.toolCalls.filter((toolCall) => retainedSessionIds.has(toolCall.sessionId)),
    shellCommands: normalized.shellCommands.filter((command) => retainedSessionIds.has(command.sessionId)),
    outputArtifacts,
    fileMutations: normalized.fileMutations.filter((mutation) => retainedSessionIds.has(mutation.sessionId)),
    diagnostics: normalized.diagnostics.filter((diagnostic) => {
      const relatedIds = diagnostic.relatedEntityIds ?? [];

      return relatedIds.length === 0 || relatedIds.some((id) => retainedEntityIds.has(id));
    })
  };
}

function filterProjectSessionIds(project: Project, retainedSessionIds: Set<string>): Project {
  if (!project.sessionIds) {
    return project;
  }

  return {
    ...project,
    sessionIds: project.sessionIds.filter((sessionId) => retainedSessionIds.has(sessionId))
  };
}

function filterNormalizedCacheRecordBySessionStartedAt(
  record: NormalizedCacheRecord,
  cutoff?: string | undefined
): NormalizedCacheRecord {
  if (!cutoff) {
    return record;
  }

  const normalized = filterNormalizedResultBySessionStartedAt(record.normalized, cutoff);
  const retainedSessionIds = new Set(normalized.sessions.map((session) => session.id));
  const retainedProjectIds = new Set(normalized.projects.map((project) => project.id));
  const retainedOutputArtifactIds = new Set(normalized.outputArtifacts.map((artifact) => artifact.id));
  const retainedEntityIds = new Set<string>([
    ...retainedSessionIds,
    ...retainedProjectIds,
    ...retainedOutputArtifactIds
  ]);
  const retainedRawArtifactIds = new Set<string>();

  for (const project of normalized.projects) {
    for (const ref of project.harnessRefs ?? []) {
      for (const rawArtifactRef of ref.rawArtifactRefs ?? []) {
        retainedRawArtifactIds.add(rawArtifactRef.id);
      }
    }
  }

  for (const session of normalized.sessions) {
    for (const rawArtifactRef of session.rawArtifactRefs ?? []) {
      retainedRawArtifactIds.add(rawArtifactRef.id);
    }
  }

  for (const outputArtifact of normalized.outputArtifacts) {
    if (outputArtifact.ref?.id) {
      retainedRawArtifactIds.add(outputArtifact.ref.id);
    }
  }

  return {
    ...record,
    normalized,
    verificationResults: {
      sessions: (record.verificationResults?.sessions ?? []).filter((entry) =>
        retainedSessionIds.has(entry.sessionId)
      )
    },
    shellCommands: {
      sessions: (record.shellCommands?.sessions ?? []).filter((entry) =>
        retainedSessionIds.has(entry.sessionId)
      )
    },
    runAudits: {
      sessions: (record.runAudits?.sessions ?? []).filter((entry) =>
        retainedSessionIds.has(entry.sessionId)
      )
    },
    gitSnapshots: {
      projects: (record.gitSnapshots?.projects ?? []).filter((entry) =>
        retainedProjectIds.has(entry.projectId)
      )
    },
    githubSnapshots: {
      projects: (record.githubSnapshots?.projects ?? []).filter((entry) =>
        retainedProjectIds.has(entry.projectId)
      )
    },
    diagnostics: {
      entries: (record.diagnostics?.entries ?? normalized.diagnostics).filter((diagnostic) => {
        const relatedIds = diagnostic.relatedEntityIds ?? [];

        return relatedIds.length === 0 || relatedIds.some((id) => retainedEntityIds.has(id));
      })
    },
    rawArtifactIndex: {
      entries: (record.rawArtifactIndex?.entries ?? []).filter((entry) =>
        retainedRawArtifactIds.has(entry.id)
      )
    },
    derived: {
      sessions: (record.derived?.sessions ?? []).filter((session) =>
        retainedSessionIds.has(session.sessionId)
      ),
      ...((record.derived?.projects ?? []).length > 0
        ? {
            projects: (record.derived?.projects ?? []).filter((project) =>
              retainedProjectIds.has(project.projectId)
            )
          }
        : {})
    },
    ...(record.capabilitySnapshots
      ? {
          capabilitySnapshots: {
            ...record.capabilitySnapshots,
            sessions: record.capabilitySnapshots.sessions.filter((capability) =>
              retainedSessionIds.has(capability.sessionId)
            )
          }
        }
      : {})
  };
}

function isSessionRetained(session: Session, cutoff: string): boolean {
  if (!session.startedAt) {
    return true;
  }

  const startedAtTime = Date.parse(session.startedAt);
  const cutoffTime = Date.parse(cutoff);

  if (Number.isNaN(startedAtTime) || Number.isNaN(cutoffTime)) {
    return true;
  }

  return startedAtTime >= cutoffTime;
}

async function ingestNormalizedBatchesToEntityStore(args: {
  adapter: SessionSourceAdapter;
  entityStore: WorkbenchEntityStore & EntityWriter;
  gitSnapshotProvider: GitSnapshotProvider;
  githubSnapshotProvider: GitHubSnapshotProvider;
  ingestRunId: string;
  parseContext: RuntimeAdapterContext;
  sessionStartedAtCutoff?: string | undefined;
  sourceId: string;
  streamingInput: AdapterBatchStreamingNormalizationInput;
}): Promise<{
  capabilitySnapshots?: AdapterCapabilitySnapshots;
  derivedSessions: NonNullable<NormalizedCacheRecord["derived"]>["sessions"];
  diagnostics: Diagnostic[];
  outputArtifacts: OutputArtifact[];
  projectSnapshots: Array<{
    git: ProjectGitSnapshotResult["git"];
    github?: Awaited<ReturnType<GitHubSnapshotProvider["collect"]>>["github"];
    projectId: string;
  }>;
  projects: Project[];
  sessionCount: number;
  sessions: Session[];
}> {
  const diagnostics: Diagnostic[] = [];
  const projects = new Map<string, Project>();
  const sessions = new Map<string, Session>();
  const outputArtifacts = new Map<string, OutputArtifact>();
  const derivedSessions: NonNullable<NormalizedCacheRecord["derived"]>["sessions"] = [];
  const projectSnapshots = new Map<
    string,
    {
      git: ProjectGitSnapshotResult["git"];
      github?: Awaited<ReturnType<GitHubSnapshotProvider["collect"]>>["github"];
      projectId: string;
    }
  >();
  let capabilitySnapshots: AdapterCapabilitySnapshots | undefined;

  for await (const batch of streamNormalizedSessionSource(
    args.adapter,
    args.streamingInput,
    args.parseContext
  )) {
    const normalized = filterNormalizedResultBySessionStartedAt(
      rebaseNormalizedResultSourceId(batch, args.sourceId),
      args.sessionStartedAtCutoff
    );
    const validation = validateNormalizedResult(normalized);

    if (!validation.ok) {
      diagnostics.push(...validation.diagnostics);
      continue;
    }

    const derived = await deriveNormalizedBatch({
      adapter: args.adapter,
      gitSnapshotProvider: args.gitSnapshotProvider,
      githubSnapshotProvider: args.githubSnapshotProvider,
      normalized,
      parseContext: args.parseContext
    });

    diagnostics.push(...derived.normalized.diagnostics);
    capabilitySnapshots = capabilitySnapshots
      ? mergeCapabilitySnapshots(capabilitySnapshots, derived.normalized.capabilities)
      : derived.normalized.capabilities;

    for (const project of derived.normalized.projects) {
      projects.set(project.id, project);
    }

    for (const session of derived.normalized.sessions) {
      sessions.set(session.id, session);
    }

    for (const outputArtifact of derived.normalized.outputArtifacts) {
      outputArtifacts.set(outputArtifact.id, outputArtifact);
    }

    derived.derivedSessions.forEach((session) => derivedSessions.push(session));
    derived.projectSnapshots.forEach((snapshot) => projectSnapshots.set(snapshot.projectId, snapshot));

    await writeNormalizedBatchToEntityStore({
      adapterId: args.adapter.descriptor.id,
      batch: derived.normalized,
      entityStore: args.entityStore,
      ingestRunId: args.ingestRunId,
      projectSnapshots: derived.projectSnapshots,
      sourceId: args.sourceId,
      derivedSessions: derived.derivedSessions
    });
  }

  return {
    ...(capabilitySnapshots ? { capabilitySnapshots } : {}),
    derivedSessions,
    diagnostics: dedupeDiagnostics(diagnostics),
    outputArtifacts: [...outputArtifacts.values()],
    projectSnapshots: [...projectSnapshots.values()],
    projects: [...projects.values()],
    sessionCount: sessions.size,
    sessions: [...sessions.values()]
  };
}

async function deriveNormalizedBatch(args: {
  adapter: SessionSourceAdapter;
  gitSnapshotProvider: GitSnapshotProvider;
  githubSnapshotProvider: GitHubSnapshotProvider;
  normalized: AdapterNormalizationResult;
  parseContext: RuntimeAdapterContext;
}): Promise<{
  derivedSessions: NonNullable<NormalizedCacheRecord["derived"]>["sessions"];
  normalized: AdapterNormalizationResult;
  projectSnapshots: Array<{
    git: ProjectGitSnapshotResult["git"];
    github?: Awaited<ReturnType<GitHubSnapshotProvider["collect"]>>["github"];
    projectId: string;
  }>;
}> {
  const shellDerivation = await deriveShellSessions({
    adapter: args.adapter,
    context: args.parseContext,
    normalized: args.normalized
  });
  const normalizedWithShellDiagnostics = {
    ...args.normalized,
    diagnostics: dedupeDiagnostics([
      ...args.normalized.diagnostics,
      ...shellDerivation.diagnostics
    ])
  };
  const projectGitDerivation = await deriveProjectGitSnapshots(
    normalizedWithShellDiagnostics.projects,
    args.gitSnapshotProvider
  );
  const projectGitHubDerivation = await deriveProjectGitHubSnapshots(
    normalizedWithShellDiagnostics.projects,
    projectGitDerivation.projects,
    args.githubSnapshotProvider
  );
  const normalizedWithDerivedDiagnostics = {
    ...normalizedWithShellDiagnostics,
    diagnostics: dedupeDiagnostics([
      ...normalizedWithShellDiagnostics.diagnostics,
      ...projectGitDerivation.diagnostics,
      ...projectGitHubDerivation.diagnostics
    ])
  };
  const projectGitSnapshotsByProjectId = new Map(
    projectGitDerivation.projects.map((project) => [project.projectId, project.git] as const)
  );

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
    const projectGitSnapshot = session.projectId
      ? projectGitSnapshotsByProjectId.get(session.projectId)
      : undefined;

    return {
      ...sessionDerivation,
      verification,
      audit: deriveRunAuditForSession({
        adapterCapabilities: normalizedWithDerivedDiagnostics.capabilities.adapter,
        diagnostics: sessionDiagnostics,
        parsedShellCommands: sessionDerivation.shellCommands,
        ...(projectGitSnapshot ? { projectGitSnapshot } : {}),
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
  const derivedSessionsById = new Map(derivedSessions.map((session) => [session.sessionId, session] as const));
  const modelNamesBySessionId = new Map(
    normalizedWithDerivedDiagnostics.sessions.map((session) => [
      session.id,
      collectSessionModelNames(normalizedWithDerivedDiagnostics.messages, session.id)
    ] as const)
  );
  const normalizedWithEnrichedSessions = {
    ...normalizedWithDerivedDiagnostics,
    sessions: normalizedWithDerivedDiagnostics.sessions.map((session) => {
      const derivedSession = derivedSessionsById.get(session.id);
      const modelNames = modelNamesBySessionId.get(session.id) ?? [];

      if (!derivedSession) {
        return modelNames.length > 0
          ? {
              ...session,
              metadata: {
                ...(session.metadata ?? {}),
                modelNames
              }
            }
          : session;
      }

      return {
        ...session,
        ...(modelNames.length > 0
          ? {
              metadata: {
                ...(session.metadata ?? {}),
                modelNames
              }
            }
          : {}),
        parsedShellCommands: derivedSession.shellCommands,
        ...(derivedSession.verification ? { verification: derivedSession.verification } : {}),
        ...(derivedSession.audit ? { runAudit: derivedSession.audit } : {})
      };
    })
  };

  const projectSnapshots = projectGitDerivation.projects.map((projectGitSnapshot) => {
    const githubSnapshot = projectGitHubDerivation.projectsByProjectId.get(projectGitSnapshot.projectId);

    return {
      ...projectGitSnapshot,
      ...(githubSnapshot ? { github: githubSnapshot } : {})
    };
  });

  return {
    derivedSessions,
    normalized: normalizedWithEnrichedSessions,
    projectSnapshots
  };
}

async function writeNormalizedBatchToEntityStore(args: {
  adapterId: string;
  batch: AdapterNormalizationResult;
  derivedSessions: NonNullable<NormalizedCacheRecord["derived"]>["sessions"];
  entityStore: WorkbenchEntityStore & EntityWriter;
  ingestRunId: string;
  projectSnapshots: Array<{
    git: ProjectGitSnapshotResult["git"];
    github?: Awaited<ReturnType<GitHubSnapshotProvider["collect"]>>["github"];
    projectId: string;
  }>;
  sourceId: string;
}): Promise<void> {
  await writeChunkedEntityBatch(args.entityStore, {
    adapterId: args.adapterId,
    diagnostics: args.batch.diagnostics,
    events: args.batch.events,
    fileMutations: args.batch.fileMutations,
    githubSnapshots: args.projectSnapshots
      .filter((snapshot) => snapshot.github)
      .map((snapshot) => ({
        projectId: snapshot.projectId,
        github: snapshot.github!
      })),
    gitSnapshots: args.projectSnapshots.map((snapshot) => ({
      projectId: snapshot.projectId,
      git: snapshot.git
    })),
    ingestRunId: args.ingestRunId,
    messages: args.batch.messages,
    outputArtifacts: args.batch.outputArtifacts,
    projects: args.batch.projects,
    runAuditSnapshots: args.derivedSessions
      .filter((session) => session.audit)
      .map((session) => ({
        sessionId: session.sessionId,
        audit: session.audit!
      })),
    sessions: args.batch.sessions,
    shellCommands: args.batch.shellCommands,
    sourceId: args.sourceId,
    toolCalls: args.batch.toolCalls,
    verificationSnapshots: args.derivedSessions
      .filter((session) => session.verification)
      .map((session) => ({
        sessionId: session.sessionId,
        verification: session.verification!
      }))
  });
}

async function writeChunkedEntityBatch(
  entityStore: WorkbenchEntityStore & EntityWriter,
  batch: EntityWriteBatch
): Promise<void> {
  const arrayEntries = Object.entries(batch).filter(([, value]) => Array.isArray(value)) as Array<
    [keyof EntityWriteBatch, unknown[]]
  >;
  const maxLength = arrayEntries.reduce((current, [, value]) => Math.max(current, value.length), 0);

  if (maxLength === 0) {
    await entityStore.writeBatch(batch);
    return;
  }

  for (let index = 0; index < maxLength; index += 1_000) {
    const chunk: EntityWriteBatch = {
      ingestRunId: batch.ingestRunId,
      adapterId: batch.adapterId,
      sourceId: batch.sourceId
    };

    for (const [key, value] of arrayEntries) {
      const nextItems = value.slice(index, index + 1_000);

      if (nextItems.length > 0) {
        (chunk as unknown as Record<string, unknown>)[key] = nextItems;
      }
    }

    await entityStore.writeBatch(chunk);
  }
}

function buildStreamingCompatibilityRecord(args: {
  adapterId: string;
  capabilitySnapshots: AdapterCapabilitySnapshots | undefined;
  diagnostics: Diagnostic[];
  gitSnapshots: Map<string, NonNullable<NormalizedCacheRecord["gitSnapshots"]>["projects"][number]>;
  githubSnapshots: Map<string, NonNullable<NormalizedCacheRecord["githubSnapshots"]>["projects"][number]>;
  outputArtifacts: OutputArtifact[];
  projects: Project[];
  rawArtifactEntries: ReturnType<typeof createRawArtifactIndexEntries>;
  runAudits: Map<string, NonNullable<NormalizedCacheRecord["runAudits"]>["sessions"][number]>;
  sessions: Session[];
  sourceId: string;
  verificationResults: Map<
    string,
    NonNullable<NormalizedCacheRecord["verificationResults"]>["sessions"][number]
  >;
}): NormalizedCacheRecord {
  const now = new Date().toISOString();

  return {
    cacheKey: `streamed-${args.sourceId}-${now}`,
    adapterId: args.adapterId,
    sourceId: args.sourceId,
    artifactFingerprint: fingerprintEntries(args.rawArtifactEntries),
    createdAt: now,
    updatedAt: now,
    normalized: {
      adapterId: args.adapterId,
      sourceId: args.sourceId,
      capabilities:
        args.capabilitySnapshots ?? {
          adapter: { adapterId: args.adapterId, capabilities: {} as AdapterCapabilitySnapshots["adapter"]["capabilities"] },
          source: {
            adapterId: args.adapterId,
            sourceId: args.sourceId,
            capabilities: {} as AdapterCapabilitySnapshots["source"]["capabilities"]
          },
          sessions: []
        },
      projects: args.projects,
      sessions: args.sessions,
      events: [],
      messages: [],
      toolCalls: [],
      shellCommands: [],
      outputArtifacts: args.outputArtifacts,
      fileMutations: [],
      diagnostics: args.diagnostics
    },
    verificationResults: {
      sessions: [...args.verificationResults.values()]
    },
    runAudits: {
      sessions: [...args.runAudits.values()]
    },
    gitSnapshots: {
      projects: [...args.gitSnapshots.values()]
    },
    githubSnapshots: {
      projects: [...args.githubSnapshots.values()]
    },
    diagnostics: {
      entries: args.diagnostics
    },
    rawArtifactIndex: {
      entries: args.rawArtifactEntries
    },
    ...(args.capabilitySnapshots ? { capabilitySnapshots: args.capabilitySnapshots } : {}),
    derived: {
      sessions: buildDerivedSessionsCompatibility(
        new Map(),
        args.verificationResults,
        args.runAudits
      ),
      ...(buildDerivedProjectsCompatibility(args.gitSnapshots, args.githubSnapshots).length > 0
        ? {
            projects: buildDerivedProjectsCompatibility(args.gitSnapshots, args.githubSnapshots)
          }
        : {})
    }
  };
}

function collectSessionModelNames(messages: AdapterNormalizationResult["messages"], sessionId: string): string[] {
  const seen = new Set<string>();
  const modelNames: string[] = [];

  for (const message of messages) {
    if (message.sessionId !== sessionId || typeof message.modelName !== "string") {
      continue;
    }

    const modelName = message.modelName.replace(/\s+/gu, " ").trim();

    if (modelName.length === 0 || seen.has(modelName)) {
      continue;
    }

    seen.add(modelName);
    modelNames.push(modelName);
  }

  return modelNames;
}

function rebaseNormalizedResultSourceId(
  normalized: AdapterNormalizationResult,
  sourceId: string
): AdapterNormalizationResult {
  return {
    ...normalized,
    sourceId,
    capabilities: {
      ...normalized.capabilities,
      source: {
        ...normalized.capabilities.source,
        sourceId
      },
      sessions: normalized.capabilities.sessions.map((session) => ({
        ...session,
        sourceId
      }))
    },
    projects: normalized.projects.map((project) => ({
      ...project,
      sourceId,
      ...(project.harnessRefs
        ? {
            harnessRefs: project.harnessRefs.map((ref) => ({
              ...ref,
              sourceId,
              rawArtifactRefs: ref.rawArtifactRefs.map((artifact) =>
                toModelRawArtifactRef(rebaseRawArtifactSourceId(artifact, sourceId))
              )
            }))
          }
        : {})
    })),
    sessions: normalized.sessions.map((session) => ({
      ...session,
      sourceId,
      ...(session.rawArtifactRefs
        ? {
            rawArtifactRefs: session.rawArtifactRefs.map((artifact) =>
              toModelRawArtifactRef(rebaseRawArtifactSourceId(artifact, sourceId))
            )
          }
        : {})
    })),
    events: normalized.events.map((event) => ({
      ...event,
      sourceId
    })),
    messages: normalized.messages.map((message) => ({
      ...message,
      sourceId
    })),
    toolCalls: normalized.toolCalls.map((toolCall) => ({
      ...toolCall,
      sourceId
    })),
    shellCommands: normalized.shellCommands.map((shellCommand) => ({
      ...shellCommand,
      sourceId
    })),
    outputArtifacts: normalized.outputArtifacts.map((artifact) => ({
      ...artifact,
      sourceId,
      ...(artifact.ref ? { ref: { ...artifact.ref, sourceId } } : {})
    })),
    fileMutations: normalized.fileMutations.map((fileMutation) => ({
      ...fileMutation,
      sourceId
    })),
    diagnostics: normalized.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      sourceId
    }))
  };
}

function rebaseRawArtifactSourceId(artifact: RawArtifactRef, sourceId: string): RawArtifactRef {
  return {
    ...artifact,
    sourceId
  };
}

function toModelRawArtifactRef(artifact: RawArtifactRef): ModelRawArtifactRef {
  return {
    id: artifact.id,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactKind: artifact.artifactKind ?? "unknown",
    ...(artifact.path ? { path: artifact.path } : {}),
    ...(artifact.nativeRef ? { nativeRef: artifact.nativeRef } : {}),
    ...(artifact.sizeBytes !== undefined ? { sizeBytes: artifact.sizeBytes } : {}),
    ...(artifact.mtime ? { mtime: artifact.mtime } : {}),
    ...(typeof artifact.inode === "string" ? { inode: artifact.inode } : {}),
    ...(artifact.parseStrategy ? { parseStrategy: artifact.parseStrategy } : {})
  };
}

export function applySafeArtifactMetadata<
  TArtifact extends {
    byteLength?: number | undefined;
    inode?: number | string | undefined;
    mtimeMs?: number | undefined;
  }
>(
  artifact: TArtifact,
  fileStat: { byteLength?: number; inode?: number | string; mtimeMs: number }
): TArtifact {
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
  } as TArtifact;
}

function createDiagnosticsHash(diagnostics: Array<{ code: string; message: string; severity: string }>) {
  const stable = diagnostics
    .map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}:${diagnostic.message}`)
    .sort()
    .join("|");

  return createHash("sha256").update(stable).digest("hex");
}

async function listPersistedRawArtifactEntriesForSource(args: {
  entityStore: WorkbenchEntityStore;
  rawArtifactIndex: RawArtifactIndex;
  source: SourceRecord;
}): Promise<RawArtifactIndexEntry[]> {
  if (args.source.cache.cacheKey) {
    return args.rawArtifactIndex.listSourceEntries(args.source.sourceId);
  }

  const metadata = await args.entityStore.listRawArtifactMetadata({
    sourceId: args.source.sourceId
  });
  const entityEntries = metadata.flatMap((record) => (record.entry ? [record.entry] : []));

  if (entityEntries.length > 0) {
    return entityEntries;
  }

  return args.rawArtifactIndex.listSourceEntries(args.source.sourceId);
}

async function comparePersistedRawArtifactEntriesForSource(args: {
  entityStore: WorkbenchEntityStore;
  nextEntries: RawArtifactIndexEntry[];
  rawArtifactIndex: RawArtifactIndex;
  source: SourceRecord;
}): Promise<{
  changed: boolean;
  previousFingerprint?: string;
  nextFingerprint: string;
  comparison: RawArtifactIndexComparison;
}> {
  const previousEntries = await listPersistedRawArtifactEntriesForSource({
    entityStore: args.entityStore,
    rawArtifactIndex: args.rawArtifactIndex,
    source: args.source
  });
  const previousFingerprint =
    previousEntries.length > 0 ? fingerprintEntries(previousEntries) : undefined;
  const nextFingerprint = fingerprintEntries(args.nextEntries);
  const comparison = compareRawArtifactIndexEntries(previousEntries, args.nextEntries);

  return {
    changed: previousFingerprint !== nextFingerprint,
    ...(previousFingerprint ? { previousFingerprint } : {}),
    nextFingerprint,
    comparison
  };
}

async function getChangedArtifactFallbackReasonForSource(args: {
  adapter: SessionSourceAdapter;
  entityStore: WorkbenchEntityStore;
  rawArtifactEntries: ReturnType<typeof createRawArtifactIndexEntries>;
  rawArtifactIndex: RawArtifactIndex;
  source: SourceRecord;
}): Promise<string | undefined> {
  const change = await comparePersistedRawArtifactEntriesForSource({
    entityStore: args.entityStore,
    nextEntries: args.rawArtifactEntries,
    rawArtifactIndex: args.rawArtifactIndex,
    source: args.source
  });

  if (!change.changed || !change.previousFingerprint) {
    return undefined;
  }

  if (args.adapter.descriptor.capabilities.live.incrementalParsing) {
    return undefined;
  }

  return buildChangedArtifactFallbackReason(change.comparison);
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
  const eventOrderById = new Map(
    args.normalized.events.map((event) => [event.id, event.orderKey ?? event.timestamp ?? event.id] as const)
  );

  const sessions = [];

  for (const session of args.normalized.sessions) {
    const shellCommandOrderById = new Map(
      (session.shellCommandIds ?? []).map((shellCommandId, index) => [
        shellCommandId,
        index
      ])
    );
    const shellCommands = args.normalized.shellCommands
      .filter((shellCommand) => shellCommand.sessionId === session.id)
      .sort((left, right) => {
        const leftOrder = shellCommandOrderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = shellCommandOrderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        const leftPointer =
          (left.source?.eventId ? eventOrderById.get(left.source.eventId) : undefined) ??
          left.source?.eventId ??
          left.source?.pointer ??
          left.nativeId ??
          left.id;
        const rightPointer =
          (right.source?.eventId ? eventOrderById.get(right.source.eventId) : undefined) ??
          right.source?.eventId ??
          right.source?.pointer ??
          right.nativeId ??
          right.id;
        return leftPointer.localeCompare(rightPointer);
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
  if (!args.adapter.loadOutputArtifact || !args.shellCommand.outputArtifactIds?.length) {
    return {
      diagnostics: [],
      loadedArtifacts: []
    };
  }

  const diagnostics: Diagnostic[] = [];
  const loadedArtifacts = [];

  for (const artifactId of args.shellCommand.outputArtifactIds) {
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
            ...(args.shellCommand.nativeId ? { nativeId: args.shellCommand.nativeId } : {}),
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
            ...(args.shellCommand.nativeId ? { nativeId: args.shellCommand.nativeId } : {}),
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
    ...(shellCommand.outputArtifactIds ?? [])
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

function mergeCapabilitySnapshots(
  current: AdapterCapabilitySnapshots | undefined,
  next: AdapterCapabilitySnapshots
): AdapterCapabilitySnapshots {
  if (!current) {
    return next;
  }

  const sessions = new Map(current.sessions.map((session) => [session.sessionId, session] as const));

  for (const session of next.sessions) {
    sessions.set(session.sessionId, session);
  }

  return {
    adapter: next.adapter,
    source: next.source,
    sessions: [...sessions.values()]
  };
}

function buildDerivedSessionsCompatibility(
  shellSessions: Map<string, NonNullable<NormalizedCacheRecord["shellCommands"]>["sessions"][number]>,
  verificationResults: Map<
    string,
    NonNullable<NormalizedCacheRecord["verificationResults"]>["sessions"][number]
  >,
  runAudits: Map<string, NonNullable<NormalizedCacheRecord["runAudits"]>["sessions"][number]>
): NonNullable<NormalizedCacheRecord["derived"]>["sessions"] {
  const sessionIds = new Set([
    ...shellSessions.keys(),
    ...verificationResults.keys(),
    ...runAudits.keys()
  ]);

  return [...sessionIds].map((sessionId) => {
    const verification = verificationResults.get(sessionId)?.verification;
    const audit = runAudits.get(sessionId)?.audit;

    return {
      sessionId,
      shellCommands: shellSessions.get(sessionId)?.shellCommands ?? [],
      ...(verification ? { verification } : {}),
      ...(audit ? { audit } : {})
    };
  });
}

function buildDerivedProjectsCompatibility(
  gitSnapshots: Map<string, NonNullable<NormalizedCacheRecord["gitSnapshots"]>["projects"][number]>,
  githubSnapshots: Map<string, NonNullable<NormalizedCacheRecord["githubSnapshots"]>["projects"][number]>
): NonNullable<NonNullable<NormalizedCacheRecord["derived"]>["projects"]> {
  const projectIds = new Set([...gitSnapshots.keys(), ...githubSnapshots.keys()]);

  return [...projectIds]
    .map((projectId) => {
      const gitSnapshot = gitSnapshots.get(projectId);

      if (!gitSnapshot) {
        return undefined;
      }

      const githubSnapshot = githubSnapshots.get(projectId);

      return {
        projectId,
        git: gitSnapshot.git,
        ...(githubSnapshot ? { github: githubSnapshot.github } : {})
      };
    })
    .filter((project): project is NonNullable<NonNullable<NormalizedCacheRecord["derived"]>["projects"]>[number] =>
      Boolean(project)
    );
}

function buildChangedArtifactFallbackReason(comparison: RawArtifactIndexComparison): string {
  return [
    buildChangedArtifactSummary(comparison),
    "Adapter incremental parsing is unsupported, so the scanner performed a full reparse."
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(" ");
}

function buildChangedArtifactStaleReason(
  comparison: RawArtifactIndexComparison,
  incrementalParsingSupported: boolean
): string {
  const baseReason = buildChangedArtifactSummary(comparison);

  if (incrementalParsingSupported) {
    return `${baseReason} The source cache is now stale.`;
  }

  return `${baseReason} Adapter incremental parsing is unsupported, so the next scan will perform a full reparse.`;
}

function buildChangedArtifactSummary(comparison: RawArtifactIndexComparison): string {
  const changedFields = [...new Set(comparison.changed.flatMap((entry) => entry.changes.map((change) => change.field)))];
  const segments = [
    `${comparison.added.length} added`,
    `${comparison.removed.length} removed`,
    `${comparison.changed.length} changed`
  ];

  return [
    "Indexed artifacts changed since the last cached scan.",
    `Change summary: ${segments.join(", ")}.`,
    changedFields.length > 0 ? `Changed fields: ${changedFields.join(", ")}.` : undefined
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(" ");
}
