import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE } from "../model/confidence.js";
import type { Project } from "../model/entities.js";
import type { ProjectGitSnapshot } from "../git/git-snapshot-provider.js";

const execFileAsync = promisify(execFile);
const NO_MATCHING_PR_REASON =
  "No matching pull request was found for the current remote and branch snapshot.";

export interface ProjectGitHubSnapshot {
  checksSummary?: string;
  diagnosticIds: string[];
  pullRequestNumber?: number;
  pullRequestTitle?: string;
  pullRequestUrl?: string;
  reason?: string;
  reviewSummary?: string;
  status: "available" | "no-matching-pr" | "unknown" | "unsupported";
}

export interface ProjectGitHubSnapshotResult {
  diagnostics: Diagnostic[];
  github: ProjectGitHubSnapshot;
}

export interface GhCommandRunner {
  run(args: readonly string[], cwd: string, timeoutMs: number): Promise<{ stderr: string; stdout: string }>;
}

export interface GitHubSnapshotProviderOptions {
  runner?: GhCommandRunner;
  timeoutMs?: number;
}

interface PullRequestViewPayload {
  mergeStateStatus?: string;
  number?: number;
  reviewDecision?: string;
  statusCheckRollup?: unknown;
  title?: string;
  url?: string;
}

export class GitHubSnapshotProvider {
  readonly #runner: GhCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: GitHubSnapshotProviderOptions = {}) {
    this.#runner = options.runner ?? new DefaultGhCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 2_000;
  }

  async collect(
    project: Project,
    gitSnapshot: ProjectGitSnapshot
  ): Promise<ProjectGitHubSnapshotResult> {
    if (gitSnapshot.status !== "available" || !gitSnapshot.snapshot) {
      return this.buildUnavailableResult(
        project,
        "unknown",
        "GitHub context is unavailable because a validated git snapshot is required first."
      );
    }

    if (!gitSnapshot.snapshot.remoteUrl) {
      return this.buildUnavailableResult(
        project,
        "unknown",
        "GitHub context is unavailable because the validated git snapshot did not include a remote URL."
      );
    }

    const repoRef = parseRepoRef(gitSnapshot.snapshot.remoteUrl);

    if (!repoRef) {
      return this.buildUnavailableResult(
        project,
        "unknown",
        "GitHub context is unavailable because Agent Workbench could not parse the repository owner and name from the validated remote URL."
      );
    }

    try {
      const { stdout } = await this.#runner.run(
        [
          "pr",
          "view",
          gitSnapshot.snapshot.branch,
          "--repo",
          repoRef.fullName,
          "--json",
          "number,title,url,reviewDecision,mergeStateStatus,statusCheckRollup"
        ],
        gitSnapshot.validatedRootPath ?? project.rootPath ?? process.cwd(),
        this.#timeoutMs
      );
      const payload = parsePrViewPayload(stdout);
      const checksSummary = summarizeChecks(payload.statusCheckRollup);
      const reviewSummary = summarizeReview(payload.reviewDecision, payload.mergeStateStatus);

      return {
        diagnostics: [],
        github: {
          status: "available",
          ...(payload.number ? { pullRequestNumber: payload.number } : {}),
          ...(payload.title ? { pullRequestTitle: payload.title } : {}),
          ...(payload.url ? { pullRequestUrl: payload.url } : {}),
          ...(checksSummary ? { checksSummary } : {}),
          ...(reviewSummary ? { reviewSummary } : {}),
          diagnosticIds: []
        }
      };
    } catch (error) {
      if (isMissingBinaryError(error)) {
        return this.buildUnavailableResult(
          project,
          "unsupported",
          "GitHub context is unsupported because the shared read-only `gh` CLI is unavailable."
        );
      }

      if (isTimeoutError(error)) {
        return this.buildDiagnosticResult(
          project,
          "unknown",
          "github.snapshot.timeout",
          "GitHub context is unavailable because the shared read-only `gh` snapshot timed out."
        );
      }

      const stderr = getProcessErrorText(error);

      if (matchesNoPullRequest(stderr)) {
        return this.buildDiagnosticResult(project, "no-matching-pr", "github.pr.no-match", NO_MATCHING_PR_REASON);
      }

      if (matchesAuthError(stderr)) {
        return this.buildDiagnosticResult(
          project,
          "unknown",
          "github.auth.required",
          "GitHub context is unavailable because the shared read-only `gh` snapshot is not authenticated for this repository."
        );
      }

      return this.buildDiagnosticResult(
        project,
        "unknown",
        "github.snapshot.failed",
        "GitHub context is unavailable because the shared read-only `gh` snapshot could not be collected for this project."
      );
    }
  }

  private buildDiagnosticResult(
    project: Project,
    status: ProjectGitHubSnapshot["status"],
    code: string,
    message: string
  ): ProjectGitHubSnapshotResult {
    const isNoMatchingPullRequest = code === "github.pr.no-match";
    const diagnostics = [
      buildDiagnostic(
        project.adapterId ?? "unknown-adapter",
        code,
        message,
        isNoMatchingPullRequest ? "info" : "warning",
        "project",
        isNoMatchingPullRequest ? HIGH_CONFIDENCE : MEDIUM_CONFIDENCE,
        {
          ...(project.sourceId ? { sourceId: project.sourceId } : {}),
          nativeId: `${project.nativeId ?? project.id}:${code}`,
          relatedEntityIds: [project.id]
        }
      )
    ];

    return {
      diagnostics,
      github: {
        status,
        reason: message,
        diagnosticIds: diagnostics.map((diagnostic) => diagnostic.id)
      }
    };
  }

  private buildUnavailableResult(
    project: Project,
    status: "unknown" | "unsupported",
    reason: string
  ): ProjectGitHubSnapshotResult {
    return this.buildDiagnosticResult(
      project,
      status,
      status === "unsupported" ? "github.binary.missing" : "github.snapshot.unavailable",
      reason
    );
  }
}

