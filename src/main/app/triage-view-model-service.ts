import type { HarnessDescriptor } from "../core/adapter-contract/index.js";
import { deriveRunAuditForSession } from "../core/audit/run-audit-engine.js";
import {
  ArchiveExporter,
  type ArchiveExportAvailability,
  type ArchiveExportScope
} from "../core/archive/archive-exporter.js";
import type {
  DerivedProjectCacheRecord,
  NormalizedCacheRecord
} from "../core/cache/file-backed-cache-store.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { mergeNormalizedResults } from "../core/ingestion/index.js";
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
import { deriveVerificationForSession } from "../core/verification/verification-classifier.js";
import {
  getOverviewActivityHeatmapRequestSchema,
  getOverviewRequestSchema,
  listProjectsRequestSchema,
  overviewActivityHeatmapViewModelSchema,
  overviewViewModelSchema,
  projectSummaryViewModelSchema,
  sessionPreviewViewModelSchema,
  sessionSummaryViewModelSchema,
  type FieldValueViewModel,
  type GetOverviewActivityHeatmapRequest,
  type GetOverviewRequest,
  type ListProjectsRequest,
  type MetricStateViewModel,
  type OverviewActivityHeatmapViewModel,
  type OverviewViewModel,
  type ProjectSummaryViewModel,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel,
  type TruthStateViewModel
} from "../ipc/view-models.js";
import {
  getGroupedCapabilityState,
  toCapabilityGroups
} from "./capability-view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions,
  type WorkbenchSourceHydrationState
} from "./workbench-runtime.js";
import {
  listAllStoreSessions,
  listStoreOverviewActivityHeatmapBuckets,
  loadStoreSourceCoverage,
  listProjectRollupsBySourceId
} from "./store-session-query.js";

type DerivedSession = NonNullable<NormalizedCacheRecord["derived"]>["sessions"][number];
type DerivedProject = NonNullable<
  NonNullable<NormalizedCacheRecord["derived"]>["projects"]
>[number];

export interface LoadedTriageData {
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
  sourceHydrationStatesBySourceId: Map<string, WorkbenchSourceHydrationState>;
}

interface ProjectRollupInput {
  archiveScope: ArchiveExportScope;
  degradedArchiveReason?: string;
  includesDegradedSources: boolean;
  key: string;
  latestSession: Session;
  project?: Project;
  projectSessions: Session[];
}

export interface TriageViewModelService {
  getOverview(request?: GetOverviewRequest): Promise<OverviewViewModel>;
  getOverviewActivityHeatmap(
    request?: GetOverviewActivityHeatmapRequest
  ): Promise<OverviewActivityHeatmapViewModel>;
  listProjects(request?: ListProjectsRequest): Promise<ProjectSummaryViewModel[]>;
}

export interface TriageViewModelServiceOptions extends WorkbenchRuntimeOptions {
  now?: () => Date;
  runtime?: WorkbenchRuntime;
}

export function createTriageViewModelService(
  options: TriageViewModelServiceOptions = {}
): TriageViewModelService {
  const now = options.now ?? (() => new Date());
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const archiveExporter = new ArchiveExporter({
    cacheStore: runtime.cacheStore,
    entityStore: runtime.entityStore,
    rawArtifactIndex: runtime.rawArtifactIndex,
    sourceRegistry: runtime.sourceRegistry
  });

  return {
    async getOverview(request) {
      const parsed = getOverviewRequestSchema.parse(request ?? {});
      const data = await loadStoreTriageData(runtime, parsed.adapterId);
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
            sessions.filter((session) => getSessionLifecycleStatus(session) === "cancelled")
              .length
          ),
          needsAttentionSessions: toMetricValue(
            sessions.filter((session) => needsAttention(getRunAuditState(data, session))).length
          ),
          toolActivity: toMetricValue(
            sessions.reduce(
              (total, session) =>
                total +
                (data.toolCallsBySessionId.get(session.id)?.length ??
                  session.toolCallIds?.length ??
                  0),
              0
            )
          )
        },
        usageSummary: buildOverviewUsageSummary(data, sessions),
        harnessFilters: buildHarnessFilters(data, sessions),
        activity: buildActivitySeries(data, sessions)
      });
    },

    async getOverviewActivityHeatmap(request) {
      const parsed = getOverviewActivityHeatmapRequestSchema.parse(request ?? {});
      const window = buildLast30DayWindow(now());
      const coverage = await loadStoreSourceCoverage(runtime, parsed.adapterId);
      const buckets = await listStoreOverviewActivityHeatmapBuckets(
        runtime,
        {
          startDay: window.startDay,
          endDay: window.endDay
        },
        coverage
      );

      return overviewActivityHeatmapViewModelSchema.parse({
        buckets: buildFixedOverviewActivityBuckets(window.days, buckets),
        coverageState: buildOverviewActivityCoverageState(
          coverage.degradedSourceStatesBySourceId
        )
      });
    },

    async listProjects(request) {
      const parsed = listProjectsRequestSchema.parse(request ?? {});
      const data = await loadStoreTriageData(runtime, parsed.adapterId);
      const sessions = filterSessions(data, parsed.adapterId);
      const groupedSessions = new Map<string, Session[]>();

      for (const session of sessions) {
        const key = session.projectId ?? `source:${session.sourceId}`;
        const current = groupedSessions.get(key) ?? [];

        current.push(session);
        groupedSessions.set(key, current);
      }

      const projectRollups = [...groupedSessions.entries()]
        .map(([key, projectSessions]): ProjectRollupInput | null => {
          const project = projectSessions[0]?.projectId
            ? data.projectsById.get(projectSessions[0].projectId)
            : undefined;
          const latestSession = [...projectSessions].sort(compareSessionsByActivity)[0];

          if (!latestSession) {
            return null;
          }

          const degradedSourceStates = unique(
            projectSessions
              .map((session) => data.sourceHydrationStatesBySourceId.get(session.sourceId)?.reason)
              .filter((reason): reason is string => typeof reason === "string" && reason.length > 0)
          );

          return {
            archiveScope: project?.id
              ? {
                  kind: "project",
                  projectId: project.id
                }
              : {
                  kind: "session",
                  sessionId: latestSession.id
                },
            ...(degradedSourceStates[0]
              ? { degradedArchiveReason: degradedSourceStates[0] }
              : {}),
            includesDegradedSources: degradedSourceStates.length > 0,
            key,
            latestSession,
            ...(project ? { project } : {}),
            projectSessions
          };
        })
        .filter((rollup): rollup is ProjectRollupInput => rollup !== null);
      const archiveExportsByScope = await getArchiveExportsForRollups(
        archiveExporter,
        projectRollups.filter((rollup) => !rollup.includesDegradedSources)
      );

      const projects = projectRollups.map(
        ({
          archiveScope,
          degradedArchiveReason,
          includesDegradedSources,
          key,
          latestSession,
          project,
          projectSessions
        }) => {
          const observedHarnesses = unique(
            projectSessions.map(
              (session) => data.descriptors.get(session.adapterId)?.displayName ?? session.adapterId
            )
          );

          const projectSnapshot = getProjectGitSnapshot(data, project);
          const githubSnapshot = getProjectGitHubSnapshot(data, project);
          const archiveExport =
            includesDegradedSources
              ? buildUnavailableArchiveExport(
                  {
                    archiveScope,
                    latestSession,
                    projectSessions
                  },
                  project,
                  degradedArchiveReason
                )
              : archiveExportsByScope.get(getArchiveScopeKey(archiveScope)) ??
                buildUnavailableArchiveExport(
                  {
                    archiveScope,
                    latestSession,
                    projectSessions
                  },
                  project
                );

          const projectDisplayName = getProjectDisplayName(project) ?? "Unknown Project";

          return projectSummaryViewModelSchema.parse({
            projectId: project?.id ?? key,
            projectDisplayName,
            projectName: projectDisplayName,
            primaryRootPath: toFieldValue(getProjectPrimaryRootPath(project)),
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
            reviewStatus: toGitHubSummaryField(githubSnapshot, (snapshot) => snapshot.reviewSummary),
            archiveExport
          });
        }
      );

      return projects
        .sort((left, right) => compareTimestampStrings(right.latestActivityAt, left.latestActivityAt));
    }
  };
}

