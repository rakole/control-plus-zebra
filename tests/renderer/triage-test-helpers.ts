import { vi } from "vitest";

export interface TruthStateFixture {
  label: string;
  tone: "neutral" | "positive" | "warning" | "danger" | "info";
  reason?: string;
}

export interface CapabilityBadgeFixture {
  key: string;
  label: string;
  state: "Supported" | "Unsupported" | "Unknown";
  reason?: string;
}

export interface MetricFixture {
  status: "value" | "unknown" | "unsupported" | "not-run";
  displayValue: string;
  numericValue?: number;
  reason?: string;
}

export interface SessionSummaryFixture {
  adapterId: string;
  adapterDisplayName: string;
  sourceId: string;
  sessionId: string;
  nativeSessionId: string;
  title: string;
  lifecycleStatus: "active" | "completed" | "cancelled" | "unknown";
  lifecycleState: TruthStateFixture;
  startedAt: string;
  endedAt: string;
  projectName: string;
  firstPrompt: string;
  capabilityBadges: CapabilityBadgeFixture[];
  diagnosticWarningCount: number;
  verificationState: TruthStateFixture;
  runAuditState: TruthStateFixture;
  attentionReasons: string[];
  evidenceSummary: {
    messages: number;
    toolCalls: number;
    shellCommands: number;
    outputArtifacts: number;
    fileMutations: number;
    diagnostics: number;
  };
  triageMetrics: {
    toolCalls: MetricFixture;
    fileMutations: MetricFixture;
    commands: MetricFixture;
    failedCommands: MetricFixture;
    tokenCount: MetricFixture;
  };
}

export interface SessionPreviewFixture extends SessionSummaryFixture {
  diagnostics: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
}

export interface SessionDetailFixture {
  session: SessionPreviewFixture;
  timeline: Array<{
    id: string;
    kind: string;
    timestamp: string;
    title: string;
    summary: string;
    metadata: Array<{ label: string; value: string }>;
  }>;
}

export interface RunAuditFixture {
  session: SessionPreviewFixture;
  sections: Array<{
    id: string;
    title: string;
    summary: string;
    items: Array<{ label: string; value: string; tone: string; hint?: string }>;
  }>;
}

export interface OverviewFixture {
  metrics: Record<string, MetricFixture>;
  harnessFilters: Array<{ adapterId: string; label: string; sessionCount: number }>;
  activity: Array<{ day: string; sessionCount: number; needsAttentionCount: number }>;
}

export interface ProjectFixture {
  projectId: string;
  projectName: string;
  repoPath: { status: string; displayValue: string; rawValue?: string };
  validatedRepoRoot: { status: string; displayValue: string; rawValue?: string; reason?: string };
  observedHarnesses: string[];
  latestActivityAt: string;
  sessionCount: number;
  latestVerification: TruthStateFixture;
  latestRunAudit: TruthStateFixture;
  gitStatus: TruthStateFixture;
  branch: { status: string; displayValue: string };
  head: { status: string; displayValue: string };
  dirtyState: TruthStateFixture;
  changedFiles: { status: string; displayValue: string };
  untrackedFiles: { status: string; displayValue: string };
  additions: { status: string; displayValue: string };
  deletions: { status: string; displayValue: string };
  remoteUrl: { status: string; displayValue: string; reason?: string };
  pullRequest: { status: string; displayValue: string };
}

export interface DiagnosticsFixture {
  harnessFilters: Array<{ adapterId: string; label: string; sessionCount: number }>;
  severityFilters: Array<"info" | "warning" | "error">;
  groups: Array<{
    groupId: string;
    title: string;
    sourceArea: "adapter" | "source" | "normalization" | "cache" | "capability";
    severity: "info" | "warning" | "error";
    count: number;
    diagnostics: Array<{
      code: string;
      severity: "info" | "warning" | "error";
      sourceArea: "adapter" | "source" | "normalization" | "cache" | "capability";
      adapterId: string;
      adapterDisplayName: string;
      sessionId?: string;
      sessionTitle?: string;
      projectName?: string;
      message: string;
    }>;
  }>;
}