class DefaultGhCommandRunner implements GhCommandRunner {
  async run(
    args: readonly string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ stderr: string; stdout: string }> {
    const { stderr, stdout } = await execFileAsync("gh", [...args], {
      cwd,
      maxBuffer: 1_048_576,
      timeout: timeoutMs
    });

    return {
      stderr: stderr.toString(),
      stdout: stdout.toString()
    };
  }
}

function getProcessErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    if ("stderr" in error && typeof error.stderr === "string") {
      return error.stderr;
    }

    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }

  return "";
}

function isMissingBinaryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (("code" in error && error.code === "ETIMEDOUT") ||
        ("message" in error &&
          typeof error.message === "string" &&
          error.message.toLowerCase().includes("timed out")))
  );
}

function matchesAuthError(value: string): boolean {
  return /auth login|not logged in|authentication/i.test(value);
}

function matchesNoPullRequest(value: string): boolean {
  return /no pull requests? found/i.test(value);
}

function parsePrViewPayload(value: string): PullRequestViewPayload {
  const parsed = JSON.parse(value) as PullRequestViewPayload;
  return parsed;
}

function parseRepoRef(remoteUrl: string): { fullName: string; host: string } | undefined {
  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/u);

  if (sshMatch) {
    return {
      host: sshMatch[1] ?? "github.com",
      fullName: `${sshMatch[2]}/${sshMatch[3]}`
    };
  }

  const httpsMatch = remoteUrl.match(/^(?:https?|ssh):\/\/(?:git@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/u);

  if (httpsMatch) {
    return {
      host: httpsMatch[1] ?? "github.com",
      fullName: `${httpsMatch[2]}/${httpsMatch[3]}`
    };
  }

  return undefined;
}

function summarizeChecks(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const checkStates = value
    .map((entry) => normalizeCheckState(entry))
    .filter((entry): entry is { completed: boolean; failing: boolean } => entry !== undefined);

  if (checkStates.length === 0) {
    return undefined;
  }

  if (checkStates.some((entry) => !entry.completed)) {
    return "Pending";
  }

  const failingCount = checkStates.filter((entry) => entry.failing).length;

  if (failingCount > 0) {
    return `${failingCount} failing`;
  }

  return `${checkStates.length} passing`;
}

function normalizeCheckState(
  value: unknown
): { completed: boolean; failing: boolean } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const status = "status" in value && typeof value.status === "string" ? value.status : undefined;
  const conclusion =
    "conclusion" in value && typeof value.conclusion === "string" ? value.conclusion : undefined;

  return {
    completed: status === "COMPLETED",
    failing:
      conclusion === "FAILURE" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "ACTION_REQUIRED" ||
      conclusion === "CANCELLED" ||
      conclusion === "STARTUP_FAILURE"
  };
}

function summarizeReview(
  reviewDecision?: string,
  mergeStateStatus?: string
): string | undefined {
  const review = humanizeEnumValue(reviewDecision, {
    APPROVED: "Approved",
    CHANGES_REQUESTED: "Changes Requested",
    REVIEW_REQUIRED: "Review Required"
  });
  const merge = humanizeEnumValue(mergeStateStatus, {
    BEHIND: "Behind Base",
    BLOCKED: "Blocked",
    CLEAN: "Merge Clean",
    DIRTY: "Merge Conflicts",
    DRAFT: "Draft",
    HAS_HOOKS: "Hooks Required",
    UNKNOWN: "Merge Unknown",
    UNSTABLE: "Unstable"
  });
  const parts = [review, merge].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function humanizeEnumValue(
  value: string | undefined,
  mapping: Record<string, string>
): string | undefined {
  if (!value) {
    return undefined;
  }

  return mapping[value] ?? value.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
