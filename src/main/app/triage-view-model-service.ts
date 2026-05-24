import type { HarnessDescriptor } from "../core/adapter-contract/index.js";
import type {
  DerivedProjectCacheRecord,
  NormalizedCacheRecord
} from "../core/cache/file-backed-cache-store.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { mergeNormalizedResults } from "../core/ingestion/index.js";
import type {
  CapabilityState,
  HarnessCapabilities
} from "../core/model/capabilities.js";
import type {
  FileMutationEvidence,
  OutputArtifact,
  Project,
  Session,
  SessionEvent,
  SessionMessage,
  ShellCommandEvidence,
  ToolCall
} from "../core/model/entities.js";
import {
  getOverviewRequestSchema,
  listProjectsRequestSchema,
  overviewViewModelSchema,
  projectSummaryViewModelSchema,
  sessionPreviewViewModelSchema,
  sessionSummaryViewModelSchema,
  type CapabilityBadgeLabel,
  type CapabilityBadgeViewModel,
  type FieldValueViewModel,
  type GetOverviewRequest,
  type ListProjectsRequest,
  type MetricStateViewModel,
  type OverviewViewModel,
  type ProjectSummaryViewModel,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel,
  type TruthStateViewModel
} from "../ipc/view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

const capabilityKeys = [
  "sessionDiscovery",
  "liveSessionObservation",
  "eventStreaming",
  "messageCapture",
  "toolCallCapture",
  "shellCommandCapture",
  "outputArtifactCapture",
  "fileMutationCapture",
  "sourceValidation",
  "watchPlans",
  "gitContextCapture",
  "githubContextCapture",
  "verificationSignals"
] as const satisfies readonly (keyof HarnessCapabilities)[];

type DerivedSession = NonNullable<NormalizedCacheRecord["derived"]>["sessions"][number];
type DerivedProject = NonNullable<
  NonNullable<NormalizedCacheRecord["derived"]>["projects"]
>[number];

interface LoadedTriageData {
  descriptors: Map<string, HarnessDescriptor>;
  records: NormalizedCacheRecord[];
  projectsById: Map<string, Project>;
  sessionsById: Map<string, Session>;
  eventsBySessionId: Map<string, SessionEvent[]>;
  messagesBySessionId: Map<string, SessionMessage[]>;
  toolCallsBySessionId: Map<string, ToolCall[]>;
  shellCommandsBySessionId: Map<string, ShellCommandEvidence[]>;
  outputArtifactsBySessionId: Map<string, OutputArtifact[]>;
  fileMutationsBySessionId: Map<string, FileMutationEvidence[]>;
  diagnosticsBySessionId: Map<string, Diagnostic[]>;
  derivedBySessionId: Map<string, DerivedSession>;
  projectSnapshotsByProjectId: Map<string, DerivedProject>;
}

export interface TriageViewModelService {
  getOverview(request?: GetOverviewRequest): Promise<OverviewViewModel>;
  listProjects(request?: ListProjectsRequest): Promise<ProjectSummaryViewModel[]>;
}

