import { copyFile, cp, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { FileBackedCacheStore } from "../../../src/main/core/cache/index.js";
import type {
  AdapterBatchStreamingNormalizationInput,
  AdapterNormalizationResult,
  RawArtifactRef,
  RawHarnessEvent,
  SessionSourceAdapter
} from "../../../src/main/core/adapter-contract/index.js";
import {
  GitSnapshotProvider,
  type ProjectGitSnapshotResult
} from "../../../src/main/core/git/git-snapshot-provider.js";
import { RawArtifactIndex, Scanner } from "../../../src/main/core/ingestion/index.js";
import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import type { Project } from "../../../src/main/core/model/entities.js";
import {
  AdapterRegistry,
  createBundledAdapterRegistry,
  FileBackedSourceRegistryStore,
  SourceRegistry
} from "../../../src/main/core/registry/index.js";
import { SQLiteWorkbenchEntityStore } from "../../../src/main/core/store/index.js";
import { WatchOrchestrator } from "../../../src/main/core/watcher/index.js";

const sourceFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);
const exitPrecedenceFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase5-exit-code-precedence.fixture.json"
);
const verificationRerunFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase5-verification-rerun.fixture.json"
);
const incompleteRunFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase5-incomplete-run.fixture.json"
);
const geminiFixtureRoot = path.resolve("src/main/adapters/gemini-cli/fixtures/sample-root");
const execFileAsync = promisify(execFile);
const streamingCapabilities = {
  discovery: {
    defaultRoots: true,
    projectRootMapping: "native",
    stableProjectId: true,
    stableSessionId: true
  },
  replay: {
    transcriptReplay: true,
    messageRoles: true,
    assistantMessages: true,
    lifecycleEvents: true,
    cancellationEvents: false,
    topicEvents: false,
    rawEventPointers: true
  },
  tools: {
    toolCalls: false,
    toolResults: false,
    fileReads: false,
    fileSearches: false,
    fileMutations: false,
    diffStats: false,
    shellCommands: false,
    shellOutputs: false,
    sidecarOutputs: false
  },
  usage: {
    modelNames: false,
    tokenCounts: false,
    costEstimates: false
  },
  live: {
    activeSessionDetection: "none",
    watchableArtifacts: false,
    incrementalParsing: true
  },
  audit: {
    agentClaimDetection: false,
    finalAnswerDetection: false,
    shellExitCodeEvidence: false,
    verificationCommandEvidence: false
  },
  export: {
    rawArtifactExport: false,
    normalizedExport: true
  }
} as const;

class FailingCacheStore extends FileBackedCacheStore {
  async writeRecord(): Promise<void> {
    throw new Error("Simulated cache persistence failure.");
  }
}

class StubGitSnapshotProvider extends GitSnapshotProvider {
  readonly #result: ProjectGitSnapshotResult;

  constructor(result: ProjectGitSnapshotResult) {
    super();
    this.#result = result;
  }

  async collect(_project: Project): Promise<ProjectGitSnapshotResult> {
    return this.#result;
  }
}

type StreamingRawEvent = RawHarnessEvent<{
  kind: "session-message";
  role: "assistant" | "user";
  text: string;
}>;

