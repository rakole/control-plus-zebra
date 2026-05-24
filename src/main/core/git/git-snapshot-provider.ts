import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { buildDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE } from "../model/confidence.js";
import type { Project } from "../model/entities.js";
import type { ProjectRootConfidence } from "./root-confidence.js";
import { resolveProjectRootCandidate } from "./root-confidence.js";

const execFileAsync = promisify(execFile);

export interface GitSnapshot {
  additions: number;
  branch: string;
  changedFiles: number;
  deletions: number;
  dirty: boolean;
  headSha: string;
  remoteUrl?: string;
  untrackedFiles: number;
}

export interface ProjectGitSnapshot {
  candidateRootPath?: string;
  diagnosticIds: string[];
  reason?: string;
  remoteReason?: string;
  rootConfidence: ProjectRootConfidence;
  snapshot?: GitSnapshot;
  status: "available" | "unknown" | "unsupported";
  validatedRootPath?: string;
}

export interface ProjectGitSnapshotResult {
  diagnostics: Diagnostic[];
  git: ProjectGitSnapshot;
}

export interface GitCommandRunner {
  run(args: readonly string[], cwd: string, timeoutMs: number): Promise<{ stderr: string; stdout: string }>;
}

export interface GitSnapshotProviderOptions {
  runner?: GitCommandRunner;
  timeoutMs?: number;
}