export interface TriageViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createTriageViewModelService(
  options: TriageViewModelServiceOptions = {}
): TriageViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    async getOverview(request) {
      const parsed = getOverviewRequestSchema.parse(request ?? {});
      const data = await loadTriageData(runtime);
      const sessions = filterSessions(data, parsed.adapterId);
      const latestTimestamp = getLatestTimestamp(sessions);

      return overviewViewModelSchema.parse({
        metrics: {
          totalProjects: toMetricValue(
            new Set(sessions.map((session) => session.projectId).filter(Boolean)).size
          ),
          totalSessions: toMetricValue(sessions.length),
          activeOrRecentSessions: toMetricValue(
            sessions.filter((session) => isSessionActiveOrRecent(session, latestTimestamp)).length
          ),
          failedVerification: toMetricValue(
            sessions.filter((session) => getVerificationState(data, session).label === "Failed")
              .length
          ),
          cancelledSessions: toMetricValue(
            sessions.filter((session) => session.lifecycleState === "cancelled").length
          ),
          needsAttentionSessions: toMetricValue(
            sessions.filter((session) => needsAttention(getRunAuditState(data, session))).length
          ),
          toolActivity: toMetricValue(
            sessions.reduce(
              (total, session) =>
                total + (data.toolCallsBySessionId.get(session.id)?.length ?? 0),
              0
            )
          )
        },
        harnessFilters: buildHarnessFilters(data, sessions),
        activity: buildActivitySeries(data, sessions)
      });
    },

    async listProjects(request) {
      const parsed = listProjectsRequestSchema.parse(request ?? {});
      const data = await loadTriageData(runtime);
      const sessions = filterSessions(data, parsed.adapterId);
      const groupedSessions = new Map<string, Session[]>();

      for (const session of sessions) {
        const key = session.projectId ?? `source:${session.sourceId}`;
        const current = groupedSessions.get(key) ?? [];

        current.push(session);
        groupedSessions.set(key, current);
      }

      return [...groupedSessions.entries()]
        .map(([key, projectSessions]) => {
          const project = projectSessions[0]?.projectId
            ? data.projectsById.get(projectSessions[0].projectId)
            : undefined;
          const latestSession = [...projectSessions].sort(compareSessionsByActivity)[0];
          const observedHarnesses = unique(
            projectSessions.map(
              (session) => data.descriptors.get(session.adapterId)?.displayName ?? session.adapterId
            )
          );

          if (!latestSession) {
            return null;
          }

          const projectSnapshot = getProjectGitSnapshot(data, project);
          const githubSnapshot = getProjectGitHubSnapshot(data, project);

          return projectSummaryViewModelSchema.parse({
            projectId: project?.id ?? key,
            projectName: project?.name ?? "Unknown Project",
            repoPath: toFieldValue(project?.rootPath),
            validatedRepoRoot: toGitValidatedRootField(projectSnapshot),
            observedHarnesses,
            latestActivityAt: getSessionActivityTimestamp(latestSession),
            sessionCount: projectSessions.length,
            latestVerification: getVerificationState(data, latestSession),
            latestRunAudit: getRunAuditState(data, latestSession),
            gitStatus: toGitStatusState(projectSnapshot),
            githubStatus: toGitHubStatusState(githubSnapshot),
            branch: toGitFieldValue(projectSnapshot, (snapshot) => snapshot.branch),
            head: toGitFieldValue(projectSnapshot, (snapshot) => snapshot.headSha, {
              displayValue: abbreviateSha
            }),
            dirtyState: toGitDirtyState(projectSnapshot),
            changedFiles: toGitMetricState(projectSnapshot, (snapshot) => snapshot.changedFiles),
            untrackedFiles: toGitMetricState(projectSnapshot, (snapshot) => snapshot.untrackedFiles),
            additions: toGitMetricState(projectSnapshot, (snapshot) => snapshot.additions),
            deletions: toGitMetricState(projectSnapshot, (snapshot) => snapshot.deletions),
            remoteUrl: toGitRemoteField(projectSnapshot),
            pullRequest: toGitHubPullRequestField(githubSnapshot),
            checks: toGitHubSummaryField(githubSnapshot, (snapshot) => snapshot.checksSummary),
            reviewStatus: toGitHubSummaryField(githubSnapshot, (snapshot) => snapshot.reviewSummary)
          });
        })
        .filter((project): project is ProjectSummaryViewModel => project !== null)
        .sort((left, right) =>
          compareTimestampStrings(right.latestActivityAt, left.latestActivityAt)
        );
    }
  };
}