function createStreamingTestAdapter(): SessionSourceAdapter<StreamingRawEvent> {
  return {
    descriptor: {
      id: "streaming-test",
      displayName: "Streaming Test Adapter",
      adapterVersion: "0.1.0",
      supportedPlatforms: ["darwin", "linux", "win32"],
      defaultRoots: [{ path: ".", label: "streaming", kind: "file" }],
      capabilities: streamingCapabilities
    },
    async getDefaultSourceRoots() {
      return [{ path: ".", label: "streaming", kind: "file" }];
    },
    async validateSourceRoot(root) {
      return {
        ok: true,
        normalizedPath: root.rootPath,
        diagnostics: [],
        capabilities: streamingCapabilities
      };
    },
    async *discoverSources(root) {
      yield {
        id: `streaming:${root.rootPath}`,
        adapterId: "streaming-test",
        nativeId: root.rootPath,
        rootPath: root.rootPath,
        displayName: "Streaming source",
        confidence: HIGH_CONFIDENCE
      };
    },
    async *discoverArtifacts(source) {
      yield {
        id: `artifact:${source.rootPath}`,
        adapterId: "streaming-test",
        sourceId: source.id,
        path: source.rootPath,
        nativeRef: source.rootPath,
        artifactKind: "session-log",
        parseStrategy: "json"
      } as RawArtifactRef;
    },
    async *parseArtifact(artifact) {
      yield {
        id: `${artifact.id}:1`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "streaming.message",
        raw: {
          kind: "session-message",
          role: "user",
          text: "streaming user"
        },
        source: {
          artifactId: artifact.id,
          path: artifact.path,
          pointer: "event:1"
        },
        diagnostics: [],
        payload: {
          kind: "session-message",
          role: "user",
          text: "streaming user"
        }
      };
      yield {
        id: `${artifact.id}:2`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "streaming.message",
        raw: {
          kind: "session-message",
          role: "assistant",
          text: "streaming assistant"
        },
        source: {
          artifactId: artifact.id,
          path: artifact.path,
          pointer: "event:2"
        },
        diagnostics: [],
        payload: {
          kind: "session-message",
          role: "assistant",
          text: "streaming assistant"
        }
      };
    },
    async *normalizeBatches(
      input: AdapterBatchStreamingNormalizationInput<StreamingRawEvent>
    ): AsyncIterable<AdapterNormalizationResult> {
      const sessionId = `session:${input.source.id}`;
      const projectId = `project:${input.source.id}`;
      const userText = "streaming user";
      const assistantText = "streaming assistant";

      for await (const _rawEvent of input.rawEvents) {
        // Drain the async stream to prove scanner can hand batches a real event iterator.
      }

      yield {
        adapterId: "streaming-test",
        sourceId: input.source.id,
        capabilities: {
          adapter: {
            adapterId: "streaming-test",
            capabilities: streamingCapabilities
          },
          source: {
            adapterId: "streaming-test",
            sourceId: input.source.id,
            capabilities: streamingCapabilities
          },
          sessions: [
            {
              adapterId: "streaming-test",
              sourceId: input.source.id,
              sessionId,
              capabilities: streamingCapabilities
            }
          ]
        },
        projects: [
          {
            id: projectId,
            adapterId: "streaming-test",
            sourceId: input.source.id,
            displayName: "streaming-project",
            rootPath: input.source.rootPath,
            primaryRootPath: input.source.rootPath,
            rootConfidence: "confirmed",
            harnessRefs: [
              {
                adapterId: "streaming-test",
                sourceId: input.source.id,
                nativeProjectId: "streaming-project",
                nativeProjectPath: input.source.rootPath,
                projectRootPath: input.source.rootPath,
                projectRootConfidence: "confirmed",
                rawArtifactRefs: []
              }
            ],
            sessionIds: [sessionId],
            latestActivityAt: "2026-05-25T12:00:02.000Z",
            diagnostics: []
          }
        ],
        sessions: [
          {
            id: sessionId,
            adapterId: "streaming-test",
            sourceId: input.source.id,
            nativeSessionId: "streaming-session",
            projectId,
            startedAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:02.000Z",
            lifecycleStatus: "completed",
            capabilities: streamingCapabilities,
            parseConfidence: "confirmed",
            messageIds: [`message:${sessionId}:1`, `message:${sessionId}:2`],
            eventIds: [`event:${sessionId}:1`, `event:${sessionId}:2`],
            toolCallIds: [],
            fileMutationIds: [],
            shellCommandIds: [],
            outputArtifactIds: [],
            usage: {},
            rawArtifactRefs: [],
            diagnostics: []
          }
        ],
        events: [
          {
            id: `event:${sessionId}:1`,
            adapterId: "streaming-test",
            sourceId: input.source.id,
            sessionId,
            kind: "message",
            orderKey: "000001:event:1",
            actor: "user",
            title: "User message",
            text: userText,
            diagnostics: []
          },
          {
            id: `event:${sessionId}:2`,
            adapterId: "streaming-test",
            sourceId: input.source.id,
            sessionId,
            kind: "message",
            orderKey: "000002:event:2",
            actor: "assistant",
            title: "Assistant message",
            text: assistantText,
            diagnostics: []
          }
        ],
        messages: [
          {
            id: `message:${sessionId}:1`,
            adapterId: "streaming-test",
            sourceId: input.source.id,
            sessionId,
            role: "user",
            text: userText,
            toolCallIds: [],
            eventIds: [`event:${sessionId}:1`],
            source: {
              eventId: `event:${sessionId}:1`
            },
            confidence: "confirmed"
          },
          {
            id: `message:${sessionId}:2`,
            adapterId: "streaming-test",
            sourceId: input.source.id,
            sessionId,
            role: "assistant",
            text: assistantText,
            toolCallIds: [],
            eventIds: [`event:${sessionId}:2`],
            source: {
              eventId: `event:${sessionId}:2`
            },
            confidence: "confirmed"
          }
        ],
        toolCalls: [],
        shellCommands: [],
        outputArtifacts: [],
        fileMutations: [],
        diagnostics: []
      };
    },
    async normalize() {
      throw new Error("Legacy normalize should not run for the streaming test adapter.");
    },
    async getWatchPlan(source) {
      return {
        adapterId: source.adapterId,
        sourceId: source.id,
        status: "unsupported",
        scopePaths: [],
        strategy: "none",
        reason: "Streaming test adapter does not watch artifacts."
      };
    }
  };
}

