import {
  ArchiveExporter,
  type ArchiveExportAvailability,
} from "../core/archive/archive-exporter.js";
import {
  getSessionByIdRequestSchema,
  runAuditViewModelSchema,
  type GetSessionByIdRequest,
  type RunAuditViewModel,
} from "../ipc/view-models.js";
import type { ShellCommandEvidence } from "../core/model/entities.js";
import type { ParsedShellCommand } from "../core/shell/types.js";
import {
  buildUnavailableArchiveExport,
  getDerivedSession,
  getDiagnosticsForSession,
  getProjectDisplayName,
  getProjectForSession,
  getProjectGitHubSnapshot,
  getProjectGitSnapshot,
  loadStoreTriageData,
  shouldIncludeDiagnosticInUi,
  toGitDirtyState,
  toGitFieldValue,
  toGitHubPullRequestField,
  toGitHubStatusState,
  toGitHubSummaryField,
  toGitMetricState,
  toGitStatusState,
} from "./triage-view-model-service.js";
import { flattenCapabilityGroups } from "./capability-view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions,
} from "./workbench-runtime.js";
import {
  createSessionViewModelService,
  type SessionViewModelService,
} from "./session-view-model-service.js";
import {
  collectAllSessionTimelineRecords,
  findStoreSessionLocation,
  listProjectRollupsBySourceId,
} from "./store-session-query.js";
import { getCommandDisplayStatus } from "./command-status-view-models.js";
import { isGithubUiEnabled } from "../../shared/feature-flags.js";
import { isGitHubHostedRemoteUrl } from "../../shared/github-ui.js";

export interface RunAuditViewModelService {
  getRunAudit(
    request: GetSessionByIdRequest,
  ): Promise<RunAuditViewModel | null>;
}