export async function loadTriageData(
  runtime: WorkbenchRuntime
): Promise<LoadedTriageData> {
  const records = await runtime.cacheStore.listLatestRecords();
  const merged = mergeNormalizedResults(records.map((record) => record.normalized));
  const projects = merged?.projects ?? [];
  const sessions = merged?.sessions ?? [];
  const events = merged?.events ?? [];
  const messages = merged?.messages ?? [];
  const toolCalls = merged?.toolCalls ?? [];
  const shellCommands = merged?.shellCommands ?? [];
  const outputArtifacts = merged?.outputArtifacts ?? [];
  const fileMutations = merged?.fileMutations ?? [];

  return {
    descriptors: new Map(
      runtime
        .adapterRegistry
        .listDescriptors()
        .map((descriptor) => [descriptor.id, descriptor] as const)
    ),
    records,
    projectsById: new Map(projects.map((project) => [project.id, project] as const)),
    sessionsById: new Map(sessions.map((session) => [session.id, session] as const)),
    eventsBySessionId: groupBy(events, (event) => event.sessionId),
    messagesBySessionId: groupBy(messages, (message) => message.sessionId),
    toolCallsBySessionId: groupBy(toolCalls, (toolCall) => toolCall.sessionId),
    shellCommandsBySessionId: groupBy(shellCommands, (shellCommand) => shellCommand.sessionId),
    outputArtifactsBySessionId: groupBy(outputArtifacts, (artifact) => artifact.sessionId),
    fileMutationsBySessionId: groupBy(fileMutations, (mutation) => mutation.sessionId),
    diagnosticsBySessionId: buildDiagnosticsBySession(records, sessions),
    derivedBySessionId: buildDerivedBySession(records),
    projectSnapshotsByProjectId: buildDerivedByProject(records)
  };
}

export function filterSessions(
  data: LoadedTriageData,
  adapterId?: string
): Session[] {
  return [...data.sessionsById.values()]
    .filter((session) => !adapterId || session.adapterId === adapterId)
    .sort(compareSessionsByActivity);
}

export function buildSessionSummaryViewModel(
  data: LoadedTriageData,
  session: Session
): SessionSummaryViewModel {
  return sessionSummaryViewModelSchema.parse(buildSessionBaseViewModel(data, session));
}

export function buildSessionPreviewViewModel(
  data: LoadedTriageData,
  session: Session
): SessionPreviewViewModel {
  return sessionPreviewViewModelSchema.parse({
    ...buildSessionBaseViewModel(data, session),
    diagnostics: getDiagnosticsForSession(data, session).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: sanitizeText(diagnostic.message)
    }))
  });
}

export function getDerivedSession(
  data: LoadedTriageData,
  sessionId: string
): DerivedSession | undefined {
  return data.derivedBySessionId.get(sessionId);
}

export function getProjectForSession(
  data: LoadedTriageData,
  session: Session
): Project | undefined {
  return session.projectId ? data.projectsById.get(session.projectId) : undefined;
}

export function getProjectGitSnapshot(
  data: LoadedTriageData,
  project?: Project
): DerivedProject["git"] | undefined {
  return project ? data.projectSnapshotsByProjectId.get(project.id)?.git : undefined;
}

export function getProjectGitHubSnapshot(
  data: LoadedTriageData,
  project?: Project
): DerivedProject["github"] | undefined {
  return project ? data.projectSnapshotsByProjectId.get(project.id)?.github : undefined;
}

export function getDiagnosticsForSession(
  data: LoadedTriageData,
  session: Session
): Diagnostic[] {
  return data.diagnosticsBySessionId.get(session.id) ?? [];
}

export function getCapabilityEnvelope(
  data: LoadedTriageData,
  session: Session
) {
  for (const record of data.records) {
    const sessionCapability = record.normalized.capabilities.sessions.find(
      (candidate) => candidate.sessionId === session.id
    );

    if (sessionCapability) {
      return sessionCapability;
    }
  }

  const sourceRecord = data.records.find((record) => record.sourceId === session.sourceId);

  if (sourceRecord) {
    return sourceRecord.normalized.capabilities.source;
  }

  return data.records.find((record) => record.adapterId === session.adapterId)?.normalized
    .capabilities.adapter;
}