async function getArchiveExportsForRollups(
  archiveExporter: ArchiveExporter,
  rollups: ProjectRollupInput[]
): Promise<Map<string, ArchiveExportAvailability>> {
  const archiveExportsByScope = new Map<string, ArchiveExportAvailability>();

  if (rollups.length === 0) {
    return archiveExportsByScope;
  }

  try {
    const projectSourceCoverageByProjectId = new Map(
      rollups
        .filter(
          (
            rollup
          ): rollup is ProjectRollupInput & {
            archiveScope: Extract<ArchiveExportScope, { kind: "project" }>;
          } => rollup.archiveScope.kind === "project"
        )
        .map((rollup) => [
          rollup.archiveScope.projectId,
          unique(rollup.projectSessions.map((session) => session.sourceId)).sort((left, right) =>
            left.localeCompare(right)
          )
        ] as const)
    );
    const archiveExports = await archiveExporter.getScopeAvailabilities(
      rollups.map((rollup) => rollup.archiveScope),
      { projectSourceCoverageByProjectId }
    );

    for (const archiveExport of archiveExports) {
      const scopeKey =
        archiveExport.scopeKind === "project"
          ? `project:${archiveExport.scopeId}`
          : `session:${archiveExport.scopeId}`;

      archiveExportsByScope.set(scopeKey, archiveExport);
    }
  } catch {
    for (const rollup of rollups) {
      archiveExportsByScope.set(
        getArchiveScopeKey(rollup.archiveScope),
        buildUnavailableArchiveExport(rollup, rollup.project)
      );
    }
  }

  return archiveExportsByScope;
}

export function buildUnavailableArchiveExport(
  rollup: Pick<
    ProjectRollupInput,
    "archiveScope" | "latestSession" | "projectSessions"
  >,
  project?: Project,
  reason = "Archive export availability could not be resolved for this scope."
): ArchiveExportAvailability {
  return {
    scopeKind: rollup.archiveScope.kind,
    scopeId:
      rollup.archiveScope.kind === "project"
        ? rollup.archiveScope.projectId
        : rollup.archiveScope.sessionId,
    scopeLabel:
      rollup.archiveScope.kind === "project"
        ? getProjectDisplayName(project) ?? "Project Archive"
        : rollup.latestSession.title ?? rollup.latestSession.nativeId ?? "Session Archive",
    sessionCount: rollup.projectSessions.length,
    sourceCount: 0,
    rawArtifactsAvailable: false,
    rawArtifactCount: 0,
    rawArtifactsReason: reason
  };
}

function getArchiveScopeKey(scope: ArchiveExportScope): string {
  return scope.kind === "project"
    ? `${scope.kind}:${scope.projectId}`
    : `${scope.kind}:${scope.sessionId}`;
}

export async function loadTriageData(
  runtime: WorkbenchRuntime
): Promise<LoadedTriageData> {
  const records = await runtime.cacheStore.listLatestRecords();
  return buildLoadedTriageDataFromCacheRecords(runtime, records);
}

