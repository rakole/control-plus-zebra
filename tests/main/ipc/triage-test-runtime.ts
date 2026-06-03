import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import {
  syncAllLatestCacheRecordsToEntityStore,
  syncLatestSourceCacheRecordToEntityStore
} from "../../../src/main/app/workbench-entity-store-sync.js";
import type { AdapterCapabilitySnapshots } from "../../../src/main/core/adapter-contract/types.js";
import type { NormalizedCacheRecord } from "../../../src/main/core/cache/file-backed-cache-store.js";
import { GitHubSnapshotProvider } from "../../../src/main/core/github/github-snapshot-provider.js";
import { Scanner } from "../../../src/main/core/ingestion/index.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/raw-artifact-index.js";
import type { OutputArtifact, Session } from "../../../src/main/core/model/entities.js";
import type {
  WorkbenchProjectRollup,
  WorkbenchSessionRecord,
  WorkbenchTimelineRecord
} from "../../../src/main/core/store/workbench-entity-store.js";

const fakeFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);
const geminiFixtureRoot = path.resolve("src/main/adapters/gemini-cli/fixtures/sample-root");
const execFileAsync = promisify(execFile);

export async function createScannedRuntime(tempDirs: string[]) {
  const runtime = await createTempRuntime(tempDirs);
  const gitRepoRoot = await createGitFixtureRepo(runtime.appDataDir);
  const rewrittenFakeFixturePath = await rewriteFakeFixtureProjectRoot(
    runtime.appDataDir,
    gitRepoRoot
  );
  const fakeSource = await runtime.sourceRegistry.createSource({
    adapterId: "fake-test",
    displayName: "Fixture Source",
    rootPath: rewrittenFakeFixturePath
  });
  const fakeValidated = await runtime.scanner.validateSource(fakeSource.sourceId);

  await runtime.scanner.scanSource(fakeValidated.source.sourceId);
  await syncLatestSourceCacheRecordToEntityStore(runtime, fakeValidated.source.sourceId);
  await ensureSourceRawArtifactIndexFromStore(runtime, fakeValidated.source.sourceId);

  const geminiRoot = path.join(runtime.appDataDir, "gemini-root");

  await cp(geminiFixtureRoot, geminiRoot, { recursive: true });

  const geminiSource = await runtime.sourceRegistry.createSource({
    adapterId: "gemini-cli",
    displayName: "Gemini Fixture Root",
    rootPath: geminiRoot
  });
  const geminiValidated = await runtime.scanner.validateSource(geminiSource.sourceId);

  await runtime.scanner.scanSource(geminiValidated.source.sourceId);
  await syncLatestSourceCacheRecordToEntityStore(runtime, geminiValidated.source.sourceId);
  await ensureSourceRawArtifactIndexFromStore(runtime, geminiValidated.source.sourceId);
  await ensureLatestSourceCacheRecord(runtime, geminiValidated.source.sourceId);
  return runtime;
}

export async function createTempRuntime(tempDirs: string[]) {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-triage-service-"));

  tempDirs.push(appDataDir);
  const runtime = createWorkbenchRuntime({
    appDataDir,
    projectDir: process.cwd()
  });
  const githubSnapshotProvider = new GitHubSnapshotProvider({
    runner: {
      async run() {
        const error = new Error(
          "no pull requests found for branch \"main\""
        ) as NodeJS.ErrnoException & { stderr: string };
        error.stderr = "no pull requests found for branch \"main\"";
        throw error;
      }
    }
  });

  runtime.scanner = new Scanner({
    adapterRegistry: runtime.adapterRegistry,
    cacheStore: runtime.cacheStore,
    entityStore: runtime.entityStore,
    githubSnapshotProvider,
    projectDir: process.cwd(),
    rawArtifactIndex: runtime.rawArtifactIndex,
    sourceRegistry: runtime.sourceRegistry,
    watchOrchestrator: runtime.watchOrchestrator
  });
  await syncAllLatestCacheRecordsToEntityStore(runtime);

  return runtime;
}

export async function cleanupTempDirs(tempDirs: string[]) {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
}

