import { ArchiveExporter } from "../core/archive/archive-exporter.js";
import {
  getSessionByIdRequestSchema,
  runAuditViewModelSchema,
  type GetSessionByIdRequest,
  type RunAuditViewModel
} from "../ipc/view-models.js";
import {
  buildSessionPreviewViewModel,
  getProjectDisplayName,
  getProjectGitHubSnapshot,
  getDerivedSession,
  getDiagnosticsForSession,
  getProjectGitSnapshot,
  getProjectForSession,
  loadTriageData,
  toGitDirtyState,
  toGitFieldValue,
  toGitHubPullRequestField,
  toGitHubStatusState,
  toGitHubSummaryField,
  toGitMetricState,
  toGitStatusState
} from "./triage-view-model-service.js";
import { flattenCapabilityGroups } from "./capability-view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

export interface RunAuditViewModelService {
  getRunAudit(request: GetSessionByIdRequest): Promise<RunAuditViewModel | null>;
}

export interface RunAuditViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createRunAuditViewModelService(
  options: RunAuditViewModelServiceOptions = {}
): RunAuditViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const archiveExporter = new ArchiveExporter({
    cacheStore: runtime.cacheStore,
    rawArtifactIndex: runtime.rawArtifactIndex,
    sourceRegistry: runtime.sourceRegistry
  });

  return {
    async getRunAudit(request) {
      const parsed = getSessionByIdRequestSchema.parse(request);
      const data = await loadTriageData(runtime);
      const session = data.sessionsById.get(parsed.sessionId);

      if (!session) {
        return null;
      }

      const preview = buildSessionPreviewViewModel(data, session);
      const derived = getDerivedSession(data, session.id);
      const diagnostics = getDiagnosticsForSession(data, session);
      const fileMutations = data.fileMutationsBySessionId.get(session.id) ?? [];
      const commands = derived?.shellCommands ?? [];
      const capabilityWarnings = flattenCapabilityGroups(preview.capabilityGroups).filter(
        (badge) => badge.state !== "Supported"
      );
      const project = getProjectForSession(data, session);
      const projectRootPath =
        (project as { primaryRootPath?: string; rootPath?: string } | undefined)
          ?.primaryRootPath ??
        (project as { primaryRootPath?: string; rootPath?: string } | undefined)?.rootPath;
      const projectSnapshot = getProjectGitSnapshot(data, project);
      const githubSnapshot = getProjectGitHubSnapshot(data, project);
      const gitStatus = toGitStatusState(projectSnapshot);
      const githubStatus = toGitHubStatusState(githubSnapshot);
      const dirtyState = toGitDirtyState(projectSnapshot);
      const branch = toGitFieldValue(projectSnapshot, (snapshot) => snapshot.branch);
      const head = toGitFieldValue(projectSnapshot, (snapshot) => snapshot.headSha);
      const remoteUrl = toGitFieldValue(
        projectSnapshot,
        (snapshot) => snapshot.remoteUrl,
        {
          unavailableReason:
            projectSnapshot?.remoteReason ?? "No remote URL is configured for this repository."
        }
      );
      const changedFiles = toGitMetricState(projectSnapshot, (snapshot) => snapshot.changedFiles);
      const untrackedFiles = toGitMetricState(projectSnapshot, (snapshot) => snapshot.untrackedFiles);
      const additions = toGitMetricState(projectSnapshot, (snapshot) => snapshot.additions);
      const deletions = toGitMetricState(projectSnapshot, (snapshot) => snapshot.deletions);
      const pullRequest = toGitHubPullRequestField(githubSnapshot);
      const checks = toGitHubSummaryField(githubSnapshot, (snapshot) => snapshot.checksSummary);
      const review = toGitHubSummaryField(githubSnapshot, (snapshot) => snapshot.reviewSummary);
      const archiveExport = await archiveExporter.getScopeAvailability({
        kind: "session",
        sessionId: session.id
      });

      return runAuditViewModelSchema.parse({
        session: preview,
        archiveExport,
        sections: [
          {
            id: "claim-vs-evidence",
            title: "Claim vs Evidence",
            summary: "Compare completion claims against the current shared audit verdict.",
            items: [
              {
                label: "Completion Claim",
                value: humanizeClaim(derived?.audit?.completionClaim),
                tone: "neutral"
              },
              {
                label: "Run Audit",
                value: preview.runAuditState.label,
                tone: preview.runAuditState.tone
              },
              {
                label: "Attention Reasons",
                value:
                  preview.attentionReasons.length > 0
                    ? preview.attentionReasons.join(", ")
                    : "None",
                tone: preview.attentionReasons.length > 0 ? "warning" : "positive"
              }
            ]
          },
          {
            id: "verification",
            title: "Verification",
            summary: "Show the latest shared verification interpretation.",
            items: [
              {
                label: "Verification Status",
                value: preview.verificationState.label,
                tone: preview.verificationState.tone
              },
              {
                label: "Qualifying Commands",
                value:
                  preview.triageMetrics.commands.status === "value"
                    ? String(derived?.verification?.commandIds.length ?? 0)
                    : preview.triageMetrics.commands.displayValue,
                tone: "neutral"
              },
              {
                label: "Intent Results",
                value:
                  preview.triageMetrics.commands.status !== "value"
                    ? preview.triageMetrics.commands.displayValue
                    : derived?.verification?.intentResults
                        .map((result) =>
                          `${result.intent}: ${humanizeResult(result.latestStatus)}`
                        )
                        .join(", ") || "None",
                tone: "neutral"
              }
            ]
          },
          {
            id: "files-changed",
            title: "Files Changed",
            summary: "Keep file evidence explicit without inferring git state yet.",
            items: [
              {
                label: "File Mutations",
                value: preview.evidenceMetrics.fileMutations.displayValue,
                tone:
                  preview.evidenceMetrics.fileMutations.status === "value" &&
                  fileMutations.length > 0
                    ? "info"
                    : "neutral"
              },
              {
                label: "Latest Paths",
                value:
                  preview.evidenceMetrics.fileMutations.status === "value"
                    ? fileMutations.slice(0, 3).map((mutation) => mutation.path).join(", ") ||
                      "None"
                    : preview.evidenceMetrics.fileMutations.displayValue,
                tone: "neutral"
              }
            ]
          },
          {
            id: "commands",
            title: "Commands",
            summary: "Show command evidence without replaying raw output.",
            items: [
              {
                label: "Observed Commands",
                value: preview.triageMetrics.commands.displayValue,
                tone: "neutral"
              },
              {
                label: "Failed Commands",
                value: preview.triageMetrics.failedCommands.displayValue,
                tone:
                  preview.triageMetrics.failedCommands.status === "value" &&
                  commands.some((command) => command.result === "failed")
                    ? "danger"
                    : "positive"
              },
              {
                label: "Recent Commands",
                value:
                  preview.triageMetrics.commands.status === "value"
                    ? commands
                        .slice(0, 3)
                        .map((command) => `${command.command} (${humanizeResult(command.result)})`)
                        .join(", ") || "None"
                    : preview.triageMetrics.commands.displayValue,
                tone: "neutral"
              }
            ]
          },
          {
            id: "cancellation",
            title: "Cancellation / Incompletion",
            summary: "Keep cancellation and incomplete work visible in the audit trail.",
            items: [
              {
                label: "Lifecycle",
                value: preview.lifecycleState.label,
                tone: preview.lifecycleState.tone
              },
              {
                label: "Pending Tool Work",
                value: preview.attentionReasons.includes("Pending Tool Calls") ? "Yes" : "No",
                tone: preview.attentionReasons.includes("Pending Tool Calls")
                  ? "warning"
                  : "positive"
              }
            ]
          },
          {
            id: "git-github",
            title: "Git / GitHub",
            summary: "Show shared read-only repository truth and keep GitHub gaps explicit.",
            items: [
              {
                label: "Git Snapshot",
                value: gitStatus.label,
                tone: gitStatus.tone,
                ...(gitStatus.reason ? { hint: gitStatus.reason } : {})
              },
              {
                label: "Project Root",
                value: projectRootPath ?? getProjectDisplayName(project) ?? "Unknown",
                tone: projectRootPath ? "info" : "neutral"
              },
              {
                label: "Validated Repo Root",
                value: projectSnapshot?.validatedRootPath ?? "Unknown",
                tone: projectSnapshot?.validatedRootPath ? "info" : "neutral",
                ...(projectSnapshot?.reason ? { hint: projectSnapshot.reason } : {})
              },
              {
                label: "Branch",
                value: branch.displayValue,
                tone: branch.status === "value" ? "info" : "neutral",
                ...(branch.reason ? { hint: branch.reason } : {})
              },
              {
                label: "HEAD",
                value: head.displayValue,
                tone: head.status === "value" ? "info" : "neutral",
                ...(head.reason ? { hint: head.reason } : {})
              },
              {
                label: "Repo Cleanliness",
                value: dirtyState.label,
                tone: dirtyState.tone,
                ...(dirtyState.reason ? { hint: dirtyState.reason } : {})
              },
              {
                label: "Changed Files",
                value: changedFiles.displayValue,
                tone: changedFiles.status === "value" ? "info" : "neutral",
                ...(changedFiles.reason ? { hint: changedFiles.reason } : {})
              },
              {
                label: "Untracked Files",
                value: untrackedFiles.displayValue,
                tone: untrackedFiles.status === "value" ? "info" : "neutral",
                ...(untrackedFiles.reason ? { hint: untrackedFiles.reason } : {})
              },
              {
                label: "Additions",
                value: additions.displayValue,
                tone: additions.status === "value" ? "info" : "neutral",
                ...(additions.reason ? { hint: additions.reason } : {})
              },
              {
                label: "Deletions",
                value: deletions.displayValue,
                tone: deletions.status === "value" ? "info" : "neutral",
                ...(deletions.reason ? { hint: deletions.reason } : {})
              },
              {
                label: "Remote URL",
                value: remoteUrl.displayValue,
                tone: remoteUrl.status === "value" ? "info" : "neutral",
                ...(remoteUrl.reason ? { hint: remoteUrl.reason } : {})
              },
              {
                label: "GitHub Snapshot",
                value: githubStatus.label,
                tone: githubStatus.tone,
                ...(githubStatus.reason ? { hint: githubStatus.reason } : {})
              },
              {
                label: "Pull Request",
                value: pullRequest.displayValue,
                tone: pullRequest.status === "value" ? "info" : "neutral",
                ...(pullRequest.reason ? { hint: pullRequest.reason } : {})
              },
              {
                label: "Checks",
                value: checks.displayValue,
                tone: checks.status === "value" ? "info" : "neutral",
                ...(checks.reason ? { hint: checks.reason } : {})
              },
              {
                label: "Review / Merge",
                value: review.displayValue,
                tone: review.status === "value" ? "info" : "neutral",
                ...(review.reason ? { hint: review.reason } : {})
              }
            ]
          },
          {
            id: "capability-gaps",
            title: "Capability Gaps",
            summary: "Unsupported and unknown evidence stays visible instead of reading clean.",
            items: capabilityWarnings.length
              ? capabilityWarnings.map((badge) => ({
                  label: badge.label,
                  value: badge.state,
                  tone: badge.state === "Unsupported" ? "warning" : "neutral",
                  hint: badge.reason
                }))
              : [
                  {
                    label: "Capability Warnings",
                    value: "None",
                    tone: "positive"
                  }
                ]
          },
          {
            id: "parser-diagnostics",
            title: "Parser Diagnostics",
            summary: "Surface parser and normalization uncertainty without raw dumps.",
            items: diagnostics.length
              ? diagnostics.map((diagnostic) => ({
                  label: diagnostic.code,
                  value: diagnostic.message,
                  tone: diagnostic.severity === "error" ? "danger" : "warning"
                }))
              : [
                  {
                    label: "Diagnostics",
                    value: "None",
                    tone: "positive"
                  }
                ]
          }
        ]
      });
    }
  };
}

function humanizeClaim(claim?: string): string {
  switch (claim) {
    case "claimed":
      return "Claimed";
    case "not-claimed":
      return "Not Claimed";
    default:
      return "Unknown";
  }
}

function humanizeResult(result?: string): string {
  switch (result) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    default:
      return "Unknown";
  }
}