function buildLoadedTriageDataFromCacheRecords(
  runtime: WorkbenchRuntime,
  records: NormalizedCacheRecord[]
): LoadedTriageData {
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
    outputArtifactsBySessionId: groupBy(
      outputArtifacts.filter((artifact) => Boolean(artifact.sessionId)),
      (artifact) => artifact.sessionId ?? ""
    ),
    fileMutationsBySessionId: groupBy(fileMutations, (mutation) => mutation.sessionId),
    diagnosticsBySessionId: buildDiagnosticsBySession(records, sessions),
    derivedBySessionId: buildDerivedBySession(records),
    projectSnapshotsByProjectId: buildDerivedByProject(records),
    sourceHydrationStatesBySourceId: new Map()
  };
}

export async function loadStoreTriageData(
  runtime: WorkbenchRuntime,
  adapterId?: string,
  options: {
    includeSessionDiagnostics?: boolean;
  } = {}
): Promise<LoadedTriageData> {
  const coveragePromise = loadStoreSourceCoverage(runtime, adapterId);
  const [descriptors, coverage] = await Promise.all([
    Promise.resolve(runtime.adapterRegistry.listDescriptors()),
    coveragePromise
  ]);
  const sessionRows = await listAllStoreSessions(runtime, adapterId, coverage);
  const fallbackData = buildLoadedTriageDataFromCacheRecords(
    runtime,
    coverage.cacheFallbackRecords
  );
  const sessions = sessionRows.map((row) => row.session);
  const projectRollups = (
    await Promise.all(
      coverage.storeSources.map((source) =>
        listProjectRollupsBySourceId(runtime, source.sourceId)
      )
    )
  ).flatMap((rollupsByProjectId) => [...rollupsByProjectId.values()]);
  const diagnosticsBySessionId = new Map(fallbackData.diagnosticsBySessionId);

  if (options.includeSessionDiagnostics) {
    const diagnosticsBySession = await Promise.all(
      sessions.map(async (session) => [
        session.id,
        await runtime.entityStore.listDiagnostics({
          sourceId: session.sourceId,
          sessionId: session.id
        })
      ] as const)
    );

    for (const [sessionId, diagnostics] of diagnosticsBySession) {
      diagnosticsBySessionId.set(sessionId, diagnostics);
    }
  }

  const storeData: LoadedTriageData = {
    descriptors: new Map(
      descriptors.map((descriptor) => [descriptor.id, descriptor] as const)
    ),
    records: [],
    projectsById: new Map(
      projectRollups
        .filter((rollup): rollup is typeof rollup & { project: Project } => Boolean(rollup.project))
        .map((rollup) => [rollup.project.id, rollup.project] as const)
    ),
    sessionsById: new Map(sessions.map((session) => [session.id, session] as const)),
    eventsBySessionId: new Map(),
    messagesBySessionId: new Map(),
    toolCallsBySessionId: new Map(),
    shellCommandsBySessionId: new Map(),
    outputArtifactsBySessionId: new Map(),
    fileMutationsBySessionId: new Map(),
    diagnosticsBySessionId,
    derivedBySessionId: new Map(),
    projectSnapshotsByProjectId: new Map(
      projectRollups
        .filter((rollup): rollup is typeof rollup & { projectId: string } => Boolean(rollup.projectId))
        .map((rollup) => [
          rollup.projectId,
          {
            projectId: rollup.projectId,
            git: rollup.git ?? {
              status: "unknown",
              rootConfidence: "unknown",
              diagnosticIds: []
            },
            ...(rollup.github ? { github: rollup.github } : {})
          }
        ] as const)
    ),
    sourceHydrationStatesBySourceId: coverage.degradedSourceStatesBySourceId
  };

  return mergeLoadedTriageData(storeData, fallbackData);
}

