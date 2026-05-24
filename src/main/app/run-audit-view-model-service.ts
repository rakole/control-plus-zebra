import {
  getSessionByIdRequestSchema,
  runAuditViewModelSchema,
  type GetSessionByIdRequest,
  type RunAuditViewModel
} from "../ipc/view-models.js";
import {
  buildSessionPreviewViewModel,
  getDerivedSession,
  getDiagnosticsForSession,
  getProjectGitSnapshot,
  getProjectForSession,
  loadTriageData,
  toGitDirtyState,
  toGitFieldValue,
  toGitMetricState,
  toGitStatusState
} from "./triage-view-model-service.js";
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
      const capabilityWarnings = preview.capabilityBadges.filter(
        (badge) => badge.state !== "Supported"
      );
      const project = getProjectForSession(data, session);
      const projectSnapshot = getProjectGitSnapshot(data, project);
      const gitStatus = toGitStatusState(projectSnapshot);
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

      return runAuditViewModelSchema.parse({
        session: preview,
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
                value: String(derived?.verification?.commandIds.length ?? 0),
                tone: "neutral"
              },
              {
                label: "Intent Results",
                value:
                  derived?.verification?.intentResults
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
                value: String(fileMutations.length),
                tone: fileMutations.length > 0 ? "info" : "neutral"
              },
              {
                label: "Latest Paths",
                value:
                  fileMutations.slice(0, 3).map((mutation) => mutation.path).join(", ") ||
                  "None",
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
                value: String(commands.length),
                tone: "neutral"
              },
              {
                label: "Failed Commands",
                value: String(commands.filter((command) => command.result === "failed").length),
                tone:
                  commands.some((command) => command.result === "failed")
                    ? "danger"
                    : "positive"
              },
              {
                label: "Recent Commands",
                value:
                  commands
                    .slice(0, 3)
                    .map((command) => `${command.command} (${humanizeResult(command.result)})`)
                    .join(", ") || "None",
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
                value: project?.rootPath ?? "Unknown",
                tone: project?.rootPath ? "info" : "neutral"
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
                label: "Pull Request",
                value: "Unknown",
                tone: "neutral",
                hint: "GitHub context arrives in the next Phase 7 slice."
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