async function createScannerHarness(options: {
  fakeFixturePath?: string;
  gitSnapshotProvider?: GitSnapshotProvider;
} = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-scanner-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  const fakeFixturePath = options.fakeFixturePath ?? sourceFixturePath;

  await copyFile(fakeFixturePath, fixturePath);

  const sourceRegistry = new SourceRegistry(
    new FileBackedSourceRegistryStore(path.join(tempDir, "sources.json"))
  );
  const rawArtifactIndex = new RawArtifactIndex(path.join(tempDir, "raw-artifact-index.json"));
  const cacheStore = new FileBackedCacheStore(path.join(tempDir, "normalized-cache.json"));
  const entityStore = new SQLiteWorkbenchEntityStore({
    artifactBlobRootDir: path.join(tempDir, "artifact-blobs"),
    databasePath: path.join(tempDir, "workbench.sqlite")
  });
  const watchOrchestrator = new WatchOrchestrator();
  const scanner = new Scanner({
    adapterRegistry: createBundledAdapterRegistry(),
    cacheStore,
    entityStore,
    ...(options.gitSnapshotProvider ? { gitSnapshotProvider: options.gitSnapshotProvider } : {}),
    projectDir: process.cwd(),
    rawArtifactIndex,
    sourceRegistry,
    watchOrchestrator
  });

  return {
    cacheStore,
    entityStore,
    fixturePath,
    rawArtifactIndex,
    scanner,
    sourceRegistry,
    tempDir
  };
}