function mergeLoadedTriageData(
  primary: LoadedTriageData,
  fallback: LoadedTriageData
): LoadedTriageData {
  return {
    descriptors: mergeMaps(primary.descriptors, fallback.descriptors),
    records: [...primary.records, ...fallback.records],
    projectsById: mergeMaps(primary.projectsById, fallback.projectsById),
    sessionsById: mergeMaps(primary.sessionsById, fallback.sessionsById),
    eventsBySessionId: mergeGroupedMaps(primary.eventsBySessionId, fallback.eventsBySessionId),
    messagesBySessionId: mergeGroupedMaps(primary.messagesBySessionId, fallback.messagesBySessionId),
    toolCallsBySessionId: mergeGroupedMaps(primary.toolCallsBySessionId, fallback.toolCallsBySessionId),
    shellCommandsBySessionId: mergeGroupedMaps(
      primary.shellCommandsBySessionId,
      fallback.shellCommandsBySessionId
    ),
    outputArtifactsBySessionId: mergeGroupedMaps(
      primary.outputArtifactsBySessionId,
      fallback.outputArtifactsBySessionId
    ),
    fileMutationsBySessionId: mergeGroupedMaps(
      primary.fileMutationsBySessionId,
      fallback.fileMutationsBySessionId
    ),
    diagnosticsBySessionId: mergeGroupedMaps(
      primary.diagnosticsBySessionId,
      fallback.diagnosticsBySessionId
    ),
    derivedBySessionId: mergeMaps(primary.derivedBySessionId, fallback.derivedBySessionId),
    projectSnapshotsByProjectId: mergeMaps(
      primary.projectSnapshotsByProjectId,
      fallback.projectSnapshotsByProjectId
    ),
    sourceHydrationStatesBySourceId: mergeMaps(
      primary.sourceHydrationStatesBySourceId,
      fallback.sourceHydrationStatesBySourceId
    )
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
  if (hasSessionCapabilities(session)) {
    return {
      adapterId: session.adapterId,
      sourceId: session.sourceId,
      sessionId: session.id,
      capabilities: session.capabilities
    };
  }

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
  const sessionVerification = getSessionVerification(session);
  const verification = sessionVerification ?? derived?.verification;
  const capability = getGroupedCapabilityState(
    getCapabilityEnvelope(data, session)?.capabilities,
    "audit",
    "verificationCommandEvidence"
  )?.status;

  if (verification) {
    switch (verification.status) {
      case "passed":
        return { label: "Passed", tone: "positive" };
      case "failed":
        return { label: "Failed", tone: "danger" };
      case "not-run":
        return {
          label: "Not Run",
          tone: "warning",
          reason: toReasonText(verification.reasonCodes)
        };
      case "unknown":
        return {
          label: "Unknown",
          tone: "neutral",
          reason: toReasonText(verification.reasonCodes)
        };
      case "unsupported":
        return {
          label: "Unsupported",
          tone: "neutral",
          reason: toReasonText(verification.reasonCodes)
        };
    }
  }

  if (capability === "unsupported") {
    return {
      label: "Unsupported",
      tone: "neutral",
      reason: getGroupedCapabilityState(
        getCapabilityEnvelope(data, session)?.capabilities,
        "audit",
        "verificationCommandEvidence"
      )?.reason
    };
  }

  return {
    label: "Unknown",
    tone: "neutral",
    reason: getGroupedCapabilityState(
      getCapabilityEnvelope(data, session)?.capabilities,
      "audit",
      "verificationCommandEvidence"
    )?.reason
  };
}

export function getRunAuditState(
  data: LoadedTriageData,
  session: Session
): TruthStateViewModel {
  const derived = getDerivedSession(data, session.id);
  const runAudit = getSessionRunAudit(session) ?? derived?.audit;

  if (!runAudit) {
    return { label: "Unknown", tone: "neutral" };
  }

  switch (runAudit.status) {
    case "active":
      return { label: "Active", tone: "info" };
    case "cancelled":
      return {
        label: "Cancelled",
        tone: "warning",
        reason: toReasonText(runAudit.attentionReasons)
      };
    case "verification-failed":
      return {
        label: "Failed Verification",
        tone: "danger",
        reason: toReasonText(runAudit.attentionReasons)
      };
    case "incomplete":
      return {
        label: "Incomplete",
        tone: "warning",
        reason: toReasonText(runAudit.attentionReasons)
      };
    case "needs-review":
      return {
        label: "Needs Review",
        tone: "warning",
        reason: toReasonText(runAudit.attentionReasons)
      };
    case "clean":
      return { label: "Clean", tone: "positive" };
    case "unknown":
      return {
        label: "Unknown",
        tone: "neutral",
        reason: toReasonText(runAudit.attentionReasons)
      };
  }
}

export function getLifecycleState(session: Session): TruthStateViewModel {
  switch (getSessionLifecycleStatus(session)) {
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

function mergeMaps<TKey, TValue>(
  primary: Map<TKey, TValue>,
  fallback: Map<TKey, TValue>
): Map<TKey, TValue> {
  return new Map([...fallback, ...primary]);
}

function mergeGroupedMaps<TKey, TValue>(
  primary: Map<TKey, TValue[]>,
  fallback: Map<TKey, TValue[]>
): Map<TKey, TValue[]> {
  return mergeMaps(primary, fallback);
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
  const shellCapability = getGroupedCapabilityState(
    capabilityEnvelope?.capabilities,
    "tools",
    "shellCommands"
  );
  const toolCallCapability = getGroupedCapabilityState(
    capabilityEnvelope?.capabilities,
    "tools",
    "toolCalls"
  );
  const outputArtifactCapability = getGroupedCapabilityState(
    capabilityEnvelope?.capabilities,
    "tools",
    "sidecarOutputs"
  );
  const fileMutationCapability = getGroupedCapabilityState(
    capabilityEnvelope?.capabilities,
    "tools",
    "fileMutations"
  );
  const tokenCountCapability = getGroupedCapabilityState(
    capabilityEnvelope?.capabilities,
    "usage",
    "tokenCounts"
  );
  const modelNameCapability = getGroupedCapabilityState(
    capabilityEnvelope?.capabilities,
    "usage",
    "modelNames"
  );
  const derived = getDerivedSession(data, session.id);
  const parsedShellCommands = derived?.shellCommands ?? session.parsedShellCommands ?? [];
  const firstUserPrompt =
    getSessionFirstUserPrompt(session) ?? getFirstPrompt(data, session.id);
  const projectDisplayName = getProjectDisplayName(getProjectForSession(data, session));
  const capabilityGroups = toCapabilityGroups(capabilityEnvelope?.capabilities);
  const messageCount =
    data.messagesBySessionId.get(session.id)?.length ?? session.messageIds?.length ?? 0;
  const toolCallCount =
    data.toolCallsBySessionId.get(session.id)?.length ?? session.toolCallIds?.length ?? 0;
  const shellCommandCount = parsedShellCommands.length;
  const rawShellCommandCount =
    data.shellCommandsBySessionId.get(session.id)?.length ?? session.shellCommandIds?.length ?? 0;
  const outputArtifactCount =
    data.outputArtifactsBySessionId.get(session.id)?.length ?? session.outputArtifactIds?.length ?? 0;
  const fileMutationCount =
    data.fileMutationsBySessionId.get(session.id)?.length ?? session.fileMutationIds?.length ?? 0;
  const diagnosticCount = diagnostics.length;
  const toolCallMetric = toCapabilityCountMetric(toolCallCount, toolCallCapability);
  const shellCommandMetric =
    shellCapability?.status === "supported" && rawShellCommandCount > 0 && shellCommandCount === 0
      ? toMetricState(
          "unknown",
          "Unknown",
          "Shell command evidence was captured, but parsed command truth was unavailable."
        )
      : toCapabilityCountMetric(shellCommandCount, shellCapability);
  const outputArtifactMetric = toCapabilityCountMetric(
    outputArtifactCount,
    outputArtifactCapability
  );
  const fileMutationMetric = toCapabilityCountMetric(fileMutationCount, fileMutationCapability);

  return {
    adapterId: session.adapterId,
    adapterDisplayName: descriptor?.displayName ?? session.adapterId,
    sourceId: session.sourceId,
    sessionId: session.id,
    nativeSessionId: getSessionNativeSessionId(session),
    title: session.title ?? getSessionNativeSessionId(session),
    lifecycleStatus: getSessionLifecycleStatus(session),
    lifecycleState: getLifecycleState(session),
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(getSessionEndedAt(session) ? { endedAt: getSessionEndedAt(session) } : {}),
    ...(projectDisplayName ? { projectDisplayName } : {}),
    ...(firstUserPrompt ? { firstUserPrompt } : {}),
    capabilityGroups,
    diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
      .length,
    verificationState: getVerificationState(data, session),
    runAuditState: getRunAuditState(data, session),
    attentionReasons: getAttentionReasons(session, derived),
    evidenceSummary: {
      messages: messageCount,
      toolCalls: toolCallCount,
      shellCommands: data.shellCommandsBySessionId.get(session.id)?.length ?? session.shellCommandIds?.length ?? 0,
      outputArtifacts: outputArtifactCount,
      fileMutations: fileMutationCount,
      diagnostics: diagnosticCount
    },
    evidenceMetrics: {
      messages: toMetricValue(messageCount),
      toolCalls: toolCallMetric,
      shellCommands: shellCommandMetric,
      outputArtifacts: outputArtifactMetric,
      fileMutations: fileMutationMetric,
      diagnostics: toMetricValue(diagnosticCount)
    },
    usageSummary: {
      models: toSessionModelsField(data, session, modelNameCapability),
      tokenCount: toTokenCountMetric(session, tokenCountCapability)
    },
    triageMetrics: {
      toolCalls: toolCallMetric,
      fileMutations: fileMutationMetric,
      commands: shellCommandMetric,
      failedCommands:
        shellCapability?.status === "supported" && rawShellCommandCount > 0 && shellCommandCount === 0
          ? toMetricState(
              "unknown",
              "Unknown",
              "Shell command evidence was captured, but parsed command truth was unavailable."
            )
          : shellCapability?.status === "supported"
            ? toMetricValue(
                parsedShellCommands.filter((command) => command.result === "failed").length
              )
          : toMetricStateFromCapability(shellCapability),
      tokenCount: toTokenCountMetric(session, tokenCountCapability)
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

function buildFixedOverviewActivityBuckets(
  days: string[],
  buckets: Array<{
    day: string;
    needsAttentionCount: number;
    sessionCount: number;
  }>
): OverviewActivityHeatmapViewModel["buckets"] {
  const bucketsByDay = new Map(buckets.map((bucket) => [bucket.day, bucket] as const));

  return days.map((day) => {
    const bucket = bucketsByDay.get(day);

    return {
      day,
      sessionCount: bucket?.sessionCount ?? 0,
      needsAttentionCount: bucket?.needsAttentionCount ?? 0
    };
  });
}

function buildOverviewActivityCoverageState(
  degradedSourceStatesBySourceId: Map<string, WorkbenchSourceHydrationState>
): TruthStateViewModel {
  if (degradedSourceStatesBySourceId.size === 0) {
    return { label: "Available", tone: "info" };
  }

  const degradedReasons = unique(
    [...degradedSourceStatesBySourceId.values()]
      .map((state) => state.reason)
      .filter((reason): reason is string => typeof reason === "string" && reason.length > 0)
  );
  const sourceLabel =
    degradedSourceStatesBySourceId.size === 1
      ? "1 source"
      : `${degradedSourceStatesBySourceId.size} sources`;

  return {
    label: "Unknown",
    tone: "neutral",
    reason:
      degradedReasons[0]
        ? `Activity heatmap includes cache-fallback data for ${sourceLabel} because ${degradedReasons[0]}`
        : `Activity heatmap includes cache-fallback data for ${sourceLabel} because not every source is store-ready.`
  };
}

function buildOverviewUsageSummary(
  data: LoadedTriageData,
  sessions: Session[]
): OverviewViewModel["usageSummary"] {
  const sessionUsage = sessions.map((session) => {
    const capabilityEnvelope = getCapabilityEnvelope(data, session);

    return {
      modelCapability: getGroupedCapabilityState(
        capabilityEnvelope?.capabilities,
        "usage",
        "modelNames"
      ),
      tokenCapability: getGroupedCapabilityState(
        capabilityEnvelope?.capabilities,
        "usage",
        "tokenCounts"
      ),
      models: getSessionModelNames(data, session),
      tokenCount: getUsageTokenCount(session)
    };
  });
  const models = unique(sessionUsage.flatMap((item) => item.models));
  const sessionsWithModels = sessionUsage.filter((item) => item.models.length > 0).length;
  const sessionsWithTokens = sessionUsage.filter((item) => typeof item.tokenCount === "number").length;
  const modelCoverageReason = buildUsageCoverageReason(
    "Model names",
    sessionsWithModels,
    sessionUsage.length
  );
  const tokenCoverageReason = buildUsageCoverageReason(
    "Token counts",
    sessionsWithTokens,
    sessionUsage.length
  );

  return {
    models: buildOverviewModelsField(sessionUsage, models, modelCoverageReason),
    tokenCount: buildOverviewTokenMetric(sessionUsage, tokenCoverageReason)
  };
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
        (diagnostic) => isDiagnosticRelatedToSession(diagnostic, session)
      );

    diagnosticsBySession.set(session.id, dedupeDiagnostics(diagnostics));
  }

  return diagnosticsBySession;
}

function isDiagnosticRelatedToSession(diagnostic: Diagnostic, session: Session): boolean {
  const relatedEntityIds = new Set([
    session.id,
    ...(session.eventIds ?? []),
    ...(session.messageIds ?? []),
    ...(session.toolCallIds ?? []),
    ...(session.shellCommandIds ?? []),
    ...(session.outputArtifactIds ?? []),
    ...(session.fileMutationIds ?? [])
  ]);

  if (diagnostic.relatedEntityIds?.some((entityId) => relatedEntityIds.has(entityId))) {
    return true;
  }

  const nativeSessionId = getSessionNativeSessionId(session) ?? session.nativeId;

  return typeof diagnostic.metadata?.sessionId === "string" && diagnostic.metadata.sessionId === nativeSessionId;
}

function buildDerivedBySession(
  records: NormalizedCacheRecord[]
): Map<string, DerivedSession> {
  const derived = new Map<string, DerivedSession>();

  for (const record of records) {
    for (const session of buildRecordDerivedSessions(record)) {
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
    for (const project of buildRecordDerivedProjects(record)) {
      derived.set(project.projectId, project);
    }
  }

  return derived;
}

export function buildRecordDerivedSessions(
  record: NormalizedCacheRecord
): DerivedSession[] {
  const normalized = record.normalized;
  const adapterCapabilities =
    record.capabilitySnapshots?.adapter ?? normalized.capabilities.adapter;
  const sourceCapabilities =
    record.capabilitySnapshots?.source ?? normalized.capabilities.source;
  const sessionCapabilitiesBySessionId = new Map(
    (record.capabilitySnapshots?.sessions ?? normalized.capabilities.sessions).map((snapshot) => [
      snapshot.sessionId,
      snapshot
    ] as const)
  );
  const messagesBySessionId = groupBy(normalized.messages, (message) => message.sessionId);
  const eventsBySessionId = groupBy(normalized.events, (event) => event.sessionId);
  const toolCallsBySessionId = groupBy(normalized.toolCalls, (toolCall) => toolCall.sessionId);
  const fileMutationsBySessionId = groupBy(
    normalized.fileMutations,
    (fileMutation) => fileMutation.sessionId
  );
  const shellCommandsBySessionId = new Map(
    (record.shellCommands?.sessions ?? []).map((session) => [
      session.sessionId,
      session.shellCommands
    ] as const)
  );
  const projectGitSnapshotsByProjectId = new Map(
    (record.gitSnapshots?.projects ?? []).map((project) => [project.projectId, project.git] as const)
  );
  const diagnostics = record.diagnostics?.entries ?? normalized.diagnostics;

  return normalized.sessions.map((session) => {
    const shellCommands = shellCommandsBySessionId.get(session.id) ?? [];
    const sessionMessages = messagesBySessionId.get(session.id) ?? [];
    const sessionEvents = eventsBySessionId.get(session.id) ?? [];
    const sessionToolCalls = toolCallsBySessionId.get(session.id) ?? [];
    const sessionFileMutations = fileMutationsBySessionId.get(session.id) ?? [];
    const sessionDiagnostics = collectRecordSessionDiagnostics(
      diagnostics,
      session,
      shellCommands
    );
    const sessionCapabilities = sessionCapabilitiesBySessionId.get(session.id);
    const verification = deriveVerificationForSession({
      adapterCapabilities,
      parsedShellCommands: shellCommands,
      session,
      sessionMessages,
      ...(sessionCapabilities ? { sessionCapabilities } : {}),
      sourceCapabilities
    });
    const projectGitSnapshot = session.projectId
      ? projectGitSnapshotsByProjectId.get(session.projectId)
      : undefined;

    return {
      sessionId: session.id,
      shellCommands,
      verification,
      audit: deriveRunAuditForSession({
        adapterCapabilities,
        diagnostics: sessionDiagnostics,
        parsedShellCommands: shellCommands,
        ...(projectGitSnapshot ? { projectGitSnapshot } : {}),
        session,
        sessionEvents,
        sessionFileMutations,
        sessionMessages,
        sessionToolCalls,
        verification,
        ...(sessionCapabilities ? { sessionCapabilities } : {}),
        sourceCapabilities
      })
    };
  });
}

function buildRecordDerivedProjects(
  record: NormalizedCacheRecord
): DerivedProjectCacheRecord[] {
  const projectsById = new Map<string, DerivedProjectCacheRecord>();

  for (const project of record.gitSnapshots?.projects ?? []) {
    projectsById.set(project.projectId, {
      projectId: project.projectId,
      git: project.git
    });
  }

  for (const project of record.githubSnapshots?.projects ?? []) {
    const current = projectsById.get(project.projectId);

    projectsById.set(project.projectId, {
      projectId: project.projectId,
      git: current?.git ?? {
        status: "unknown",
        rootConfidence: "unknown",
        diagnosticIds: []
      },
      github: project.github
    });
  }

  return [...projectsById.values()];
}

function collectRecordSessionDiagnostics(
  diagnostics: Diagnostic[],
  session: Session,
  shellCommands: DerivedSession["shellCommands"]
): Diagnostic[] {
  const relatedEntityIds = new Set([
    session.id,
    ...(session.eventIds ?? []),
    ...(session.messageIds ?? []),
    ...(session.toolCallIds ?? []),
    ...(session.shellCommandIds ?? []),
    ...(session.outputArtifactIds ?? []),
    ...(session.fileMutationIds ?? []),
    ...shellCommands.flatMap((shellCommand) => [
      shellCommand.shellCommandId,
      ...(shellCommand.toolCallId ? [shellCommand.toolCallId] : []),
      ...(shellCommand.artifactIds ?? []),
      ...(shellCommand.diagnosticIds ?? [])
    ])
  ]);
  const nativeSessionId = getSessionNativeSessionId(session) ?? session.nativeId;

  return dedupeDiagnostics(
    diagnostics.filter(
      (diagnostic) =>
        relatedEntityIds.has(diagnostic.id) ||
        diagnostic.relatedEntityIds?.some((entityId) => relatedEntityIds.has(entityId)) === true ||
        session.diagnosticIds?.includes(diagnostic.id) === true ||
        (typeof diagnostic.metadata?.sessionId === "string" &&
          diagnostic.metadata.sessionId === nativeSessionId)
    )
  );
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
    .sort((left, right) => getMessageOrderKey(data, sessionId, left).localeCompare(getMessageOrderKey(data, sessionId, right)))
    .find((message) => message.role === "user");

  return firstUserMessage
    ? truncate(sanitizeText(getMessageText(firstUserMessage) ?? ""), 140)
    : undefined;
}

function buildLast30DayWindow(currentDate: Date): {
  days: string[];
  endDay: string;
  startDay: string;
} {
  const endDate = new Date(
    Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate()
    )
  );
  const startDate = addUtcDays(endDate, -29);
  const days: string[] = [];

  for (let index = 0; index < 30; index += 1) {
    days.push(toIsoDay(addUtcDays(startDate, index)));
  }

  return {
    days,
    endDay: toIsoDay(endDate),
    startDay: toIsoDay(startDate)
  };
}

function getLatestTimestamp(sessions: Session[]): string | undefined {
  return sessions
    .map((session) => getSessionActivityTimestamp(session))
    .filter((stamp): stamp is string => Boolean(stamp))
    .sort((left, right) => right.localeCompare(left))[0];
}

function getSessionActivityTimestamp(session: Session): string | undefined {
  return getSessionEndedAt(session) ?? session.startedAt;
}

function addUtcDays(date: Date, dayDelta: number): Date {
  const next = new Date(date);

  next.setUTCDate(next.getUTCDate() + dayDelta);
  return next;
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

function isSessionActiveOrRecent(session: Session, latestTimestamp?: string): boolean {
  if (getSessionLifecycleStatus(session) === "active") {
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

function toMetricStateFromCapability(
  state?: { status: "supported" | "unsupported" | "unknown"; reason?: string }
): MetricStateViewModel {
  if (state?.status === "unsupported") {
    return toMetricState("unsupported", "Unsupported", state.reason);
  }

  return toMetricState("unknown", "Unknown", state?.reason);
}

function toCapabilityCountMetric(
  value: number,
  state?: { status: "supported" | "unsupported" | "unknown"; reason?: string }
): MetricStateViewModel {
  if (state?.status === "supported") {
    return toMetricValue(value);
  }

  return toMetricStateFromCapability(state);
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

function toIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function hasSessionCapabilities(session: Session): session is Session & {
  adapterId: string;
  sourceId: string;
  capabilities: NonNullable<Session["capabilities"]>;
} {
  return Boolean(session.adapterId && session.sourceId && session.capabilities);
}

export function getProjectDisplayName(project?: Project): string | undefined {
  if (!project) {
    return undefined;
  }

  return project.displayName;
}

function getProjectPrimaryRootPath(project?: Project): string | undefined {
  return project?.primaryRootPath;
}

function getSessionNativeSessionId(session: Session): string | undefined {
  return session.nativeSessionId;
}

function getSessionLifecycleStatus(
  session: Session
): "active" | "completed" | "cancelled" | "unknown" {
  return session.lifecycleStatus ?? "unknown";
}

function getSessionEndedAt(session: Session): string | undefined {
  return session.lastUpdatedAt;
}

function getSessionFirstUserPrompt(session: Session): string | undefined {
  const candidate = session as Session & {
    firstUserPrompt?: string;
  };

  return candidate.firstUserPrompt;
}

function getSessionVerification(session: Session): {
  status: "passed" | "failed" | "not-run" | "unknown" | "unsupported";
  reasonCodes?: string[];
} | undefined {
  const verification = session.verification;
  const status = verification?.status;

  return status
    ? {
        status,
        ...(verification?.reasonCodes ? { reasonCodes: verification.reasonCodes } : {})
      }
    : undefined;
}

function getSessionRunAudit(session: Session): {
  status:
    | "active"
    | "cancelled"
    | "verification-failed"
    | "incomplete"
    | "needs-review"
    | "clean"
    | "unknown";
  attentionReasons: string[];
} | undefined {
  const runAudit = session.runAudit;
  const status = runAudit?.status;

  return status
    ? {
        status,
        attentionReasons: runAudit?.attentionReasons ?? []
      }
    : undefined;
}

function getAttentionReasons(session: Session, derived?: DerivedSession): string[] {
  const candidate = session as Session & { attentionReasons?: string[] };
  const reasons = candidate.attentionReasons ?? derived?.audit?.attentionReasons ?? [];

  return reasons.map(humanizeAttentionReason);
}

function getMessageOrderKey(
  data: LoadedTriageData,
  sessionId: string,
  message: SessionMessage
): string {
  const eventsById = new Map(
    (data.eventsBySessionId.get(sessionId) ?? []).map((event) => [event.id, event] as const)
  );
  const orderKeys = (message.eventIds ?? [])
    .map((eventId) => eventsById.get(eventId)?.orderKey)
    .filter((orderKey): orderKey is string => Boolean(orderKey))
    .sort((left, right) => left.localeCompare(right));

  return orderKeys[0] ?? message.timestamp ?? "";
}

function getMessageText(message: SessionMessage): string | undefined {
  return message.text;
}

function toTokenCountMetric(
  session: Session,
  capability?: { status: "supported" | "unsupported" | "unknown"; reason?: string }
): MetricStateViewModel {
  const tokenCount = getUsageTokenCount(session);

  if (typeof tokenCount === "number") {
    return toMetricValue(tokenCount);
  }

  if (capability?.status === "supported") {
    return toMetricState("unknown", "Unknown", "Token counts were expected but not observed.");
  }

  return toMetricStateFromCapability(capability);
}

function toSessionModelsField(
  data: LoadedTriageData,
  session: Session,
  capability?: { status: "supported" | "unsupported" | "unknown"; reason?: string }
): FieldValueViewModel {
  const models = getSessionModelNames(data, session);

  if (models.length > 0) {
    return toFieldValueWithDisplay(models.join(", "), models.join(", "));
  }

  if (capability?.status === "supported") {
    return toFieldState("Unknown", "Model names were expected but not observed.");
  }

  return toFieldState(
    capability?.status === "unsupported" ? "Unsupported" : "Unknown",
    capability?.reason
  );
}

function getUsageTokenCount(session: Session): number | undefined {
  const candidate = session as Session & {
    usage?: {
      totalTokens?: number;
      tokenCounts?: {
        total?: number;
      };
    };
  };

  return candidate.usage?.totalTokens ?? candidate.usage?.tokenCounts?.total;
}

function getSessionModelNames(
  data: LoadedTriageData,
  session: Session
): string[] {
  const metadataModelNames = session.metadata?.modelNames;

  if (Array.isArray(metadataModelNames) && metadataModelNames.length > 0) {
    return unique(
      metadataModelNames
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => sanitizeText(value))
    );
  }

  return unique(
    (data.messagesBySessionId.get(session.id) ?? [])
      .map((message) => message.modelName)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => sanitizeText(value))
  );
}

function buildOverviewModelsField(
  sessionUsage: Array<{
    modelCapability: { status: "supported" | "unsupported" | "unknown"; reason?: string } | undefined;
    models: string[];
  }>,
  models: string[],
  coverageReason?: string
): FieldValueViewModel {
  if (models.length > 0) {
    return {
      ...toFieldValueWithDisplay(models.join(", "), models.join(", ")),
      ...(coverageReason ? { reason: coverageReason } : {})
    };
  }

  const modelStatus = summarizeUsageCapability(
    sessionUsage,
    "modelCapability",
    (item) => item.models.length > 0
  );

  return toFieldState(
    modelStatus === "unsupported" ? "Unsupported" : "Unknown",
    modelStatus === "unsupported"
      ? "Selected sessions do not expose model names."
      : "Model names are not available for the selected sessions."
  );
}

function buildOverviewTokenMetric(
  sessionUsage: Array<{
    tokenCapability: { status: "supported" | "unsupported" | "unknown"; reason?: string } | undefined;
    tokenCount: number | undefined;
  }>,
  coverageReason?: string
): MetricStateViewModel {
  const hasObservedTokenCount = sessionUsage.some((item) => typeof item.tokenCount === "number");
  const tokenCount = sessionUsage.reduce((total, item) => total + (item.tokenCount ?? 0), 0);

  if (hasObservedTokenCount) {
    return {
      ...toMetricValue(tokenCount),
      ...(coverageReason ? { reason: coverageReason } : {})
    };
  }

  const tokenStatus = summarizeUsageCapability(
    sessionUsage,
    "tokenCapability",
    (item) => typeof item.tokenCount === "number"
  );

  return toMetricState(
    tokenStatus === "unsupported" ? "unsupported" : "unknown",
    tokenStatus === "unsupported" ? "Unsupported" : "Unknown",
    tokenStatus === "unsupported"
      ? "Selected sessions do not expose token counts."
      : "Token counts are not available for the selected sessions."
  );
}

function buildUsageCoverageReason(
  label: string,
  availableCount: number,
  totalCount: number
): string | undefined {
  if (totalCount === 0 || availableCount === 0 || availableCount === totalCount) {
    return undefined;
  }

  return `${label} are available for ${availableCount} of ${totalCount} selected sessions.`;
}

function summarizeUsageCapability<TItem>(
  items: readonly TItem[],
  capabilityKey: keyof TItem,
  hasValue: (item: TItem) => boolean
): "value" | "unknown" | "unsupported" {
  if (items.length === 0) {
    return "unknown";
  }

  let sawSupported = false;
  let sawUnsupported = false;
  let sawUnknown = false;

  for (const item of items) {
    const capability = item[capabilityKey] as
      | { status: "supported" | "unsupported" | "unknown" }
      | undefined;

    if (capability?.status === "supported") {
      sawSupported = true;

      if (!hasValue(item)) {
        return "unknown";
      }

      continue;
    }

    if (capability?.status === "unsupported") {
      sawUnsupported = true;
      continue;
    }

    sawUnknown = true;
  }

  if (sawSupported && !sawUnsupported && !sawUnknown) {
    return "value";
  }

  if (sawUnsupported && !sawSupported && !sawUnknown) {
    return "unsupported";
  }

  return "unknown";
}