export interface RunAuditViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createRunAuditViewModelService(
  options: RunAuditViewModelServiceOptions = {},
): RunAuditViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const sessionService = createSessionViewModelService({ runtime });
  const archiveExporter = new ArchiveExporter({
    cacheStore: runtime.cacheStore,
    entityStore: runtime.entityStore,
    rawArtifactIndex: runtime.rawArtifactIndex,
    sourceRegistry: runtime.sourceRegistry,
  });

  return {
    async getRunAudit(request) {
      const parsed = getSessionByIdRequestSchema.parse(request);
      const location = await findStoreSessionLocation(
        runtime,
        parsed.sessionId,
      );

      if (!location) {
        return null;
      }

      const degradedState = (
        await runtime.getEntityStoreHydrationState()
      ).sourceStates.find(
        (state) =>
          state.sourceId === location.source.sourceId &&
          state.status === "cache-fallback",
      );

      if (degradedState) {
        return buildCacheFallbackRunAuditViewModel(
          runtime,
          sessionService,
          parsed.sessionId,
          degradedState.reason,
        );
      }

      const [preview, diagnostics, projectRollups, timelineRecords] =
        await Promise.all([
          sessionService.getSessionById({ sessionId: parsed.sessionId }),
          runtime.entityStore.listDiagnostics({
            sourceId: location.source.sourceId,
            sessionId: parsed.sessionId,
          }),
          listProjectRollupsBySourceId(runtime, location.source.sourceId),
          collectAllSessionTimelineRecords(
            runtime,
            location.source.sourceId,
            parsed.sessionId,
          ),
        ]);

      if (!preview) {
        return null;
      }

      const session = {
        ...location.session,
        ...(location.record?.verification
          ? { verification: location.record.verification }
          : {}),
        ...(location.record?.runAudit
          ? { runAudit: location.record.runAudit }
          : {}),
      };
      const fileMutations = timelineRecords
        .map((record) => record.fileMutation)
        .filter((mutation): mutation is NonNullable<typeof mutation> =>
          Boolean(mutation),
        );
      const commandEntries = buildRunAuditCommandEntries({
        parsedShellCommands: session.parsedShellCommands ?? [],
        shellCommands: timelineRecords
          .map((record) => record.shellCommand)
          .filter((shellCommand): shellCommand is ShellCommandEvidence =>
            Boolean(shellCommand),
          ),
      });
      const capabilityWarnings = flattenCapabilityGroups(
        preview.capabilityGroups,
      ).filter((badge) => badge.state !== "Supported");
      const visibleDiagnostics = diagnostics.filter(
        shouldIncludeDiagnosticInUi,
      );
      const project = session.projectId
        ? projectRollups.get(session.projectId)?.project
        : undefined;
      const projectRootPath =
        (project as { primaryRootPath?: string; rootPath?: string } | undefined)
          ?.primaryRootPath ??
        (project as { primaryRootPath?: string; rootPath?: string } | undefined)
          ?.rootPath;
      const projectRollup = session.projectId
        ? projectRollups.get(session.projectId)
        : undefined;
      const projectSnapshot = projectRollup?.git;
      const githubSnapshot = projectRollup?.github;
      const gitStatus = toGitStatusState(projectSnapshot);
      const githubStatus = toGitHubStatusState(githubSnapshot);
      const dirtyState = toGitDirtyState(projectSnapshot);
      const branch = toGitFieldValue(
        projectSnapshot,
        (snapshot) => snapshot.branch,
      );
      const head = toGitFieldValue(
        projectSnapshot,
        (snapshot) => snapshot.headSha,
      );
      const remoteUrl = toGitFieldValue(
        projectSnapshot,
        (snapshot) => snapshot.remoteUrl,
        {
          unavailableReason:
            projectSnapshot?.remoteReason ??
            "No remote URL is configured for this repository.",
        },
      );
      const changedFiles = toGitMetricState(
        projectSnapshot,
        (snapshot) => snapshot.changedFiles,
      );
      const untrackedFiles = toGitMetricState(
        projectSnapshot,
        (snapshot) => snapshot.untrackedFiles,
      );
      const additions = toGitMetricState(
        projectSnapshot,
        (snapshot) => snapshot.additions,
      );
      const deletions = toGitMetricState(
        projectSnapshot,
        (snapshot) => snapshot.deletions,
      );
      const pullRequest = toGitHubPullRequestField(githubSnapshot);
      const checks = toGitHubSummaryField(
        githubSnapshot,
        (snapshot) => snapshot.checksSummary,
      );
      const review = toGitHubSummaryField(
        githubSnapshot,
        (snapshot) => snapshot.reviewSummary,
      );
      let archiveExport: ArchiveExportAvailability;

      try {
        archiveExport = await archiveExporter.getScopeAvailability({
          kind: "session",
          sessionId: session.id,
        });
      } catch {
        archiveExport = buildUnavailableArchiveExport(
          {
            archiveScope: {
              kind: "session",
              sessionId: session.id,
            },
            latestSession: session,
            projectSessions: [session],
          },
          project,
        );
      }

      return runAuditViewModelSchema.parse({
        session: preview,
        archiveExport,
        sections: [
          {
            id: "claim-vs-evidence",
            title: "Claim vs Evidence",
            summary:
              "Compare completion claims against the current shared audit verdict.",
            items: [
              {
                label: "Completion Claim",
                value: humanizeClaim(session.runAudit?.completionClaim),
                tone: "neutral",
              },
              {
                label: "Run Audit",
                value: preview.runAuditState.label,
                tone: preview.runAuditState.tone,
              },
              {
                label: "Attention Reasons",
                value:
                  preview.attentionReasons.length > 0
                    ? preview.attentionReasons.join(", ")
                    : "None",
                tone:
                  preview.attentionReasons.length > 0 ? "warning" : "positive",
              },
            ],
          },
          {
            id: "verification",
            title: "Verification",
            summary: "Show the latest shared verification interpretation.",
            items: [
              {
                label: "Verification Status",
                value: preview.verificationState.label,
                tone: preview.verificationState.tone,
              },
              {
                label: "Qualifying Commands",
                value:
                  preview.triageMetrics.commands.status === "value"
                    ? String(session.verification?.commandIds.length ?? 0)
                    : preview.triageMetrics.commands.displayValue,
                tone: "neutral",
              },
              {
                label: "Intent Results",
                value:
                  preview.triageMetrics.commands.status !== "value"
                    ? preview.triageMetrics.commands.displayValue
                    : session.verification?.intentResults
                        .map(
                          (result) =>
                            `${result.intent}: ${humanizeResult(result.latestStatus)}`,
                        )
                        .join(", ") || "None",
                tone: "neutral",
              },
            ],
          },
          {
            id: "files-changed",
            title: "Files Changed",
            summary:
              "Keep file evidence explicit without inferring git state yet.",
            items: [
              {
                label: "File Mutations",
                value: preview.evidenceMetrics.fileMutations.displayValue,
                tone:
                  preview.evidenceMetrics.fileMutations.status === "value" &&
                  fileMutations.length > 0
                    ? "info"
                    : "neutral",
              },
              {
                label: "Latest Paths",
                value:
                  preview.evidenceMetrics.fileMutations.status === "value"
                    ? fileMutations
                        .slice(0, 3)
                        .map((mutation) => mutation.path)
                        .join(", ") || "None"
                    : preview.evidenceMetrics.fileMutations.displayValue,
                tone: "neutral",
              },
            ],
          },
          {
            id: "commands",
            title: "Commands",
            summary: "Show command evidence without replaying raw output.",
            items: [
              {
                label: "Observed Commands",
                value:
                  commandEntries.length > 0
                    ? String(commandEntries.length)
                    : preview.triageMetrics.commands.displayValue,
                tone: "neutral",
              },
              {
                label: "Failed Commands",
                value:
                  commandEntries.length > 0
                    ? String(
                        commandEntries.filter((command) => command.isFailure)
                          .length,
                      )
                    : preview.triageMetrics.failedCommands.displayValue,
                tone: getFailedCommandsTone(commandEntries),
              },
              {
                label: "Recent Commands",
                value:
                  commandEntries.length > 0
                    ? "Recent command activity"
                    : "None",
                kind: "command-list",
                commands: commandEntries.map((command) => ({
                  command: command.command,
                  result: command.result,
                })),
                tone: "neutral",
              },
            ],
          },
          {
            id: "cancellation",
            title: "Cancellation / Incompletion",
            summary:
              "Keep cancellation and incomplete work visible in the audit trail.",
            items: [
              {
                label: "Lifecycle",
                value: preview.lifecycleState.label,
                tone: preview.lifecycleState.tone,
              },
              {
                label: "Pending Tool Work",
                value: preview.attentionReasons.includes("Pending Tool Calls")
                  ? "Yes"
                  : "No",
                tone: preview.attentionReasons.includes("Pending Tool Calls")
                  ? "warning"
                  : "positive",
              },
            ],
          },
          buildRepositorySection({
            gitStatus,
            githubStatus,
            projectLabel:
              projectRootPath ?? getProjectDisplayName(project) ?? "Unknown",
            projectLabelName: "Project Root",
            validatedRootLabel: "Validated Repo Root",
            validatedRootValue: projectSnapshot?.validatedRootPath ?? "Unknown",
            validatedRootTone: projectSnapshot?.validatedRootPath
              ? "info"
              : "neutral",
            validatedRootHint: projectSnapshot?.reason,
            branchDisplayValue: branch.displayValue,
            branchTone: branch.status === "value" ? "info" : "neutral",
            branchHint: branch.reason,
            headLabel: "HEAD",
            headDisplayValue: head.displayValue,
            headTone: head.status === "value" ? "info" : "neutral",
            headHint: head.reason,
            dirtyLabel: "Repo Cleanliness",
            dirtyState,
            changedFilesDisplayValue: changedFiles.displayValue,
            changedFilesTone:
              changedFiles.status === "value" ? "info" : "neutral",
            changedFilesHint: changedFiles.reason,
            untrackedFilesDisplayValue: untrackedFiles.displayValue,
            untrackedFilesTone:
              untrackedFiles.status === "value" ? "info" : "neutral",
            untrackedFilesHint: untrackedFiles.reason,
            additionsDisplayValue: additions.displayValue,
            additionsTone: additions.status === "value" ? "info" : "neutral",
            additionsHint: additions.reason,
            deletionsDisplayValue: deletions.displayValue,
            deletionsTone: deletions.status === "value" ? "info" : "neutral",
            deletionsHint: deletions.reason,
            remoteUrlDisplayValue: remoteUrl.displayValue,
            remoteUrlTone: remoteUrl.status === "value" ? "info" : "neutral",
            remoteUrlHint: remoteUrl.reason,
            pullRequestDisplayValue: pullRequest.displayValue,
            pullRequestTone:
              pullRequest.status === "value" ? "info" : "neutral",
            pullRequestHint: pullRequest.reason,
            checksDisplayValue: checks.displayValue,
            checksTone: checks.status === "value" ? "info" : "neutral",
            checksHint: checks.reason,
            reviewLabel: "Review / Merge",
            reviewDisplayValue: review.displayValue,
            reviewTone: review.status === "value" ? "info" : "neutral",
            reviewHint: review.reason,
          }),
          {
            id: "capability-gaps",
            title: "Capability Gaps",
            summary:
              "Unsupported and unknown evidence stays visible instead of reading clean.",
            items: capabilityWarnings.length
              ? capabilityWarnings.map((badge) => ({
                  label: badge.label,
                  value: badge.state,
                  tone: badge.state === "Unsupported" ? "neutral" : "warning",
                  hint: badge.reason,
                }))
              : [
                  {
                    label: "Capability Warnings",
                    value: "None",
                    tone: "positive",
                  },
                ],
          },
          {
            id: "parser-diagnostics",
            title: "Parser Diagnostics",
            summary:
              "Surface parser and normalization uncertainty without raw dumps.",
            items: visibleDiagnostics.length
              ? visibleDiagnostics.map((diagnostic) => ({
                  label: diagnostic.code,
                  value: diagnostic.message,
                  tone: diagnostic.severity === "error" ? "danger" : "warning",
                }))
              : [
                  {
                    label: "Diagnostics",
                    value: "None",
                    tone: "positive",
                  },
                ],
          },
        ],
      });
    },
  };
}