export function getVerificationState(
  data: LoadedTriageData,
  session: Session
): TruthStateViewModel {
  const derived = getDerivedSession(data, session.id);
  const capability =
    getCapabilityEnvelope(data, session)?.capabilities.verificationSignals.status ?? "unknown";

  if (derived?.verification) {
    switch (derived.verification.status) {
      case "passed":
        return { label: "Passed", tone: "positive" };
      case "failed":
        return { label: "Failed", tone: "danger" };
      case "not-run":
        return {
          label: "Not Run",
          tone: "warning",
          reason: toReasonText(derived.verification.reasonCodes)
        };
      case "unknown":
        return {
          label: "Unknown",
          tone: "neutral",
          reason: toReasonText(derived.verification.reasonCodes)
        };
      case "unsupported":
        return {
          label: "Unsupported",
          tone: "neutral",
          reason: toReasonText(derived.verification.reasonCodes)
        };
    }
  }

  if (capability === "unsupported") {
    return {
      label: "Unsupported",
      tone: "neutral",
      reason: getCapabilityEnvelope(data, session)?.capabilities.verificationSignals.reason
    };
  }

  return {
    label: "Unknown",
    tone: "neutral",
    reason: getCapabilityEnvelope(data, session)?.capabilities.verificationSignals.reason
  };
}

export function getRunAuditState(
  data: LoadedTriageData,
  session: Session
): TruthStateViewModel {
  const derived = getDerivedSession(data, session.id);

  if (!derived?.audit) {
    return { label: "Unknown", tone: "neutral" };
  }

  switch (derived.audit.status) {
    case "active":
      return { label: "Active", tone: "info" };
    case "cancelled":
      return {
        label: "Cancelled",
        tone: "warning",
        reason: toReasonText(derived.audit.attentionReasons)
      };
    case "verification-failed":
      return {
        label: "Failed Verification",
        tone: "danger",
        reason: toReasonText(derived.audit.attentionReasons)
      };
    case "incomplete":
      return {
        label: "Incomplete",
        tone: "warning",
        reason: toReasonText(derived.audit.attentionReasons)
      };
    case "needs-review":
      return {
        label: "Needs Review",
        tone: "warning",
        reason: toReasonText(derived.audit.attentionReasons)
      };
    case "clean":
      return { label: "Clean", tone: "positive" };
    case "unknown":
      return {
        label: "Unknown",
        tone: "neutral",
        reason: toReasonText(derived.audit.attentionReasons)
      };
  }
}

export function getLifecycleState(session: Session): TruthStateViewModel {
  switch (session.lifecycleState) {
    case "active":
      return { label: "Active", tone: "info" };
    case "completed":
      return { label: "Completed", tone: "positive" };
    case "cancelled":
      return { label: "Cancelled", tone: "warning" };
    case "unknown":
      return { label: "Unknown", tone: "neutral" };
  }
}

export function toCapabilityBadge(
  key: keyof HarnessCapabilities,
  state: CapabilityState
): CapabilityBadgeViewModel {
  return {
    key,
    label: humanizeCapabilityKey(key),
    state: toCapabilityLabel(state.status),
    ...(state.reason ? { reason: state.reason } : {})
  };
}

export function toMetricValue(value: number): MetricStateViewModel {
  return {
    status: "value",
    displayValue: String(value),
    numericValue: value
  };
}

export function toGitDirtyState(
  gitSnapshot?: DerivedProject["git"]
): TruthStateViewModel {
  if (gitSnapshot?.status === "available" && gitSnapshot.snapshot) {
    return gitSnapshot.snapshot.dirty
      ? { label: "Dirty", tone: "warning" }
      : { label: "Clean", tone: "positive" };
  }

  if (gitSnapshot?.status === "unsupported") {
    return {
      label: "Unsupported",
      tone: "neutral",
      reason: gitSnapshot.reason
    };
  }

  return {
    label: "Unknown",
    tone: "neutral",
    reason: getGitUnavailableReason(gitSnapshot)
  };
}