export function buildSessionSummary(
  overrides: Partial<SessionSummaryFixture> = {}
): SessionSummaryFixture {
  return {
    adapterId: "fake-test",
    adapterDisplayName: "Fake Test Harness",
    sourceId: "source-1",
    sessionId: "session-1",
    nativeSessionId: "native-1",
    title: "Fixture session",
    lifecycleStatus: "completed",
    lifecycleState: { label: "Completed", tone: "positive" },
    startedAt: "2026-05-23T10:00:00.000Z",
    endedAt: "2026-05-23T10:08:00.000Z",
    projectName: "Control Plus Zebra",
    firstPrompt: "Define the shared contracts and keep them harness-neutral.",
    capabilityBadges: [
      {
        key: "messageCapture",
        label: "Message Capture",
        state: "Supported"
      },
      {
        key: "gitContextCapture",
        label: "Git Context Capture",
        state: "Unsupported",
        reason: "Git evidence is unavailable."
      }
    ],
    diagnosticWarningCount: 1,
    verificationState: { label: "Passed", tone: "positive" },
    runAuditState: { label: "Needs Review", tone: "warning" },
    attentionReasons: ["Capability Missing"],
    evidenceSummary: {
      messages: 3,
      toolCalls: 2,
      shellCommands: 1,
      outputArtifacts: 1,
      fileMutations: 1,
      diagnostics: 1
    },
    triageMetrics: {
      toolCalls: { status: "value", displayValue: "2", numericValue: 2 },
      fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
      commands: { status: "value", displayValue: "1", numericValue: 1 },
      failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
      tokenCount: { status: "unsupported", displayValue: "Unsupported" }
    },
    ...overrides
  };
}

export function buildSessionPreview(overrides: Partial<SessionPreviewFixture> = {}) {
  return {
    ...buildSessionSummary(),
    diagnostics: [
      {
        code: "fake.partial-evidence",
        severity: "warning" as const,
        message: "Some evidence is intentionally unavailable."
      }
    ],
    ...overrides
  };
}

export function buildSessionDetail(overrides: Partial<SessionDetailFixture> = {}) {
  return {
    session: buildSessionPreview(),
    timeline: [
      {
        id: "event-1",
        kind: "message" as const,
        timestamp: "2026-05-23T10:00:01.000Z",
        title: "User message",
        summary: "Define the shared contracts and keep them harness-neutral.",
        metadata: [
          { label: "Role", value: "User" },
          { label: "Ordinal", value: "0" }
        ]
      },
      {
        id: "event-2",
        kind: "shell-command" as const,
        timestamp: "2026-05-23T10:00:04.000Z",
        title: "npm run typecheck",
        summary: "Type checking passed.",
        metadata: [
          { label: "Intent", value: "Typecheck" },
          { label: "Result", value: "Passed" }
        ]
      }
    ],
    ...overrides
  };
}

export function buildRunAudit(overrides: Partial<RunAuditFixture> = {}) {
  return {
    session: buildSessionPreview(),
    sections: [
      {
        id: "claim-vs-evidence",
        title: "Claim vs Evidence",
        summary: "Compare completion claims against the current shared audit verdict.",
        items: [
          { label: "Completion Claim", value: "Claimed", tone: "neutral" as const },
          { label: "Run Audit", value: "Needs Review", tone: "warning" as const }
        ]
      },
      {
        id: "git-github",
        title: "Git / GitHub",
        summary: "Show shared read-only repository truth and keep GitHub gaps explicit.",
        items: [
          { label: "Git Snapshot", value: "Available", tone: "info" as const },
          { label: "Branch", value: "main", tone: "info" as const },
          {
            label: "Remote URL",
            value: "https://github.com/example/control-plus-zebra.git",
            tone: "info" as const
          },
          { label: "Pull Request", value: "Unknown", tone: "neutral" as const }
        ]
      }
    ],
    ...overrides
  };
}

export function buildOverview(overrides: Partial<OverviewFixture> = {}) {
  return {
    metrics: {
      totalProjects: { status: "value" as const, displayValue: "2", numericValue: 2 },
      totalSessions: { status: "value" as const, displayValue: "3", numericValue: 3 },
      activeOrRecentSessions: { status: "value" as const, displayValue: "2", numericValue: 2 },
      failedVerification: { status: "value" as const, displayValue: "1", numericValue: 1 },
      cancelledSessions: { status: "value" as const, displayValue: "1", numericValue: 1 },
      needsAttentionSessions: { status: "value" as const, displayValue: "2", numericValue: 2 },
      toolActivity: { status: "value" as const, displayValue: "4", numericValue: 4 }
    },
    harnessFilters: [
      { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 1 },
      { adapterId: "gemini-cli", label: "Gemini CLI", sessionCount: 2 }
    ],
    activity: [{ day: "2026-05-23", sessionCount: 3, needsAttentionCount: 2 }],
    ...overrides
  };
}