async function buildCacheFallbackRunAuditViewModel(
  runtime: WorkbenchRuntime,
  sessionService: SessionViewModelService,
  sessionId: string,
  degradedReason?: string,
): Promise<RunAuditViewModel | null> {
  const data = await loadStoreTriageData(runtime, undefined, {
    includeSessionDiagnostics: true,
  });
  const session = data.sessionsById.get(sessionId);
  const preview = await sessionService.getSessionById({ sessionId });

  if (!session || !preview) {
    return null;
  }

  const fileMutations = data.fileMutationsBySessionId.get(session.id) ?? [];
  const diagnostics = getDiagnosticsForSession(data, session).filter(
    shouldIncludeDiagnosticInUi,
  );
  const commandEntries = buildRunAuditCommandEntries({
    parsedShellCommands:
      getDerivedSession(data, session.id)?.shellCommands ??
      session.parsedShellCommands ??
      [],
    shellCommands: data.shellCommandsBySessionId.get(session.id) ?? [],
  });
  const capabilityWarnings = flattenCapabilityGroups(
    preview.capabilityGroups,
  ).filter((badge) => badge.state !== "Supported");
  const project = getProjectForSession(data, session);
  const projectRootPath =
    (project as { primaryRootPath?: string; rootPath?: string } | undefined)
      ?.primaryRootPath ??
    (project as { primaryRootPath?: string; rootPath?: string } | undefined)
      ?.rootPath;
  const projectSnapshot = getProjectGitSnapshot(data, project);
  const githubSnapshot = getProjectGitHubSnapshot(data, project);
  const gitStatus = toGitStatusState(projectSnapshot);
  const githubStatus = toGitHubStatusState(githubSnapshot);
  const dirtyState = toGitDirtyState(projectSnapshot);
  const branch = toGitFieldValue(
    projectSnapshot,
    (snapshot) => snapshot.branch,
  );
  const head = toGitFieldValue(projectSnapshot, (snapshot) => snapshot.headSha);
  const remoteUrl = toGitFieldValue(
    projectSnapshot,
    (snapshot) => snapshot.remoteUrl,
    {
      unavailableReason:
        projectSnapshot?.remoteReason ??
        "No remote URL is configured for this repository.",
    },
  );
  const changedFiles = toGitMetricState(
    projectSnapshot,
    (snapshot) => snapshot.changedFiles,
  );
  const untrackedFiles = toGitMetricState(
    projectSnapshot,
    (snapshot) => snapshot.untrackedFiles,
  );
  const additions = toGitMetricState(
    projectSnapshot,
    (snapshot) => snapshot.additions,
  );
  const deletions = toGitMetricState(
    projectSnapshot,
    (snapshot) => snapshot.deletions,
  );
  const pullRequest = toGitHubPullRequestField(githubSnapshot);
  const checks = toGitHubSummaryField(
    githubSnapshot,
    (snapshot) => snapshot.checksSummary,
  );
  const review = toGitHubSummaryField(
    githubSnapshot,
    (snapshot) => snapshot.reviewSummary,
  );
  const archiveExport = buildUnavailableArchiveExport(
    {
      archiveScope: {
        kind: "session",
        sessionId: session.id,
      },
      latestSession: session,
      projectSessions: [session],
    },
    project,
    degradedReason,
  );

  return runAuditViewModelSchema.parse({
    session: preview,
    archiveExport,
    sections: [
      {
        id: "claim-vs-evidence",
        title: "Claim vs Evidence",
        summary:
          "Compare completion claims against the current shared audit verdict.",
        items: [
          {
            label: "Completion Claim",
            value: humanizeClaim(session.runAudit?.completionClaim),
            tone: "neutral",
          },
          {
            label: "Run Audit",
            value: preview.runAuditState.label,
            tone: preview.runAuditState.tone,
          },
          {
            label: "Attention Reasons",
            value:
              preview.attentionReasons.length > 0
                ? preview.attentionReasons.join(", ")
                : "None",
            tone: preview.attentionReasons.length > 0 ? "warning" : "positive",
          },
        ],
      },
      {
        id: "verification",
        title: "Verification",
        summary: "Show the latest shared verification interpretation.",
        items: [
          {
            label: "Verification Status",
            value: preview.verificationState.label,
            tone: preview.verificationState.tone,
          },
          {
            label: "Qualifying Commands",
            value:
              preview.triageMetrics.commands.status === "value"
                ? String(session.verification?.commandIds.length ?? 0)
                : preview.triageMetrics.commands.displayValue,
            tone: "neutral",
          },
          {
            label: "Intent Results",
            value:
              preview.triageMetrics.commands.status !== "value"
                ? preview.triageMetrics.commands.displayValue
                : session.verification?.intentResults
                    .map(
                      (result) =>
                        `${result.intent}: ${humanizeResult(result.latestStatus)}`,
                    )
                    .join(", ") || "None",
            tone: "neutral",
          },
        ],
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
                : "neutral",
          },
          {
            label: "Latest Paths",
            value:
              preview.evidenceMetrics.fileMutations.status === "value"
                ? fileMutations
                    .slice(0, 3)
                    .map((mutation) => mutation.path)
                    .join(", ") || "None"
                : preview.evidenceMetrics.fileMutations.displayValue,
            tone: "neutral",
          },
        ],
      },
      {
        id: "commands",
        title: "Commands",
        summary: "Show command evidence without replaying raw output.",
        items: [
          {
            label: "Observed Commands",
            value:
              commandEntries.length > 0
                ? String(commandEntries.length)
                : preview.triageMetrics.commands.displayValue,
            tone: "neutral",
          },
          {
            label: "Failed Commands",
            value:
              commandEntries.length > 0
                ? String(
                    commandEntries.filter((command) => command.isFailure)
                      .length,
                  )
                : preview.triageMetrics.failedCommands.displayValue,
            tone: getFailedCommandsTone(commandEntries),
          },
          {
            label: "Recent Commands",
            value:
              commandEntries.length > 0 ? "Recent command activity" : "None",
            kind: "command-list",
            commands: commandEntries.map((command) => ({
              command: command.command,
              result: command.result,
            })),
            tone: "neutral",
          },
        ],
      },
      {
        id: "cancellation",
        title: "Cancellation / Incompletion",
        summary:
          "Keep cancellation and incomplete work visible in the audit trail.",
        items: [
          {
            label: "Lifecycle",
            value: preview.lifecycleState.label,
            tone: preview.lifecycleState.tone,
          },
          {
            label: "Pending Tool Work",
            value: preview.attentionReasons.includes("Pending Tool Calls")
              ? "Yes"
              : "No",
            tone: preview.attentionReasons.includes("Pending Tool Calls")
              ? "warning"
              : "positive",
          },
        ],
      },
      buildRepositorySection({
        gitStatus,
        githubStatus,
        projectLabel: getProjectDisplayName(project) ?? "Unknown Project",
        projectLabelName: "Project",
        validatedRootLabel: "Validated Root",
        validatedRootValue: projectRootPath ?? "Unknown",
        validatedRootTone: projectRootPath ? "neutral" : "warning",
        branchDisplayValue: branch.displayValue,
        branchTone: "neutral",
        headLabel: "Head",
        headDisplayValue: head.displayValue,
        headTone: "neutral",
        dirtyLabel: "Dirty State",
        dirtyState,
        changedFilesDisplayValue: changedFiles.displayValue,
        changedFilesTone:
          changedFiles.status === "value" ? "neutral" : "warning",
        untrackedFilesDisplayValue: untrackedFiles.displayValue,
        untrackedFilesTone:
          untrackedFiles.status === "value" ? "neutral" : "warning",
        additionsDisplayValue: additions.displayValue,
        additionsTone: additions.status === "value" ? "neutral" : "warning",
        deletionsDisplayValue: deletions.displayValue,
        deletionsTone: deletions.status === "value" ? "neutral" : "warning",
        remoteUrlDisplayValue: remoteUrl.displayValue,
        remoteUrlTone: remoteUrl.status === "value" ? "neutral" : "warning",
        pullRequestDisplayValue: pullRequest.displayValue,
        pullRequestTone: pullRequest.status === "value" ? "neutral" : "warning",
        checksDisplayValue: checks.displayValue,
        checksTone: checks.status === "value" ? "neutral" : "warning",
        reviewLabel: "Review Status",
        reviewDisplayValue: review.displayValue,
        reviewTone: review.status === "value" ? "neutral" : "warning",
      }),
      {
        id: "diagnostics",
        title: "Diagnostics",
        summary: "Keep parser and ingestion warnings visible.",
        items: [
          {
            label: "Diagnostics",
            value: String(diagnostics.length),
            tone: diagnostics.length > 0 ? "warning" : "positive",
          },
          {
            label: "Top Signals",
            value:
              diagnostics
                .slice(0, 3)
                .map((diagnostic) => diagnostic.code)
                .join(", ") || "None",
            tone: "neutral",
          },
        ],
      },
      {
        id: "capability-gaps",
        title: "Capability Gaps",
        summary:
          "Keep missing harness evidence explicit instead of collapsing it away.",
        items:
          capabilityWarnings.length > 0
            ? capabilityWarnings.map((warning) => ({
                label: warning.label,
                value: warning.state,
                tone:
                  warning.state === "Unsupported"
                    ? "neutral"
                    : warning.state === "Unknown"
                      ? "warning"
                      : "positive",
                ...(warning.reason ? { hint: warning.reason } : {}),
              }))
            : [
                {
                  label: "Capabilities",
                  value: "Supported",
                  tone: "positive",
                },
              ],
      },
    ],
  });
}