describe("Scanner cache integration", () => {
  it("validates, scans, caches, and persists honest source summaries", async () => {
    const { cacheStore, fixturePath, scanner, sourceRegistry } = await createScannerHarness();
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });

    const validated = await scanner.validateSource(source.sourceId);
    const scanned = await scanner.scanSource(validated.source.sourceId);
    const persisted = await sourceRegistry.getSource(validated.source.sourceId);
    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);

    expect(scanned.cachedRecord?.cacheKey).toBeTruthy();
    expect(persisted?.scan.status).toBe("scanned-with-diagnostics");
    expect(persisted?.cache.status).toBe("cached");
    expect(persisted?.watch.status).toBe("unsupported");
    expect(persisted?.watch.scopePaths).toEqual([]);
    expect(persisted?.watch.plannedAt).toBeTruthy();
    expect(cachedRecord?.normalized.sessions.length).toBeGreaterThan(0);
    expect(cachedRecord?.shellCommands?.sessions.length).toBeGreaterThan(0);
    expect(cachedRecord?.verificationResults?.sessions.length).toBeGreaterThan(0);
    expect(cachedRecord?.runAudits?.sessions.length).toBeGreaterThan(0);
    expect(cachedRecord?.gitSnapshots?.projects.length).toBeGreaterThan(0);
    expect(cachedRecord?.githubSnapshots?.projects.length).toBeGreaterThan(0);
    expect(cachedRecord?.diagnostics?.entries.length).toBeGreaterThan(0);
    expect(cachedRecord?.rawArtifactIndex?.entries.length).toBeGreaterThan(0);
    expect(cachedRecord?.capabilitySnapshots?.adapter.capabilities.live.incrementalParsing).toBe(
      false
    );
  });

  it("writes streaming normalization batches straight to the entity store without cache persistence", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-streaming-scanner-"));
    const fixturePath = path.join(tempDir, "streaming.fixture.json");

    try {
      await writeFile(fixturePath, "{\n}\n", "utf8");

      const sourceRegistry = new SourceRegistry(
        new FileBackedSourceRegistryStore(path.join(tempDir, "sources.json"))
      );
      const rawArtifactIndex = new RawArtifactIndex(path.join(tempDir, "raw-artifact-index.json"));
      const entityStore = new SQLiteWorkbenchEntityStore({
        artifactBlobRootDir: path.join(tempDir, "artifact-blobs"),
        databasePath: path.join(tempDir, "workbench.sqlite")
      });
      const cacheStore = new FailingCacheStore(path.join(tempDir, "normalized-cache.json"));
      const adapterRegistry = new AdapterRegistry().register(createStreamingTestAdapter());
      const scanner = new Scanner({
        adapterRegistry,
        cacheStore,
        entityStore,
        projectDir: process.cwd(),
        rawArtifactIndex,
        sourceRegistry,
        watchOrchestrator: new WatchOrchestrator()
      });
      const source = await sourceRegistry.createSource({
        adapterId: "streaming-test",
        rootPath: fixturePath
      });

      const validated = await scanner.validateSource(source.sourceId);
      const scanned = await scanner.scanSource(validated.source.sourceId);
      const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);
      const currentRun = await entityStore.getCurrentIngestRun({ sourceId: validated.source.sourceId });
      const overviewRollup = await entityStore.getOverviewRollup({
        sourceId: validated.source.sourceId
      });
      const rawArtifactEntries = await rawArtifactIndex.load();

      expect(scanned.cachedRecord).toBeUndefined();
      expect(cachedRecord).toBeUndefined();
      expect(currentRun?.status).toBe("published");
      expect(overviewRollup?.projectCount).toBe(1);
      expect(overviewRollup?.sessionCount).toBe(1);
      expect(rawArtifactEntries).toEqual([]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("keeps cached source state unchanged when indexed artifact inputs do not change", async () => {
    const { fixturePath, scanner, sourceRegistry } = await createScannerHarness();
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);
    const reconciled = await scanner.reconcileSource(validated.source.sourceId);

    expect(reconciled.cache.status).toBe("cached");
    expect(reconciled.cache.reason).toBeUndefined();
    expect(reconciled.scan.status).toBe("scanned-with-diagnostics");
    expect(reconciled.scan.reason).toBeUndefined();
  });

  it("marks cached source state stale and records explicit full-reparse fallback reasons when indexed artifact inputs change", async () => {
    const { fixturePath, scanner, sourceRegistry } = await createScannerHarness();
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const currentStat = await stat(fixturePath);
    const nextTime = new Date(currentStat.mtimeMs + 5_000);

    await utimes(fixturePath, nextTime, nextTime);
    await scanner.reconcileSource(validated.source.sourceId);

    const reconciled = await sourceRegistry.getSource(validated.source.sourceId);

    expect(reconciled?.cache.status).toBe("stale");
    expect(reconciled?.scan.status).toBe("stale");
    expect(reconciled?.cache.reason).toContain("next scan will perform a full reparse");
    expect(reconciled?.scan.reason).toContain("Change summary: 0 added, 0 removed, 1 changed.");

    await scanner.scanSource(validated.source.sourceId);

    const rescanned = await sourceRegistry.getSource(validated.source.sourceId);

    expect(rescanned?.cache.status).toBe("cached");
    expect(rescanned?.cache.reason).toContain("scanner performed a full reparse");
    expect(rescanned?.scan.reason).toContain("Change summary: 0 added, 0 removed, 1 changed.");
  });

  it("streams Gemini sessions through the shared scanner pipeline into the entity store", async () => {
    const { cacheStore, entityStore, rawArtifactIndex, scanner, sourceRegistry, tempDir } =
      await createScannerHarness();
    const copiedGeminiRoot = path.join(tempDir, "gemini-root");

    await cp(geminiFixtureRoot, copiedGeminiRoot, { recursive: true });

    const source = await sourceRegistry.createSource({
      adapterId: "gemini-cli",
      rootPath: copiedGeminiRoot
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecords = await cacheStore.listLatestRecords();
    const currentRun = await entityStore.getCurrentIngestRun({
      sourceId: validated.source.sourceId
    });
    const overviewRollup = await entityStore.getOverviewRollup({
      sourceId: validated.source.sourceId
    });
    const sessionPage = await entityStore.listSessionsPage({
      sourceId: validated.source.sourceId
    });
    const verificationStatuses = (
      await Promise.all(
        sessionPage.items.map((item) =>
          entityStore.getSessionVerificationSnapshot({
            sourceId: validated.source.sourceId,
            sessionId: item.session.id
          })
        )
      )
    )
      .flatMap((snapshot) => (snapshot ? [snapshot.verification.status] : []));
    const auditStatuses = (
      await Promise.all(
        sessionPage.items.map((item) =>
          entityStore.getSessionRunAuditSnapshot({
            sourceId: validated.source.sourceId,
            sessionId: item.session.id
          })
        )
      )
    )
      .flatMap((snapshot) => (snapshot ? [snapshot.audit.status] : []));
    const rawArtifactMetadata = await entityStore.listRawArtifactMetadata({
      sourceId: validated.source.sourceId
    });
    const rawArtifactKinds = new Set(
      rawArtifactMetadata.flatMap((metadata) => (metadata.entry ? [metadata.entry.artifactKind] : []))
    );
    const projectRollups = await entityStore.listProjectRollups({
      sourceId: validated.source.sourceId
    });
    const rawArtifactIndexEntries = await rawArtifactIndex.listSourceEntries(validated.source.sourceId);

    expect(cachedRecords.filter((record) => record.adapterId === "gemini-cli")).toEqual([]);
    expect(currentRun?.status).toBe("published");
    expect(overviewRollup?.sessionCount).toBeGreaterThan(0);
    expect(projectRollups.length).toBeGreaterThan(0);
    expect(sessionPage.items.length).toBeGreaterThan(0);
    expect(sessionPage.items.some((item) => (item.session.outputArtifactIds?.length ?? 0) > 0)).toBe(true);
    expect(sessionPage.items.some((item) => item.outputArtifactCount && item.outputArtifactCount > 0)).toBe(
      true
    );
    expect([...rawArtifactKinds]).toEqual(
      expect.arrayContaining(["project-root-map", "history", "session-log", "output-artifact"])
    );
    expect(rawArtifactMetadata.length).toBeGreaterThan(0);
    expect(rawArtifactIndexEntries).toEqual([]);
    expect(verificationStatuses).toEqual(expect.arrayContaining(["failed", "unknown"]));
    expect(auditStatuses).toEqual(expect.arrayContaining(["active", "cancelled", "needs-review"]));
    expect(
      sessionPage.items.some((item) => item.session.lifecycleStatus === "completed")
    ).toBe(true);
  });

  it("reconciles streamed Gemini sources from entity-store raw artifact metadata without rewriting the JSON index", async () => {
    const { entityStore, rawArtifactIndex, scanner, sourceRegistry, tempDir } =
      await createScannerHarness();
    const copiedGeminiRoot = path.join(tempDir, "gemini-root-reconcile");

    await cp(geminiFixtureRoot, copiedGeminiRoot, { recursive: true });

    const source = await sourceRegistry.createSource({
      adapterId: "gemini-cli",
      rootPath: copiedGeminiRoot
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const persistedMetadata = await entityStore.listRawArtifactMetadata({
      sourceId: validated.source.sourceId
    });
    const unchanged = await scanner.reconcileSource(validated.source.sourceId);
    const touchTarget = persistedMetadata.find((metadata) => metadata.entry?.path)?.entry?.path;

    expect(await rawArtifactIndex.listSourceEntries(validated.source.sourceId)).toEqual([]);
    expect(persistedMetadata.length).toBeGreaterThan(0);
    expect(unchanged.cache.status).toBe("cached");
    expect(unchanged.scan.status).toBe("scanned-with-diagnostics");

    if (!touchTarget) {
      throw new Error("Expected streamed Gemini raw artifact metadata to include at least one path.");
    }

    const currentStat = await stat(touchTarget);
    const nextTime = new Date(currentStat.mtimeMs + 5_000);

    await utimes(touchTarget, nextTime, nextTime);
    await scanner.reconcileSource(validated.source.sourceId);

    const reconciled = await sourceRegistry.getSource(validated.source.sourceId);

    expect(reconciled?.cache.status).toBe("stale");
    expect(reconciled?.scan.status).toBe("stale");
    expect(reconciled?.cache.reason).toContain("next scan will perform a full reparse");
    expect(reconciled?.scan.reason).toContain("Change summary: 0 added, 0 removed, 1 changed.");
  });

  it("persists partial derived shell summaries when a Gemini shell sidecar is missing but inline output exists", async () => {
    const { entityStore, scanner, sourceRegistry, tempDir } = await createScannerHarness();
    const copiedGeminiRoot = path.join(tempDir, "gemini-root-missing-sidecar");
    const missingSidecarPath = path.join(
      copiedGeminiRoot,
      "alpha-project",
      "tool-outputs",
      "session-11111111-1111-4111-8111-111111111111",
      "run_shell_command_1700000001000_1.txt"
    );

    await cp(geminiFixtureRoot, copiedGeminiRoot, { recursive: true });
    await rm(missingSidecarPath);

    const source = await sourceRegistry.createSource({
      adapterId: "gemini-cli",
      rootPath: copiedGeminiRoot
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const sessionPage = await entityStore.listSessionsPage({
      sourceId: validated.source.sourceId
    });
    const derivedShellCommand = sessionPage.items
      .flatMap((item) => item.session.parsedShellCommands ?? [])
      .find((shellCommand) => shellCommand.command === "npm run typecheck");

    expect(derivedShellCommand).toEqual(
      expect.objectContaining({
        command: "npm run typecheck",
        intent: "typecheck"
      })
    );
    expect(derivedShellCommand?.confidence).not.toEqual(HIGH_CONFIDENCE);
    expect(derivedShellCommand?.diagnosticIds ?? []).toEqual([]);
    expect(
      (
        await entityStore.listDiagnostics({
          sourceId: validated.source.sourceId
        })
      ).some((diagnostic) => diagnostic.code === "gemini-cli.normalize.missing-sidecar")
    ).toBe(false);
  });

  it("fails verification when a fake fixture reports successful tool status with a nonzero shell exit code", async () => {
    const { cacheStore, scanner, sourceRegistry } = await createScannerHarness({
      fakeFixturePath: exitPrecedenceFixturePath
    });
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: exitPrecedenceFixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);
    const derivedSession = cachedRecord?.derived?.sessions[0];

    expect(derivedSession?.shellCommands[0]).toEqual(
      expect.objectContaining({
        result: "failed",
        rawToolStatus: "succeeded"
      })
    );
    expect(derivedSession?.verification?.status).toBe("failed");
  });

  it("keeps the latest verification result per intent when a fake rerun succeeds", async () => {
    const { cacheStore, scanner, sourceRegistry } = await createScannerHarness({
      fakeFixturePath: verificationRerunFixturePath
    });
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: verificationRerunFixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);
    const verification = cachedRecord?.derived?.sessions[0]?.verification;
    const testIntentResult = verification?.intentResults.find((result) => result.intent === "test");

    expect(verification?.status).toBe("passed");
    expect(testIntentResult?.latestStatus).toBe("passed");
    expect(testIntentResult?.commandIds).toHaveLength(2);
  });

  it("uses shared git snapshots in run audit even when adapter git capture is unsupported", async () => {
    const { cacheStore, scanner, sourceRegistry } = await createScannerHarness({
      fakeFixturePath: verificationRerunFixturePath,
      gitSnapshotProvider: new StubGitSnapshotProvider({
        diagnostics: [],
        git: {
          status: "available",
          rootConfidence: "confirmed",
          candidateRootPath: "/tmp/fixture-repo",
          validatedRootPath: "/tmp/fixture-repo",
          diagnosticIds: [],
          snapshot: {
            additions: 0,
            branch: "main",
            changedFiles: 0,
            deletions: 0,
            dirty: false,
            headSha: "abc123",
            untrackedFiles: 0
          }
        }
      })
    });
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: verificationRerunFixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);
    const audit = cachedRecord?.derived?.sessions[0]?.audit;

    expect(audit?.status).toBe("clean");
    expect(audit?.attentionReasons).not.toContain("capability-missing");
  });

  it("persists project-scoped git snapshots and marks otherwise complete dirty claimed runs for review", async () => {
    const { cacheStore, scanner, sourceRegistry, tempDir } = await createScannerHarness();
    const fixturePath = path.join(tempDir, "git-backed.fixture.json");
    const gitRepoRoot = await createGitFixtureRepo(tempDir);
    await rewriteFixtureProjectRoot(verificationRerunFixturePath, fixturePath, gitRepoRoot);

    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);
    const projectSnapshot = cachedRecord?.derived?.projects
      ?.map((project) => project.git)
      .find((git) => git.snapshot?.dirty === true);
    const audit = cachedRecord?.derived?.sessions
      ?.map((session) => session.audit)
      .find((candidate) => candidate?.attentionReasons.includes("dirty-after-claim"));

    expect(projectSnapshot).toEqual(
      expect.objectContaining({
        status: "available",
        snapshot: expect.objectContaining({
          branch: "main",
          dirty: true,
          untrackedFiles: 1
        })
      })
    );
    expect(audit?.status).toMatch(/^(needs-review|verification-failed)$/);
    expect(audit?.attentionReasons).toContain("dirty-after-claim");
    expect(audit?.attentionReasons).not.toContain("pending-tool-calls");
    expect(audit?.attentionReasons).not.toContain("post-claim-activity");
  });

  it("marks fake runs incomplete when claimed completion is followed by pending tool work", async () => {
    const { cacheStore, scanner, sourceRegistry } = await createScannerHarness({
      fakeFixturePath: incompleteRunFixturePath
    });
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: incompleteRunFixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);
    const audit = cachedRecord?.derived?.sessions[0]?.audit;

    expect(audit?.status).toBe("incomplete");
    expect(audit?.attentionReasons).toEqual(
      expect.arrayContaining(["pending-tool-calls", "post-claim-activity"])
    );
  });

  it("marks the source scan as failed when cache persistence throws mid-scan", async () => {
    const { entityStore, fixturePath, rawArtifactIndex, sourceRegistry, tempDir } = await createScannerHarness();
    const scanner = new Scanner({
      adapterRegistry: createBundledAdapterRegistry(),
      cacheStore: new FailingCacheStore(path.join(tempDir, "normalized-cache.json")),
      entityStore,
      projectDir: process.cwd(),
      rawArtifactIndex,
      sourceRegistry,
      watchOrchestrator: new WatchOrchestrator()
    });
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await expect(scanner.scanSource(validated.source.sourceId)).rejects.toThrow(
      "Simulated cache persistence failure."
    );

    const persisted = await sourceRegistry.getSource(validated.source.sourceId);

    expect(persisted?.scan.status).toBe("scan-failed");
    expect(persisted?.cache.status).toBe("unknown");
    expect(
      persisted?.scan.diagnostics.some(
        (diagnostic) => diagnostic.code === "scanner.scan.execution-failed"
      )
    ).toBe(true);
  });
});

