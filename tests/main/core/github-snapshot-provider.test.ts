import { describe, expect, it } from "vitest";

import { GitHubSnapshotProvider, type GhCommandRunner } from "../../../src/main/core/github/github-snapshot-provider.js";
import type { Project } from "../../../src/main/core/model/entities.js";
import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import type { ProjectGitSnapshot } from "../../../src/main/core/git/git-snapshot-provider.js";

describe("GitHubSnapshotProvider", () => {
  it("collects summary-only PR, checks, and review data from read-only gh output", async () => {
    const runner: GhCommandRunner = {
      async run() {
        return {
          stderr: "",
          stdout: JSON.stringify({
            number: 42,
            title: "Add shared GitHub snapshots",
            url: "https://github.com/example/control-plus-zebra/pull/42",
            reviewDecision: "APPROVED",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }]
          })
        };
      }
    };
    const provider = new GitHubSnapshotProvider({ runner });

    const result = await provider.collect(createProject(), createGitSnapshot());

    expect(result.github).toEqual(
      expect.objectContaining({
        status: "available",
        pullRequestNumber: 42,
        pullRequestTitle: "Add shared GitHub snapshots",
        checksSummary: "1 passing",
        reviewSummary: "Approved · Merge Clean"
      })
    );
  });

  it("returns a neutral no-match state when no pull request matches the branch", async () => {
    const runner: GhCommandRunner = {
      async run() {
        const error = new Error(
          "no pull requests found for branch \"main\""
        ) as NodeJS.ErrnoException & { stderr: string };
        error.stderr = "no pull requests found for branch \"main\"";
        throw error;
      }
    };
    const provider = new GitHubSnapshotProvider({ runner });

    const result = await provider.collect(createProject(), createGitSnapshot());

    expect(result.github.status).toBe("no-matching-pr");
    expect(result.github.reason).toMatch(/No matching pull request/u);
  });

  it("marks github as unsupported when gh is missing", async () => {
    const runner: GhCommandRunner = {
      async run() {
        const error = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    };
    const provider = new GitHubSnapshotProvider({ runner });

    const result = await provider.collect(createProject(), createGitSnapshot());

    expect(result.github.status).toBe("unsupported");
  });

  it("does not attempt github lookup before validated git context exists", async () => {
    const runner: GhCommandRunner = {
      async run() {
        throw new Error("should not run");
      }
    };
    const provider = new GitHubSnapshotProvider({ runner });

    const result = await provider.collect(createProject(), {
      status: "unknown",
      rootConfidence: "unknown",
      diagnosticIds: [],
      reason: "Missing validated repo root."
    });

    expect(result.github.status).toBe("unknown");
    expect(result.github.reason).toMatch(/validated git snapshot is required first/u);
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
    rootPath: "/tmp/project",
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createGitSnapshot(
  overrides: Partial<ProjectGitSnapshot> = {}
): ProjectGitSnapshot {
  return {
    status: "available",
    rootConfidence: "confirmed",
    validatedRootPath: "/tmp/project",
    diagnosticIds: [],
    snapshot: {
      branch: "main",
      headSha: "abc12345",
      dirty: false,
      changedFiles: 0,
      untrackedFiles: 0,
      additions: 0,
      deletions: 0,
      remoteUrl: "https://github.com/example/control-plus-zebra.git"
    },
    ...overrides
  };
}