export function toGitFieldValue(
  gitSnapshot: DerivedProject["git"] | undefined,
  selectValue: (snapshot: NonNullable<DerivedProject["git"]["snapshot"]>) => string | undefined,
  options: {
    displayValue?: (rawValue: string) => string;
    unavailableReason?: string;
  } = {}
): FieldValueViewModel {
  if (gitSnapshot?.status === "available" && gitSnapshot.snapshot) {
    const rawValue = selectValue(gitSnapshot.snapshot);

    if (rawValue) {
      return toFieldValueWithDisplay(
        rawValue,
        options.displayValue ? options.displayValue(rawValue) : rawValue
      );
    }
  }

  return toFieldState(
    gitSnapshot?.status === "unsupported" ? "Unsupported" : "Unknown",
    options.unavailableReason ?? getGitUnavailableReason(gitSnapshot)
  );
}

export function toGitMetricState(
  gitSnapshot: DerivedProject["git"] | undefined,
  selectValue: (snapshot: NonNullable<DerivedProject["git"]["snapshot"]>) => number
): MetricStateViewModel {
  if (gitSnapshot?.status === "available" && gitSnapshot.snapshot) {
    return toMetricValue(selectValue(gitSnapshot.snapshot));
  }

  if (gitSnapshot?.status === "unsupported") {
    return toMetricState("unsupported", "Unsupported", gitSnapshot.reason);
  }

  return toMetricState("unknown", "Unknown", getGitUnavailableReason(gitSnapshot));
}

export function toGitRemoteField(
  gitSnapshot?: DerivedProject["git"]
): FieldValueViewModel {
  if (gitSnapshot?.status === "available" && gitSnapshot.snapshot?.remoteUrl) {
    return toFieldValue(gitSnapshot.snapshot.remoteUrl);
  }

  if (gitSnapshot?.status === "available") {
    return toFieldState(
      "Unknown",
      gitSnapshot.remoteReason ?? "No remote URL is configured for this repository."
    );
  }

  return toFieldState(
    gitSnapshot?.status === "unsupported" ? "Unsupported" : "Unknown",
    getGitUnavailableReason(gitSnapshot)
  );
}

export function toGitStatusState(
  gitSnapshot?: DerivedProject["git"]
): TruthStateViewModel {
  if (gitSnapshot?.status === "available") {
    return { label: "Available", tone: "info" };
  }

  if (gitSnapshot?.status === "unsupported") {
    return {
      label: "Unsupported",
      tone: "neutral",
      reason: gitSnapshot.reason
    };
  }

  return {
    label: "Unknown",
    tone: "neutral",
    reason: getGitUnavailableReason(gitSnapshot)
  };
}

export function toGitHubPullRequestField(
  githubSnapshot?: DerivedProject["github"]
): FieldValueViewModel {
  if (
    githubSnapshot?.status === "available" &&
    githubSnapshot.pullRequestNumber &&
    githubSnapshot.pullRequestTitle
  ) {
    return toFieldValueWithDisplay(
      String(githubSnapshot.pullRequestNumber),
      `#${githubSnapshot.pullRequestNumber} ${githubSnapshot.pullRequestTitle}`
    );
  }

  if (githubSnapshot?.status === "no-matching-pr") {
    return toFieldValueWithDisplay("no-matching-pr", "No Matching PR");
  }

  return toFieldState(
    githubSnapshot?.status === "unsupported" ? "Unsupported" : "Unknown",
    getGitHubUnavailableReason(githubSnapshot)
  );
}

