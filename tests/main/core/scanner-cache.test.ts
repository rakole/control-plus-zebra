import { copyFile, cp, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { FileBackedCacheStore } from "../../../src/main/core/cache/index.js";
import {
  GitSnapshotProvider,
  type ProjectGitSnapshotResult
} from "../../../src/main/core/git/git-snapshot-provider.js";
import { RawArtifactIndex, Scanner } from "../../../src/main/core/ingestion/index.js";
import type { Project } from "../../../src/main/core/model/entities.js";
import {
  createBundledAdapterRegistry,
  FileBackedSourceRegistryStore,
  SourceRegistry
} from "../../../src/main/core/registry/index.js";
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
  const watchOrchestrator = new WatchOrchestrator();
  const scanner = new Scanner({
    adapterRegistry: createBundledAdapterRegistry(),
    cacheStore,
    ...(options.gitSnapshotProvider ? { gitSnapshotProvider: options.gitSnapshotProvider } : {}),
    projectDir: process.cwd(),
    rawArtifactIndex,
    sourceRegistry,
    watchOrchestrator
  });

  return {
    cacheStore,
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
    expect(cachedRecord?.normalized.sessions.length).toBeGreaterThan(0);
  });

  it("marks cached source state stale when indexed artifact inputs change", async () => {
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
  });

  it("caches Gemini sessions through the shared scanner pipeline alongside existing bundled adapters", async () => {
    const { cacheStore, scanner, sourceRegistry, tempDir } = await createScannerHarness();
    const copiedGeminiRoot = path.join(tempDir, "gemini-root");

    await cp(geminiFixtureRoot, copiedGeminiRoot, { recursive: true });

    const source = await sourceRegistry.createSource({
      adapterId: "gemini-cli",
      rootPath: copiedGeminiRoot
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecords = await cacheStore.listLatestRecords();
    const geminiRecords = cachedRecords.filter((record) => record.adapterId === "gemini-cli");

    expect(geminiRecords.length).toBeGreaterThan(0);
    expect(geminiRecords.flatMap((record) => record.normalized.sessions).length).toBeGreaterThan(0);
    expect(
      geminiRecords.flatMap((record) => record.derived?.sessions ?? []).flatMap((session) => session.shellCommands)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          intent: "typecheck",
          result: "unknown",
          rawToolStatus: "succeeded"
        })
        ])
    );
    expect(
      geminiRecords
        .flatMap((record) => record.derived?.sessions ?? [])
        .map((session) => session.verification?.status)
    ).toEqual(expect.arrayContaining(["failed", "unknown"]));
    expect(
      geminiRecords.flatMap((record) => record.derived?.sessions ?? []).map((session) => session.audit?.status)
    ).toEqual(expect.arrayContaining(["active", "cancelled", "needs-review"]));
    const failedVerificationSession = geminiRecords
      .flatMap((record) => record.derived?.sessions ?? [])
      .find((session) =>
        session.shellCommands.some(
          (shellCommand) =>
            shellCommand.command === "npm run test -- tests/main/core/run-audit-engine.test.ts" &&
            shellCommand.result === "failed" &&
            shellCommand.rawToolStatus === "succeeded"
        )
      );
    expect(failedVerificationSession?.verification?.status).toBe("failed");
    expect(failedVerificationSession?.audit?.attentionReasons).toContain("failed-verification");
    expect(
      geminiRecords
        .flatMap((record) => record.derived?.sessions ?? [])
        .some((session) => session.audit?.attentionReasons.includes("parser-warning"))
    ).toBe(true);
    expect(
      geminiRecords.some((record) =>
        record.normalized.sessions.some((session) => session.lifecycleState === "completed")
      )
    ).toBe(true);
  });

  it("persists partial derived shell summaries when a Gemini shell sidecar is missing", async () => {
    const { cacheStore, scanner, sourceRegistry, tempDir } = await createScannerHarness();
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

    const cachedRecords = await cacheStore.listLatestRecords();
    const derivedShellCommand = cachedRecords
      .filter((record) => record.adapterId === "gemini-cli")
      .flatMap((record) => record.derived?.sessions ?? [])
      .flatMap((session) => session.shellCommands)
      .find((shellCommand) => shellCommand.command === "npm run typecheck");

    expect(derivedShellCommand).toEqual(
      expect.objectContaining({
        command: "npm run typecheck",
        intent: "typecheck"
      })
    );
    expect(derivedShellCommand?.confidence.level).not.toBe("high");
    expect(derivedShellCommand?.diagnosticIds?.length ?? 0).toBeGreaterThan(0);
    expect(
      cachedRecords
        .filter((record) => record.adapterId === "gemini-cli")
        .some((record) =>
          record.normalized.diagnostics.some(
            (diagnostic) => diagnostic.code === "gemini-cli.normalize.missing-sidecar"
          )
        )
    ).toBe(true);
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
    const projectSnapshot = cachedRecord?.derived?.projects?.[0]?.git;
    const audit = cachedRecord?.derived?.sessions[0]?.audit;

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
    expect(audit?.status).toBe("needs-review");
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
    const { fixturePath, rawArtifactIndex, sourceRegistry, tempDir } = await createScannerHarness();
    const scanner = new Scanner({
      adapterRegistry: createBundledAdapterRegistry(),
      cacheStore: new FailingCacheStore(path.join(tempDir, "normalized-cache.json")),
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