export async function ensureLatestSourceCacheRecordForTests(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<void> {
  await ensureLatestSourceCacheRecord(runtime, sourceId);
}

export async function loadGeminiArtifactFixtureFromStore(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  options: { sourceId?: string } = {}
): Promise<{
  sessionId: string;
  sourceId: string;
  plainTextArtifact: OutputArtifact;
  jsonArtifact: OutputArtifact;
  plainTextEntry: RawArtifactIndexEntry;
}> {
  const sources = await runtime.sourceRegistry.listSources();

  for (const source of sources) {
    if (source.adapterId !== "gemini-cli") {
      continue;
    }

    if (options.sourceId && source.sourceId !== options.sourceId) {
      continue;
    }

    const currentRun = await runtime.entityStore.getCurrentIngestRun({
      sourceId: source.sourceId
    });

    if (!currentRun) {
      continue;
    }

    const sessions = await listAllSessionsForSource(runtime, source.sourceId);
    for (const session of sessions) {
      if ((session.outputArtifactIds?.length ?? 0) === 0) {
        continue;
      }

      const outputArtifacts = (
        await Promise.all(
          (session.outputArtifactIds ?? []).map((outputArtifactId) =>
            runtime.entityStore.getOutputArtifact?.({
              sourceId: source.sourceId,
              outputArtifactId
            })
          )
        )
      ).filter((artifact): artifact is OutputArtifact => Boolean(artifact));
      const plainTextArtifact = outputArtifacts.find(
        (artifact) => artifact.contentKind === "plain-text"
      );
      const jsonArtifact = outputArtifacts.find(
        (artifact) => artifact.contentKind === "json-output-wrapper"
      );

      if (!plainTextArtifact || !jsonArtifact) {
        continue;
      }

      const plainTextEntry = await loadRawArtifactEntryForOutputArtifact(
        runtime,
        source.sourceId,
        plainTextArtifact
      );

      if (!plainTextEntry) {
        throw new Error("Expected a durable raw artifact index entry for the plain-text sidecar.");
      }

      return {
        sessionId: session.id,
        sourceId: source.sourceId,
        plainTextArtifact,
        jsonArtifact,
        plainTextEntry
      };
    }
  }

  throw new Error("Expected a Gemini fixture session with both plain-text and JSON output artifacts.");
}

export async function createHydrationDegradedRuntimeFromSeed(
  tempDirs: string[],
  seedRuntime: Awaited<ReturnType<typeof createTempRuntime>>,
  failingSourceId: string
) {
  const runtime = await createTempRuntime(tempDirs);
  const originalBeginIngestRun = runtime.entityStore.beginIngestRun.bind(runtime.entityStore);

  for (const source of await seedRuntime.sourceRegistry.listSources()) {
    await runtime.sourceRegistry.replaceSource(source);
  }

  for (const record of await seedRuntime.cacheStore.listLatestRecords()) {
    await runtime.cacheStore.writeRecord(record);
  }

  runtime.entityStore.beginIngestRun = async (input) => {
    if (input.sourceId === failingSourceId) {
      throw new Error("Simulated bootstrap cache import failure.");
    }

    return originalBeginIngestRun(input);
  };

  return runtime;
}

async function createGitFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = path.join(baseDir, "fixture-repo");

  await writeFile(path.join(baseDir, ".gitkeep"), "", "utf8");
  await execGit(["init", "-b", "main", repoDir]);
  await execGit(["config", "user.name", "Agent Workbench Tests"], repoDir);
  await execGit(["config", "user.email", "agent-workbench-tests@example.com"], repoDir);

  const trackedFile = path.join(repoDir, "README.md");
  await writeFile(trackedFile, "# Fixture Repo\n", "utf8");
  await execGit(["add", "README.md"], repoDir);
  await execGit(["commit", "-m", "Initial fixture commit"], repoDir);

  await writeFile(trackedFile, "# Fixture Repo\n\nPending changes\n", "utf8");
  await writeFile(path.join(repoDir, "UNTRACKED.md"), "Pending untracked work\n", "utf8");
  await execGit(["remote", "add", "origin", "https://github.com/example/control-plus-zebra.git"], repoDir);

  return repoDir;
}