export function toGitHubStatusState(
  githubSnapshot?: DerivedProject["github"]
): TruthStateViewModel {
  switch (githubSnapshot?.status) {
    case "available":
      return { label: "Available", tone: "info" };
    case "no-matching-pr":
      return {
        label: "No Matching PR",
        tone: "neutral",
        reason: githubSnapshot.reason
      };
    case "unsupported":
      return {
        label: "Unsupported",
        tone: "neutral",
        reason: githubSnapshot.reason
      };
    default:
      return {
        label: "Unknown",
        tone: "neutral",
        reason: getGitHubUnavailableReason(githubSnapshot)
      };
  }
}

export function toGitHubSummaryField(
  githubSnapshot: DerivedProject["github"] | undefined,
  selectValue: (snapshot: NonNullable<DerivedProject["github"]>) => string | undefined
): FieldValueViewModel {
  if (githubSnapshot?.status === "available") {
    const value = selectValue(githubSnapshot);

    if (value) {
      return toFieldValue(value);
    }
  }

  if (githubSnapshot?.status === "no-matching-pr") {
    return toFieldValueWithDisplay("no-matching-pr", "No Matching PR");
  }

  return toFieldState(
    githubSnapshot?.status === "unsupported" ? "Unsupported" : "Unknown",
    getGitHubUnavailableReason(githubSnapshot)
  );
}

export function toGitValidatedRootField(
  gitSnapshot?: DerivedProject["git"]
): FieldValueViewModel {
  if (gitSnapshot?.validatedRootPath) {
    return toFieldValue(gitSnapshot.validatedRootPath);
  }

  return toFieldState(
    gitSnapshot?.status === "unsupported" ? "Unsupported" : "Unknown",
    getGitUnavailableReason(gitSnapshot)
  );
}

export function toMetricState(
  status: MetricStateViewModel["status"],
  displayValue: string,
  reason?: string
): MetricStateViewModel {
  return {
    status,
    displayValue,
    ...(reason ? { reason } : {})
  };
}

export function toFieldValue(value?: string, reason?: string): FieldValueViewModel {
  if (value) {
    return toFieldValueWithDisplay(value, value);
  }

  return toFieldState("Unknown", reason);
}

export function toFieldValueWithDisplay(
  rawValue: string,
  displayValue: string
): FieldValueViewModel {
  return {
    status: "value",
    displayValue,
    rawValue
  };
}

export function toFieldState(
  displayValue: "Unknown" | "Unsupported",
  reason?: string
): FieldValueViewModel {
  return {
    status: displayValue === "Unknown" ? "unknown" : "unsupported",
    displayValue,
    ...(reason ? { reason } : {})
  };
}

export function sanitizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function needsAttention(state: TruthStateViewModel): boolean {
  return !["Clean", "Passed", "Completed", "Supported"].includes(state.label);
}