function buildRunAuditCommandEntries(args: {
  parsedShellCommands: ParsedShellCommand[];
  shellCommands: ShellCommandEvidence[];
}): Array<{ command: string; isFailure: boolean; result: string }> {
  const parsedById = new Map(
    args.parsedShellCommands.map(
      (command) => [command.shellCommandId, command] as const,
    ),
  );
  const commandEntries = args.shellCommands.map((shellCommand) => {
    const parsedShellCommand = parsedById.get(shellCommand.id);
    const displayStatus = getCommandDisplayStatus({
      ...(parsedShellCommand ? { parsedShellCommand } : {}),
      shellCommand,
    });

    return {
      command:
        shellCommand.command ??
        parsedShellCommand?.command ??
        "run_shell_command",
      isFailure: displayStatus.isFailure,
      result: displayStatus.label,
    };
  });

  if (commandEntries.length > 0) {
    return commandEntries;
  }

  return args.parsedShellCommands.map((command) => {
    const displayStatus = getCommandDisplayStatus({
      parsedShellCommand: command,
    });

    return {
      command: command.command,
      isFailure: displayStatus.isFailure,
      result: displayStatus.label,
    };
  });
}

function getFailedCommandsTone(
  commandEntries: Array<{ isFailure: boolean; result: string }>,
): "neutral" | "positive" | "danger" {
  if (commandEntries.length === 0) {
    return "neutral";
  }

  if (commandEntries.some((command) => command.isFailure)) {
    return "danger";
  }

  return commandEntries.every((command) => command.result === "Succeeded")
    ? "positive"
    : "neutral";
}