async function listAllSessionsForSource(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<Session[]> {
  const sessionRecords = await listAllSessionRecordsForSource(runtime, sourceId);

  return sessionRecords.map((record) => record.session);
}

async function listAllSessionRecordsForSource(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<WorkbenchSessionRecord[]> {
  const sessions: Session[] = [];
  const sessionRecords: WorkbenchSessionRecord[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await runtime.entityStore.listSessionsPage({
      sourceId,
      ...(cursor ? { cursor } : {}),
      limit: 100
    });

    sessionRecords.push(...page.items);

    if (!page.pageInfo.nextCursor) {
      return sessionRecords;
    }

    cursor = page.pageInfo.nextCursor;
  }
}

async function listAllTimelineRecordsForSession(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string,
  sessionId: string
): Promise<WorkbenchTimelineRecord[]> {
  const timelineRecords: WorkbenchTimelineRecord[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await runtime.entityStore.getSessionTimelinePage({
      sourceId,
      sessionId,
      ...(cursor ? { cursor } : {}),
      limit: 100
    });

    timelineRecords.push(...page.items);

    if (!page.pageInfo.nextCursor) {
      return timelineRecords;
    }

    cursor = page.pageInfo.nextCursor;
  }
}

async function ensureLatestSourceCacheRecord(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<void> {
  const existingRecord = await runtime.cacheStore.getLatestSourceRecord(sourceId);

  if (existingRecord) {
    return;
  }

  const backfilledRecord = await buildStreamedSourceCacheRecord(runtime, sourceId);

  if (!backfilledRecord) {
    return;
  }

  await ensureLatestSourceRawArtifactIndexEntries(
    runtime,
    sourceId,
    backfilledRecord.rawArtifactIndex?.entries ?? []
  );
  await runtime.cacheStore.writeRecord(backfilledRecord);
}

async function buildStreamedSourceCacheRecord(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<NormalizedCacheRecord | undefined> {
  const [source, currentRun, sessionRecords, projectRollups, diagnostics, rawArtifactEntries] =
    await Promise.all([
      runtime.sourceRegistry.getSource(sourceId),
      runtime.entityStore.getCurrentIngestRun({ sourceId }),
      listAllSessionRecordsForSource(runtime, sourceId),
      runtime.entityStore.listProjectRollups({ sourceId }),
      runtime.entityStore.listDiagnostics({ sourceId }),
      loadSourceRawArtifactEntriesFromStore(runtime, sourceId)
    ]);

  if (!source || !currentRun || sessionRecords.length === 0) {
    return undefined;
  }

  const eventsById = new Map<string, WorkbenchTimelineRecord["event"]>();
  const messagesById = new Map<string, NonNullable<WorkbenchTimelineRecord["message"]>>();
  const toolCallsById = new Map<string, NonNullable<WorkbenchTimelineRecord["toolCall"]>>();
  const shellCommandsById = new Map<string, NonNullable<WorkbenchTimelineRecord["shellCommand"]>>();
  const fileMutationsById = new Map<string, NonNullable<WorkbenchTimelineRecord["fileMutation"]>>();
  const outputArtifactsById = new Map<string, OutputArtifact>();

  for (const sessionRecord of sessionRecords) {
    const timelineRecords = await listAllTimelineRecordsForSession(
      runtime,
      sourceId,
      sessionRecord.session.id
    );

    for (const timelineRecord of timelineRecords) {
      eventsById.set(timelineRecord.event.id, timelineRecord.event);

      if (timelineRecord.message) {
        messagesById.set(timelineRecord.message.id, timelineRecord.message);
      }

      if (timelineRecord.toolCall) {
        toolCallsById.set(timelineRecord.toolCall.id, timelineRecord.toolCall);
      }

      if (timelineRecord.shellCommand) {
        shellCommandsById.set(timelineRecord.shellCommand.id, timelineRecord.shellCommand);
      }

      if (timelineRecord.fileMutation) {
        fileMutationsById.set(timelineRecord.fileMutation.id, timelineRecord.fileMutation);
      }

      for (const outputArtifact of timelineRecord.outputArtifacts ?? []) {
        outputArtifactsById.set(outputArtifact.id, outputArtifact);
      }
    }

    for (const outputArtifactId of sessionRecord.session.outputArtifactIds ?? []) {
      const outputArtifact = await runtime.entityStore.getOutputArtifact?.({
        sourceId,
        outputArtifactId
      });

      if (outputArtifact) {
        outputArtifactsById.set(outputArtifact.id, outputArtifact);
      }
    }
  }

  const sessions = sessionRecords.map((record) =>
    sanitizeSessionForCache(record.session)
  );
  const projects = uniqueProjects(projectRollups);
  const capabilitySnapshots = buildCapabilitySnapshots(
    source.adapterId,
    sourceId,
    sessions
  );
  const now = currentRun.publishedAt ?? currentRun.updatedAt;

  return {
    cacheKey: `streamed-backfill-${sourceId}-${now}`,
    adapterId: source.adapterId,
    sourceId,
    artifactFingerprint: createHash("sha256")
      .update(rawArtifactEntries.map((entry) => entry.id).sort().join("\n"))
      .digest("hex"),
    createdAt: now,
    updatedAt: now,
    normalized: {
      adapterId: source.adapterId,
      sourceId,
      capabilities: capabilitySnapshots,
      projects,
      sessions,
      events: [...eventsById.values()],
      messages: [...messagesById.values()],
      toolCalls: [...toolCallsById.values()],
      shellCommands: [...shellCommandsById.values()],
      outputArtifacts: [...outputArtifactsById.values()],
      fileMutations: [...fileMutationsById.values()],
      diagnostics
    },
    diagnostics: {
      entries: diagnostics
    },
    rawArtifactIndex: {
      version: 1,
      entries: rawArtifactEntries
    },
    capabilitySnapshots
  };
}

async function ensureLatestSourceRawArtifactIndexEntries(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string,
  entries: RawArtifactIndexEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const existingEntries = await runtime.rawArtifactIndex.load();

  if (existingEntries.some((entry) => entry.sourceId === sourceId)) {
    return;
  }

  await runtime.rawArtifactIndex.save([
    ...existingEntries.filter((entry) => entry.sourceId !== sourceId),
    ...entries
  ]);
}

async function ensureSourceRawArtifactIndexFromStore(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<void> {
  await ensureLatestSourceRawArtifactIndexEntries(
    runtime,
    sourceId,
    await loadSourceRawArtifactEntriesFromStore(runtime, sourceId)
  );
}

async function loadSourceRawArtifactEntriesFromStore(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string
): Promise<RawArtifactIndexEntry[]> {
  return (await runtime.entityStore.listRawArtifactMetadata({ sourceId }))
    .flatMap((metadata) => (metadata.entry ? [metadata.entry] : []))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueProjects(projectRollups: WorkbenchProjectRollup[]) {
  const projectsById = new Map<string, NonNullable<WorkbenchProjectRollup["project"]>>();

  for (const projectRollup of projectRollups) {
    if (projectRollup.project) {
      projectsById.set(projectRollup.project.id, projectRollup.project);
    }
  }

  return [...projectsById.values()];
}

function sanitizeSessionForCache(session: Session): Session {
  const sanitizedSession = JSON.parse(JSON.stringify(session)) as Session & {
    runAudit?: unknown;
    verification?: unknown;
  };

  delete sanitizedSession.runAudit;
  delete sanitizedSession.verification;

  return sanitizedSession;
}

function buildCapabilitySnapshots(
  adapterId: string,
  sourceId: string,
  sessions: Session[]
): AdapterCapabilitySnapshots {
  const fallbackCapabilities =
    sessions[0]?.capabilities ??
    ({} as AdapterCapabilitySnapshots["adapter"]["capabilities"]);
  const sessionCapabilities = sessions.map((session) => ({
    adapterId,
    sourceId,
    sessionId: session.id,
    capabilities: session.capabilities ?? fallbackCapabilities
  }));

  return {
    adapter: {
      adapterId,
      capabilities: fallbackCapabilities
    },
    source: {
      adapterId,
      sourceId,
      capabilities: fallbackCapabilities
    },
    sessions: sessionCapabilities
  };
}

async function loadRawArtifactEntryForOutputArtifact(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string,
  artifact: OutputArtifact
): Promise<RawArtifactIndexEntry | undefined> {
  const metadataByOutputArtifactId =
    await runtime.entityStore.getRawArtifactMetadataByOutputArtifactId?.({
      sourceId,
      outputArtifactId: artifact.id
    });

  if (metadataByOutputArtifactId?.entry) {
    return metadataByOutputArtifactId.entry;
  }

  const rawArtifactId = artifact.source?.rawArtifactId ?? artifact.source?.artifactId ?? artifact.ref?.id;

  if (!rawArtifactId) {
    return undefined;
  }

  const metadata = await runtime.entityStore.getRawArtifactMetadata({
    sourceId,
    artifactId: rawArtifactId
  });

  return metadata?.entry;
}

async function execGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, cwd ? { cwd } : undefined);
  return stdout.toString().trim();
}

async function rewriteFakeFixtureProjectRoot(
  baseDir: string,
  projectRoot: string
): Promise<string> {
  const destinationPath = path.join(baseDir, "fake-phase1-session.fixture.json");
  const source = await readFile(fakeFixturePath, "utf8");
  const parsed = JSON.parse(source) as {
    project?: { rootPath?: string };
  };

  parsed.project = {
    ...(parsed.project ?? {}),
    rootPath: projectRoot
  };

  await writeFile(destinationPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return destinationPath;
}