async function createGitFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = path.join(baseDir, "fixture-repo");

  await execGit(["init", "-b", "main", repoDir]);
  await execGit(["config", "user.name", "Agent Workbench Tests"], repoDir);
  await execGit(["config", "user.email", "agent-workbench-tests@example.com"], repoDir);
  await writeFile(path.join(repoDir, "README.md"), "# Fixture Repo\n", "utf8");
  await execGit(["add", "README.md"], repoDir);
  await execGit(["commit", "-m", "Initial fixture commit"], repoDir);
  await writeFile(path.join(repoDir, "README.md"), "# Fixture Repo\n\nDirty change\n", "utf8");
  await writeFile(path.join(repoDir, "UNTRACKED.md"), "Untracked file\n", "utf8");
  await execGit(["remote", "add", "origin", "https://github.com/example/control-plus-zebra.git"], repoDir);

  return repoDir;
}

async function execGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, cwd ? { cwd } : undefined);
  return stdout.toString().trim();
}

async function rewriteFixtureProjectRoot(
  sourcePath: string,
  destinationPath: string,
  projectRoot: string
): Promise<void> {
  const source = await readFile(sourcePath, "utf8");
  const parsed = JSON.parse(source) as { project?: { rootPath?: string } };

  parsed.project = {
    ...(parsed.project ?? {}),
    rootPath: projectRoot
  };

  await writeFile(destinationPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}