export class GitSnapshotProvider {
  readonly #runner: GitCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: GitSnapshotProviderOptions = {}) {
    this.#runner = options.runner ?? new DefaultGitCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 2_000;
  }

  async collect(project: Project): Promise<ProjectGitSnapshotResult> {
    const candidate = resolveProjectRootCandidate(project);

    if (!candidate.path || candidate.confidence === "inferred" || candidate.confidence === "unknown") {
      return this.buildUnavailableResult(project, candidate.confidence, candidate.path, candidate.reason);
    }

    const resolvedCandidatePath = await this.resolveCandidatePath(project, candidate);

    if ("result" in resolvedCandidatePath) {
      return resolvedCandidatePath.result;
    }

    const validatedRoot = await this.validateRepositoryRoot(project, candidate, resolvedCandidatePath.path);

    if ("result" in validatedRoot) {
      return validatedRoot.result;
    }

    const snapshotResult = await this.collectSnapshot(project, candidate, validatedRoot.path);

    if ("result" in snapshotResult) {
      return snapshotResult.result;
    }

    return {
      diagnostics: snapshotResult.diagnostics,
      git: {
        status: "available",
        rootConfidence: "confirmed",
        candidateRootPath: candidate.path,
        validatedRootPath: validatedRoot.path,
        snapshot: snapshotResult.snapshot,
        ...(snapshotResult.remoteReason ? { remoteReason: snapshotResult.remoteReason } : {}),
        diagnosticIds: snapshotResult.diagnostics.map((diagnostic) => diagnostic.id)
      }
    };
  }

  async validateRepositoryRoot(
    project: Project,
    candidate: ReturnType<typeof resolveProjectRootCandidate>,
    candidatePath: string
  ): Promise<{ path: string } | { result: ProjectGitSnapshotResult }> {
    try {
      const { stdout } = await this.#runner.run(
        ["rev-parse", "--show-toplevel"],
        candidatePath,
        this.#timeoutMs
      );
      const validatedRootPath = stdout.trim();

      if (!validatedRootPath) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unknown",
            candidate.confidence,
            candidate.path,
            "git.root.empty",
            "Git context is unavailable because the repository root could not be resolved."
          )
        };
      }

      const resolvedValidatedRoot = await realpath(validatedRootPath);
      const relativeToValidatedRoot = path.relative(resolvedValidatedRoot, candidatePath);

      if (
        relativeToValidatedRoot.startsWith("..") ||
        path.isAbsolute(relativeToValidatedRoot)
      ) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unknown",
            candidate.confidence,
            candidate.path,
            "git.root.mismatch",
            "Git context is unavailable because the validated repository root did not match the captured project root."
          )
        };
      }

      return {
        path: resolvedValidatedRoot
      };
    } catch (error) {
      if (isTimeoutError(error)) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unknown",
            candidate.confidence,
            candidate.path,
            "git.root.timeout",
            "Git context is unavailable because repository validation timed out."
          )
        };
      }

      if (isMissingBinaryError(error)) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unsupported",
            candidate.confidence,
            candidate.path,
            "git.binary.missing",
            "Git context is unsupported because the shared read-only git binary is unavailable."
          )
        };
      }

      return {
        result: this.buildDiagnosticResult(
          project,
          "unknown",
          candidate.confidence,
          candidate.path,
          "git.root.not-repository",
          "Git context is unavailable because Agent Workbench could not validate a safe repository root for this project."
        )
      };
    }
  }

  private async collectSnapshot(
    project: Project,
    candidate: ReturnType<typeof resolveProjectRootCandidate>,
    validatedRootPath: string
  ): Promise<
    | {
        diagnostics: Diagnostic[];
        remoteReason?: string;
        snapshot: GitSnapshot;
      }
    | { result: ProjectGitSnapshotResult }
  > {
    try {
      const [branchResult, headResult, statusResult, diffResult] = await Promise.all([
        this.#runner.run(["rev-parse", "--abbrev-ref", "HEAD"], validatedRootPath, this.#timeoutMs),
        this.#runner.run(["rev-parse", "HEAD"], validatedRootPath, this.#timeoutMs),
        this.#runner.run(["status", "--porcelain=v1"], validatedRootPath, this.#timeoutMs),
        this.#runner.run(["diff", "--shortstat", "HEAD", "--"], validatedRootPath, this.#timeoutMs)
      ]);
      const statusLines = statusResult.stdout
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
      const changedFiles = statusLines.filter((line) => !line.startsWith("??")).length;
      const untrackedFiles = statusLines.filter((line) => line.startsWith("??")).length;
      const diffSummary = parseDiffShortstat(diffResult.stdout);
      let remoteUrl: string | undefined;
      let remoteReason: string | undefined;
      const diagnostics: Diagnostic[] = [];

      try {
        const remoteResult = await this.#runner.run(
          ["remote", "get-url", "origin"],
          validatedRootPath,
          this.#timeoutMs
        );

        remoteUrl = remoteResult.stdout.trim() || undefined;
        remoteReason = remoteUrl ? undefined : "No remote URL is configured for this repository.";
      } catch (error) {
        if (isTimeoutError(error)) {
          remoteReason = "Remote URL is unknown because the read-only git snapshot timed out.";
          diagnostics.push(
            buildProjectDiagnostic(
              project,
              "git.remote.timeout",
              remoteReason
            )
          );
        } else {
          remoteReason = "No remote URL is configured for this repository.";
        }
      }

      return {
        diagnostics,
        ...(remoteReason ? { remoteReason } : {}),
        snapshot: {
          branch: branchResult.stdout.trim() || "HEAD",
          headSha: headResult.stdout.trim(),
          dirty: statusLines.length > 0,
          changedFiles,
          untrackedFiles,
          additions: diffSummary.additions,
          deletions: diffSummary.deletions,
          ...(remoteUrl ? { remoteUrl } : {})
        }
      };
    } catch (error) {
      if (isTimeoutError(error)) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unknown",
            candidate.confidence,
            candidate.path,
            "git.snapshot.timeout",
            "Git context is unavailable because the shared read-only git snapshot timed out."
          )
        };
      }

      if (isMissingBinaryError(error)) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unsupported",
            candidate.confidence,
            candidate.path,
            "git.binary.missing",
            "Git context is unsupported because the shared read-only git binary is unavailable."
          )
        };
      }

      return {
        result: this.buildDiagnosticResult(
          project,
          "unknown",
          candidate.confidence,
          candidate.path,
          "git.snapshot.failed",
          "Git context is unavailable because the shared read-only git snapshot could not be collected for this project."
        )
      };
    }
  }

  private buildDiagnosticResult(
    project: Project,
    status: ProjectGitSnapshot["status"],
    confidence: ProjectRootConfidence,
    candidateRootPath: string | undefined,
    code: string,
    message: string
  ): ProjectGitSnapshotResult {
    const diagnostics = [buildProjectDiagnostic(project, code, message)];

    return {
      diagnostics,
      git: {
        status,
        rootConfidence: confidence,
        ...(candidateRootPath ? { candidateRootPath } : {}),
        reason: message,
        diagnosticIds: diagnostics.map((diagnostic) => diagnostic.id)
      }
    };
  }

  private buildUnavailableResult(
    project: Project,
    confidence: ProjectRootConfidence,
    candidateRootPath?: string,
    reason?: string
  ): ProjectGitSnapshotResult {
    if (!reason) {
      return {
        diagnostics: [],
        git: {
          status: "unknown",
          rootConfidence: confidence,
          ...(candidateRootPath ? { candidateRootPath } : {}),
          diagnosticIds: []
        }
      };
    }

    return this.buildDiagnosticResult(
      project,
      "unknown",
      confidence,
      candidateRootPath,
      "git.root.insufficient-confidence",
      reason
    );
  }

  private async resolveCandidatePath(
    project: Project,
    candidate: ReturnType<typeof resolveProjectRootCandidate>
  ): Promise<{ path: string } | { result: ProjectGitSnapshotResult }> {
    if (!candidate.path) {
      return {
        result: this.buildUnavailableResult(project, candidate.confidence, undefined, candidate.reason)
      };
    }

    try {
      const candidateStat = await stat(candidate.path);

      if (!candidateStat.isDirectory()) {
        return {
          result: this.buildDiagnosticResult(
            project,
            "unknown",
            candidate.confidence,
            candidate.path,
            "git.root.not-directory",
            "Git context is unavailable because the captured project root is not a directory."
          )
        };
      }

      return {
        path: await realpath(candidate.path)
      };
    } catch {
      return {
        result: this.buildDiagnosticResult(
          project,
          "unknown",
          candidate.confidence,
          candidate.path,
          "git.root.missing",
          "Git context is unavailable because the captured project root no longer exists."
        )
      };
    }
  }
}

class DefaultGitCommandRunner implements GitCommandRunner {
  async run(
    args: readonly string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ stderr: string; stdout: string }> {
    const { stderr, stdout } = await execFileAsync("git", [...args], {
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

function buildProjectDiagnostic(project: Project, code: string, message: string): Diagnostic {
  return buildDiagnostic(
    project.adapterId,
    code,
    message,
    "warning",
    "project",
    code === "git.binary.missing" ? HIGH_CONFIDENCE : MEDIUM_CONFIDENCE,
    {
      sourceId: project.sourceId,
      nativeId: `${project.nativeId}:${code}`,
      relatedEntityIds: [project.id]
    }
  );
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

function parseDiffShortstat(output: string): { additions: number; deletions: number } {
  const additionsMatch = output.match(/(\d+)\s+insertions?\(\+\)/u);
  const deletionsMatch = output.match(/(\d+)\s+deletions?\(-\)/u);

  return {
    additions: additionsMatch ? Number.parseInt(additionsMatch[1] ?? "0", 10) : 0,
    deletions: deletionsMatch ? Number.parseInt(deletionsMatch[1] ?? "0", 10) : 0
  };
}