function buildSessionBaseViewModel(
  data: LoadedTriageData,
  session: Session
) {
  const descriptor = data.descriptors.get(session.adapterId);
  const capabilityEnvelope = getCapabilityEnvelope(data, session);
  const diagnostics = getDiagnosticsForSession(data, session);
  const shellCapability = capabilityEnvelope?.capabilities.shellCommandCapture;
  const derived = getDerivedSession(data, session.id);
  const firstPrompt = getFirstPrompt(data, session.id);

  return {
    adapterId: session.adapterId,
    adapterDisplayName: descriptor?.displayName ?? session.adapterId,
    sourceId: session.sourceId,
    sessionId: session.id,
    nativeSessionId: session.nativeId,
    title: session.title ?? session.nativeId,
    lifecycleStatus: session.lifecycleState,
    lifecycleState: getLifecycleState(session),
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    ...(getProjectForSession(data, session)?.name
      ? { projectName: getProjectForSession(data, session)?.name }
      : {}),
    ...(firstPrompt ? { firstPrompt } : {}),
    capabilityBadges: capabilityKeys.map((key) =>
      toCapabilityBadge(key, capabilityEnvelope?.capabilities[key] ?? { status: "unknown" })
    ),
    diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
      .length,
    verificationState: getVerificationState(data, session),
    runAuditState: getRunAuditState(data, session),
    attentionReasons: derived?.audit?.attentionReasons.map(humanizeAttentionReason) ?? [],
    evidenceSummary: {
      messages: data.messagesBySessionId.get(session.id)?.length ?? 0,
      toolCalls: data.toolCallsBySessionId.get(session.id)?.length ?? 0,
      shellCommands: data.shellCommandsBySessionId.get(session.id)?.length ?? 0,
      outputArtifacts: data.outputArtifactsBySessionId.get(session.id)?.length ?? 0,
      fileMutations: data.fileMutationsBySessionId.get(session.id)?.length ?? 0,
      diagnostics: diagnostics.length
    },
    triageMetrics: {
      toolCalls: toMetricValue(data.toolCallsBySessionId.get(session.id)?.length ?? 0),
      fileMutations: toMetricValue(data.fileMutationsBySessionId.get(session.id)?.length ?? 0),
      commands:
        shellCapability?.status === "supported"
          ? toMetricValue(derived?.shellCommands.length ?? 0)
          : toMetricStateFromCapability(shellCapability),
      failedCommands:
        shellCapability?.status === "supported"
          ? toMetricValue(
              derived?.shellCommands.filter((command) => command.result === "failed").length ?? 0
            )
          : toMetricStateFromCapability(shellCapability),
      tokenCount: toMetricState(
        "unsupported",
        "Unsupported",
        "Token accounting is not captured by the current shared evidence model."
      )
    }
  };
}

