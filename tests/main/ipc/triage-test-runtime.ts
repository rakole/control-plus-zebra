import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";

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

  const geminiRoot = path.join(runtime.appDataDir, "gemini-root");

  await cp(geminiFixtureRoot, geminiRoot, { recursive: true });

  const geminiSource = await runtime.sourceRegistry.createSource({
    adapterId: "gemini-cli",
    displayName: "Gemini Fixture Root",
    rootPath: geminiRoot
  });
  const geminiValidated = await runtime.scanner.validateSource(geminiSource.sourceId);

  await runtime.scanner.scanSource(geminiValidated.source.sourceId);
  return runtime;
}

export async function createTempRuntime(tempDirs: string[]) {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-triage-service-"));

  tempDirs.push(appDataDir);
  return createWorkbenchRuntime({
    appDataDir,
    projectDir: process.cwd()
  });
}

export async function cleanupTempDirs(tempDirs: string[]) {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
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
