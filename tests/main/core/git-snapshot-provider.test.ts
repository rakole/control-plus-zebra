import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitSnapshotProvider, type GitCommandRunner } from "../../../src/main/core/git/git-snapshot-provider.js";
import type { Project } from "../../../src/main/core/model/entities.js";
import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";

const execFileAsync = promisify(execFile);

describe("GitSnapshotProvider", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("collects fixed read-only git fields for validated repositories", async () => {
    const repoDir = await createGitRepo(tempDirs);
    const provider = new GitSnapshotProvider();
    const project = createProject({
      rootPath: repoDir
    });

    const result = await provider.collect(project);

    expect(result.git).toEqual(
      expect.objectContaining({
        status: "available",
        snapshot: expect.objectContaining({
          branch: "main",
          dirty: true,
          changedFiles: 1,
          untrackedFiles: 1,
          remoteUrl: "https://github.com/example/control-plus-zebra.git"
        })
      })
    );
  });

  it("refuses to run git commands for inferred project roots", async () => {
    const repoDir = await createGitRepo(tempDirs);
    const runner: GitCommandRunner = {
      run: vi.fn()
    };
    const provider = new GitSnapshotProvider({ runner });
    const project = createProject({
      metadata: {
        projectRootConfidence: "inferred"
      },
      rootPath: repoDir
    });

    const result = await provider.collect(project);

    expect(result.git.status).toBe("unknown");
    expect(result.git.reason).toMatch(/inferred/u);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("marks git as unsupported when the binary is missing", async () => {
    const repoDir = await createGitRepo(tempDirs);
    const runner: GitCommandRunner = {
      async run() {
        const error = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    };
    const provider = new GitSnapshotProvider({ runner });

    const result = await provider.collect(createProject({ rootPath: repoDir }));

    expect(result.git.status).toBe("unsupported");
    expect(result.git.reason).toMatch(/unsupported/u);
  });

  it("keeps repo truth unknown when validation resolves outside the captured root", async () => {
    const repoDir = await createGitRepo(tempDirs);
    const unrelatedRoot = path.join(path.dirname(repoDir), "unrelated-root");

    await mkdir(unrelatedRoot, { recursive: true });
    const runner: GitCommandRunner = {
      async run(args) {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
          return {
            stderr: "",
            stdout: `${unrelatedRoot}\n`
          };
        }

        return {
          stderr: "",
          stdout: ""
        };
      }
    };
    const provider = new GitSnapshotProvider({ runner });

    const result = await provider.collect(createProject({ rootPath: repoDir }));

    expect(result.git.status).toBe("unknown");
    expect(result.git.reason).toMatch(/validated repository root did not match/u);
  });
});

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    kind: "project",
    id: "project-1",
    adapterId: "fake-test",
    sourceId: "source-1",
    nativeId: "project-1",
    name: "control-plus-zebra",
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

async function createGitRepo(tempDirs: string[]): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-git-provider-"));
  const repoDir = path.join(tempDir, "repo");

  tempDirs.push(tempDir);
  await execGit(["init", "-b", "main", repoDir]);
  await execGit(["config", "user.name", "Agent Workbench Tests"], repoDir);
  await execGit(["config", "user.email", "agent-workbench-tests@example.com"], repoDir);
  await writeFile(path.join(repoDir, "README.md"), "# Fixture Repo\n", "utf8");
  await execGit(["add", "README.md"], repoDir);
  await execGit(["commit", "-m", "Initial fixture commit"], repoDir);
  await writeFile(path.join(repoDir, "README.md"), "# Fixture Repo\n\nDirty work\n", "utf8");
  await writeFile(path.join(repoDir, "UNTRACKED.md"), "Untracked work\n", "utf8");
  await execGit(["remote", "add", "origin", "https://github.com/example/control-plus-zebra.git"], repoDir);

  return repoDir;
}

async function execGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, cwd ? { cwd } : undefined);
  return stdout.toString().trim();
}