function buildHarnessFilters(
  data: LoadedTriageData,
  sessions: Session[]
): OverviewViewModel["harnessFilters"] {
  const counts = new Map<string, number>();

  for (const session of sessions) {
    counts.set(session.adapterId, (counts.get(session.adapterId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([adapterId, sessionCount]) => ({
      adapterId,
      label: data.descriptors.get(adapterId)?.displayName ?? adapterId,
      sessionCount
    }))
    .sort((left, right) => right.sessionCount - left.sessionCount);
}

function buildActivitySeries(
  data: LoadedTriageData,
  sessions: Session[]
): OverviewViewModel["activity"] {
  const points = new Map<
    string,
    { sessionCount: number; needsAttentionCount: number }
  >();

  for (const session of sessions) {
    const stamp = getSessionActivityTimestamp(session);

    if (!stamp) {
      continue;
    }

    const day = stamp.slice(0, 10);
    const current = points.get(day) ?? { sessionCount: 0, needsAttentionCount: 0 };

    current.sessionCount += 1;
    if (needsAttention(getRunAuditState(data, session))) {
      current.needsAttentionCount += 1;
    }

    points.set(day, current);
  }

  return [...points.entries()]
    .map(([day, point]) => ({
      day,
      sessionCount: point.sessionCount,
      needsAttentionCount: point.needsAttentionCount
    }))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function buildDiagnosticsBySession(
  records: NormalizedCacheRecord[],
  sessions: Session[]
): Map<string, Diagnostic[]> {
  const diagnosticsBySession = new Map<string, Diagnostic[]>();

  for (const session of sessions) {
    const diagnostics = records
      .filter((record) => record.sourceId === session.sourceId)
      .flatMap((record) => record.normalized.diagnostics)
      .filter(
        (diagnostic) =>
          diagnostic.sourceId === session.sourceId ||
          diagnostic.relatedEntityIds?.includes(session.id) === true
      );

    diagnosticsBySession.set(session.id, dedupeDiagnostics(diagnostics));
  }

  return diagnosticsBySession;
}

function buildDerivedBySession(
  records: NormalizedCacheRecord[]
): Map<string, DerivedSession> {
  const derived = new Map<string, DerivedSession>();

  for (const record of records) {
    for (const session of record.derived?.sessions ?? []) {
      derived.set(session.sessionId, session);
    }
  }

  return derived;
}

function buildDerivedByProject(
  records: NormalizedCacheRecord[]
): Map<string, DerivedProjectCacheRecord> {
  const derived = new Map<string, DerivedProjectCacheRecord>();

  for (const record of records) {
    for (const project of record.derived?.projects ?? []) {
      derived.set(project.projectId, project);
    }
  }

  return derived;
}

function compareSessionsByActivity(left: Session, right: Session): number {
  return compareTimestampStrings(
    getSessionActivityTimestamp(right),
    getSessionActivityTimestamp(left)
  );
}

function compareTimestampStrings(
  left?: string,
  right?: string
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return -1;
  }

  if (!right) {
    return 1;
  }

  return left.localeCompare(right);
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();

  for (const diagnostic of diagnostics) {
    seen.set(diagnostic.id, diagnostic);
  }

  return [...seen.values()];
}

function abbreviateSha(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function getFirstPrompt(data: LoadedTriageData, sessionId: string): string | undefined {
  const firstUserMessage = [...(data.messagesBySessionId.get(sessionId) ?? [])]
    .sort((left, right) => left.ordinal - right.ordinal)
    .find((message) => message.role === "user");

  return firstUserMessage ? truncate(sanitizeText(firstUserMessage.content), 140) : undefined;
}

function getLatestTimestamp(sessions: Session[]): string | undefined {
  return sessions
    .map((session) => getSessionActivityTimestamp(session))
    .filter((stamp): stamp is string => Boolean(stamp))
    .sort((left, right) => right.localeCompare(left))[0];
}

function getSessionActivityTimestamp(session: Session): string | undefined {
  return session.endedAt ?? session.startedAt;
}

function groupBy<TItem>(
  items: TItem[],
  selectKey: (item: TItem) => string
): Map<string, TItem[]> {
  const grouped = new Map<string, TItem[]>();

  for (const item of items) {
    const key = selectKey(item);
    const current = grouped.get(key) ?? [];

    current.push(item);
    grouped.set(key, current);
  }

  return grouped;
}

function humanizeAttentionReason(reason: string): string {
  return reason
    .replace(/-/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function humanizeCapabilityKey(key: keyof HarnessCapabilities): string {
  return key.replace(/([A-Z])/gu, " $1").replace(/^./u, (first) => first.toUpperCase());
}

function isSessionActiveOrRecent(session: Session, latestTimestamp?: string): boolean {
  if (session.lifecycleState === "active") {
    return true;
  }

  if (!latestTimestamp) {
    return false;
  }

  const latest = new Date(latestTimestamp).getTime();
  const current = getSessionActivityTimestamp(session);

  if (!current) {
    return false;
  }

  const currentTime = new Date(current).getTime();
  return Number.isFinite(currentTime) && latest - currentTime <= 24 * 60 * 60 * 1000;
}

function toCapabilityLabel(status: CapabilityState["status"]): CapabilityBadgeLabel {
  switch (status) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

function toMetricStateFromCapability(
  state?: CapabilityState
): MetricStateViewModel {
  if (state?.status === "unsupported") {
    return toMetricState("unsupported", "Unsupported", state.reason);
  }

  return toMetricState("unknown", "Unknown", state?.reason);
}

function toReasonText(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return values.map(humanizeAttentionReason).join(", ");
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}...`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function getGitUnavailableReason(gitSnapshot?: DerivedProject["git"]): string {
  return (
    gitSnapshot?.reason ??
    "Git context is unavailable because Agent Workbench could not validate a safe repository root for this project."
  );
}

function getGitHubUnavailableReason(githubSnapshot?: DerivedProject["github"]): string {
  return (
    githubSnapshot?.reason ??
    "GitHub context is unavailable because the shared read-only `gh` snapshot could not be collected for this project."
  );
}