function buildRepositorySection(args: {
  gitStatus: {
    label: string;
    tone: "neutral" | "positive" | "warning" | "danger" | "info";
    reason?: string | undefined;
  };
  githubStatus: {
    label: string;
    tone: "neutral" | "positive" | "warning" | "danger" | "info";
    reason?: string | undefined;
  };
  projectLabel: string;
  projectLabelName: string;
  validatedRootLabel: string;
  validatedRootValue: string;
  validatedRootTone: "neutral" | "positive" | "warning" | "danger" | "info";
  validatedRootHint?: string | undefined;
  branchDisplayValue: string;
  branchTone: "neutral" | "positive" | "warning" | "danger" | "info";
  branchHint?: string | undefined;
  headLabel: string;
  headDisplayValue: string;
  headTone: "neutral" | "positive" | "warning" | "danger" | "info";
  headHint?: string | undefined;
  dirtyLabel: string;
  dirtyState: {
    label: string;
    tone: "neutral" | "positive" | "warning" | "danger" | "info";
    reason?: string | undefined;
  };
  changedFilesDisplayValue: string;
  changedFilesTone: "neutral" | "positive" | "warning" | "danger" | "info";
  changedFilesHint?: string | undefined;
  untrackedFilesDisplayValue: string;
  untrackedFilesTone: "neutral" | "positive" | "warning" | "danger" | "info";
  untrackedFilesHint?: string | undefined;
  additionsDisplayValue: string;
  additionsTone: "neutral" | "positive" | "warning" | "danger" | "info";
  additionsHint?: string | undefined;
  deletionsDisplayValue: string;
  deletionsTone: "neutral" | "positive" | "warning" | "danger" | "info";
  deletionsHint?: string | undefined;
  remoteUrlDisplayValue: string;
  remoteUrlTone: "neutral" | "positive" | "warning" | "danger" | "info";
  remoteUrlHint?: string | undefined;
  pullRequestDisplayValue: string;
  pullRequestTone: "neutral" | "positive" | "warning" | "danger" | "info";
  pullRequestHint?: string | undefined;
  checksDisplayValue: string;
  checksTone: "neutral" | "positive" | "warning" | "danger" | "info";
  checksHint?: string | undefined;
  reviewLabel: string;
  reviewDisplayValue: string;
  reviewTone: "neutral" | "positive" | "warning" | "danger" | "info";
  reviewHint?: string | undefined;
}) {
  const githubUiEnabled = isGithubUiEnabled();
  const remoteUrlIsGitHubHosted = isGitHubHostedRemoteUrl(
    args.remoteUrlDisplayValue,
  );

  return {
    id: "git-github",
    title: githubUiEnabled ? "Git / GitHub" : "Git",
    summary: githubUiEnabled
      ? "Show shared read-only repository truth and keep GitHub gaps explicit."
      : "Show shared read-only repository truth without GitHub-only UI details.",
    items: [
      {
        label: "Git Snapshot",
        value: args.gitStatus.label,
        tone: args.gitStatus.tone,
        ...(args.gitStatus.reason ? { hint: args.gitStatus.reason } : {}),
      },
      ...(githubUiEnabled
        ? [
            {
              label: "GitHub Snapshot",
              value: args.githubStatus.label,
              tone: args.githubStatus.tone,
              ...(args.githubStatus.reason
                ? { hint: args.githubStatus.reason }
                : {}),
            },
          ]
        : []),
      {
        label: args.projectLabelName,
        value: args.projectLabel,
        tone: "neutral" as const,
      },
      {
        label: args.validatedRootLabel,
        value: args.validatedRootValue,
        tone: args.validatedRootTone,
        ...(args.validatedRootHint ? { hint: args.validatedRootHint } : {}),
      },
      {
        label: "Branch",
        value: args.branchDisplayValue,
        tone: args.branchTone,
        ...(args.branchHint ? { hint: args.branchHint } : {}),
      },
      {
        label: args.headLabel,
        value: args.headDisplayValue,
        tone: args.headTone,
        ...(args.headHint ? { hint: args.headHint } : {}),
      },
      {
        label: args.dirtyLabel,
        value: args.dirtyState.label,
        tone: args.dirtyState.tone,
        ...(args.dirtyState.reason ? { hint: args.dirtyState.reason } : {}),
      },
      {
        label: "Changed Files",
        value: args.changedFilesDisplayValue,
        tone: args.changedFilesTone,
        ...(args.changedFilesHint ? { hint: args.changedFilesHint } : {}),
      },
      {
        label: "Untracked Files",
        value: args.untrackedFilesDisplayValue,
        tone: args.untrackedFilesTone,
        ...(args.untrackedFilesHint ? { hint: args.untrackedFilesHint } : {}),
      },
      {
        label: "Additions",
        value: args.additionsDisplayValue,
        tone: args.additionsTone,
        ...(args.additionsHint ? { hint: args.additionsHint } : {}),
      },
      {
        label: "Deletions",
        value: args.deletionsDisplayValue,
        tone: args.deletionsTone,
        ...(args.deletionsHint ? { hint: args.deletionsHint } : {}),
      },
      ...(githubUiEnabled || !remoteUrlIsGitHubHosted
        ? [
            {
              label: "Remote URL",
              value: args.remoteUrlDisplayValue,
              tone: args.remoteUrlTone,
              ...(args.remoteUrlHint ? { hint: args.remoteUrlHint } : {}),
            },
          ]
        : []),
      ...(githubUiEnabled
        ? [
            {
              label: "Pull Request",
              value: args.pullRequestDisplayValue,
              tone: args.pullRequestTone,
              ...(args.pullRequestHint ? { hint: args.pullRequestHint } : {}),
            },
            {
              label: "Checks",
              value: args.checksDisplayValue,
              tone: args.checksTone,
              ...(args.checksHint ? { hint: args.checksHint } : {}),
            },
            {
              label: args.reviewLabel,
              value: args.reviewDisplayValue,
              tone: args.reviewTone,
              ...(args.reviewHint ? { hint: args.reviewHint } : {}),
            },
          ]
        : []),
    ],
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