export function buildProject(overrides: Partial<ProjectFixture> = {}) {
  return {
    projectId: "project-1",
    projectName: "control-plus-zebra",
    repoPath: {
      status: "value" as const,
      displayValue: "/workspace/control-plus-zebra",
      rawValue: "/workspace/control-plus-zebra"
    },
    validatedRepoRoot: {
      status: "value" as const,
      displayValue: "/workspace/control-plus-zebra",
      rawValue: "/workspace/control-plus-zebra"
    },
    observedHarnesses: ["Fake Test Harness", "Gemini CLI"],
    latestActivityAt: "2026-05-23T10:08:00.000Z",
    sessionCount: 2,
    latestVerification: { label: "Passed", tone: "positive" as const },
    latestRunAudit: { label: "Needs Review", tone: "warning" as const },
    gitStatus: { label: "Available", tone: "info" as const },
    branch: { status: "value" as const, displayValue: "main" },
    head: { status: "value" as const, displayValue: "abc12345" },
    dirtyState: { label: "Dirty", tone: "warning" as const },
    changedFiles: { status: "value" as const, displayValue: "1" },
    untrackedFiles: { status: "value" as const, displayValue: "1" },
    additions: { status: "value" as const, displayValue: "2" },
    deletions: { status: "value" as const, displayValue: "0" },
    remoteUrl: {
      status: "value" as const,
      displayValue: "https://github.com/example/control-plus-zebra.git"
    },
    pullRequest: { status: "unknown" as const, displayValue: "Unknown" },
    ...overrides
  };
}

export function buildDiagnostics(overrides: Partial<DiagnosticsFixture> = {}) {
  return {
    harnessFilters: [
      { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 2 }
    ],
    severityFilters: ["info", "warning", "error"] as Array<
      "info" | "warning" | "error"
    >,
    groups: [
      {
        groupId: "capability:warning",
        title: "Capability Warnings",
        sourceArea: "capability" as const,
        severity: "warning" as const,
        count: 1,
        diagnostics: [
          {
            code: "capability.gitContextCapture",
            severity: "warning" as const,
            sourceArea: "capability" as const,
            adapterId: "fake-test",
            adapterDisplayName: "Fake Test Harness",
            sessionId: "session-1",
            sessionTitle: "Fixture session",
            projectName: "Control Plus Zebra",
            message: "Git Context Capture is Unsupported. Git evidence is unavailable."
          }
        ]
      }
    ],
    ...overrides
  };
}

export function installBridgeMocks(options: Partial<BridgeOptions> = {}) {
  const firstSession = options.firstSession ?? buildSessionSummary();
  const secondSession =
    options.secondSession ??
    buildSessionSummary({
      sessionId: "session-2",
      nativeSessionId: "native-2",
      title: "Bridge preview session",
      lifecycleStatus: "active",
      lifecycleState: { label: "Active", tone: "info" },
      verificationState: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
      runAuditState: { label: "Active", tone: "info" },
      attentionReasons: ["No Verification"]
    });
  const firstPreview = options.firstPreview ?? buildSessionPreview(firstSession);
  const secondPreview =
    options.secondPreview ?? buildSessionPreview({ ...secondSession, diagnostics: [] });

  const bridge = {
    getShellState: vi.fn(),
    getOverview: vi.fn().mockResolvedValue({
      ok: true,
      overview: options.overview ?? buildOverview()
    }),
    listProjects: vi.fn().mockResolvedValue({
      ok: true,
      projects: options.projects ?? [buildProject()]
    }),
    listSessions: vi.fn().mockResolvedValue({
      ok: true,
      sessions: options.sessions ?? [firstSession, secondSession]
    }),
    getSessionById: vi.fn().mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        ok: true,
        session: sessionId === secondSession.sessionId ? secondPreview : firstPreview
      })
    ),
    getSessionDetail: vi.fn().mockResolvedValue({
      ok: true,
      detail: options.detail ?? buildSessionDetail()
    }),
    getRunAudit: vi.fn().mockResolvedValue({
      ok: true,
      runAudit: options.runAudit ?? buildRunAudit()
    }),
    listDiagnostics: vi.fn().mockResolvedValue({
      ok: true,
      diagnostics: options.diagnostics ?? buildDiagnostics()
    }),
    listDataSources: vi.fn().mockResolvedValue({ ok: true, dataSources: { adapters: [], sources: [] } }),
    addDataSource: vi.fn(),
    updateDataSource: vi.fn(),
    setDataSourceEnabled: vi.fn(),
    validateDataSource: vi.fn(),
    scanDataSource: vi.fn()
  };

  Object.defineProperty(window, "agentWorkbench", {
    configurable: true,
    value: bridge
  });

  return bridge;
}
interface BridgeOptions {
  detail: SessionDetailFixture;
  diagnostics: DiagnosticsFixture;
  firstPreview: SessionPreviewFixture;
  firstSession: SessionSummaryFixture;
  overview: OverviewFixture;
  projects: ProjectFixture[];
  runAudit: RunAuditFixture;
  secondPreview: SessionPreviewFixture;
  secondSession: SessionSummaryFixture;
  sessions: SessionSummaryFixture[];
}
