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

export interface CapabilityGroupFixture {
  key: string;
  label: string;
  capabilities: CapabilityBadgeFixture[];
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
  projectDisplayName: string;
  firstUserPrompt: string;
  capabilityGroups: CapabilityGroupFixture[];
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
  evidenceMetrics: {
    messages: MetricFixture;
    toolCalls: MetricFixture;
    shellCommands: MetricFixture;
    outputArtifacts: MetricFixture;
    fileMutations: MetricFixture;
    diagnostics: MetricFixture;
  };
  usageSummary: {
    models: {
      status: string;
      displayValue: string;
      rawValue?: string;
      reason?: string;
    };
    tokenCount: MetricFixture;
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
  archiveExport: {
    scopeKind: "project" | "session";
    scopeId: string;
    scopeLabel: string;
    sessionCount: number;
    sourceCount: number;
    rawArtifactsAvailable: boolean;
    rawArtifactCount: number;
    rawArtifactsReason?: string;
  };
  sections: Array<{
    id: string;
    title: string;
    summary: string;
    items: Array<{
      label: string;
      value: string;
      tone: string;
      hint?: string;
      kind?: "text" | "command-list";
      commands?: Array<{ command: string; result: string }>;
    }>;
  }>;
}

export interface OverviewFixture {
  metrics: Record<string, MetricFixture>;
  usageSummary: {
    models: { status: string; displayValue: string; rawValue?: string; reason?: string };
    tokenCount: MetricFixture;
  };
  harnessFilters: Array<{ adapterId: string; label: string; sessionCount: number }>;
  activity: Array<{ day: string; sessionCount: number; needsAttentionCount: number }>;
}

export interface OverviewHeatmapFixture {
  buckets: Array<{ day: string; sessionCount: number; needsAttentionCount: number }>;
  coverageState: TruthStateFixture;
}

export interface ProjectFixture {
  projectId: string;
  projectDisplayName: string;
  primaryRootPath: { status: string; displayValue: string; rawValue?: string };
  validatedRepoRoot: { status: string; displayValue: string; rawValue?: string; reason?: string };
  observedHarnesses: string[];
  latestActivityAt: string;
  sessionCount: number;
  latestVerification: TruthStateFixture;
  latestRunAudit: TruthStateFixture;
  gitStatus: TruthStateFixture;
  githubStatus: TruthStateFixture;
  branch: { status: string; displayValue: string };
  head: { status: string; displayValue: string };
  dirtyState: TruthStateFixture;
  changedFiles: { status: string; displayValue: string };
  untrackedFiles: { status: string; displayValue: string };
  additions: { status: string; displayValue: string };
  deletions: { status: string; displayValue: string };
  remoteUrl: { status: string; displayValue: string; reason?: string };
  pullRequest: { status: string; displayValue: string };
  checks: { status: string; displayValue: string };
  reviewStatus: { status: string; displayValue: string };
  archiveExport: {
    scopeKind: "project" | "session";
    scopeId: string;
    scopeLabel: string;
    sessionCount: number;
    sourceCount: number;
    rawArtifactsAvailable: boolean;
    rawArtifactCount: number;
    rawArtifactsReason?: string;
  };
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
      projectDisplayName?: string;
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
    projectDisplayName: "Control Plus Zebra",
    firstUserPrompt: "Define the shared contracts and keep them harness-neutral.",
    capabilityGroups: [
      {
        key: "replay",
        label: "Replay",
        capabilities: [
          {
            key: "replay.transcriptReplay",
            label: "Transcript Replay",
            state: "Supported"
          }
        ]
      },
      {
        key: "audit",
        label: "Audit",
        capabilities: [
          {
            key: "audit.gitContext",
            label: "Git Context",
            state: "Unsupported",
            reason: "Git evidence is unavailable."
          }
        ]
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
    evidenceMetrics: {
      messages: { status: "value", displayValue: "3", numericValue: 3 },
      toolCalls: { status: "value", displayValue: "2", numericValue: 2 },
      shellCommands: { status: "value", displayValue: "1", numericValue: 1 },
      outputArtifacts: { status: "value", displayValue: "1", numericValue: 1 },
      fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
      diagnostics: { status: "value", displayValue: "1", numericValue: 1 }
    },
    usageSummary: {
      models: {
        status: "value",
        displayValue: "gemini-3-flash-preview",
        rawValue: "gemini-3-flash-preview"
      },
      tokenCount: { status: "value", displayValue: "280", numericValue: 280 }
    },
    triageMetrics: {
      toolCalls: { status: "value", displayValue: "2", numericValue: 2 },
      fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
      commands: { status: "value", displayValue: "1", numericValue: 1 },
      failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
      tokenCount: { status: "value", displayValue: "280", numericValue: 280 }
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
      },
      {
        id: "artifact-1",
        kind: "output-artifact" as const,
        timestamp: "2026-05-23T10:00:05.000Z",
        title: "Output artifact",
        summary: "Typecheck output artifact",
        metadata: [
          { label: "Kind", value: "Plain Text" },
          { label: "Reference", value: "typecheck.log" }
        ]
      }
    ],
    ...overrides
  };
}

export function buildRunAudit(overrides: Partial<RunAuditFixture> = {}) {
  return {
    session: buildSessionPreview(),
    archiveExport: {
      scopeKind: "session" as const,
      scopeId: "session-1",
      scopeLabel: "Fixture session",
      sessionCount: 1,
      sourceCount: 1,
      rawArtifactsAvailable: true,
      rawArtifactCount: 2
    },
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
        id: "commands",
        title: "Commands",
        summary: "Show command evidence without replaying raw output.",
        items: [
          { label: "Observed Commands", value: "3", tone: "neutral" as const },
          { label: "Failed Commands", value: "1", tone: "danger" as const },
          {
            label: "Recent Commands",
            value: "Recent command activity",
            tone: "neutral" as const,
            kind: "command-list" as const,
            commands: [
              { command: "npm run test -- tests/main/core/run-audit-engine.test.ts", result: "Failed" },
              { command: "npm run typecheck", result: "Passed" },
              { command: "git status --short", result: "Passed" }
            ]
          }
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
          { label: "GitHub Snapshot", value: "No Matching PR", tone: "neutral" as const },
          { label: "Pull Request", value: "No Matching PR", tone: "neutral" as const },
          { label: "Checks", value: "No Matching PR", tone: "neutral" as const },
          { label: "Review / Merge", value: "No Matching PR", tone: "neutral" as const }
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
    usageSummary: {
      models: {
        status: "value" as const,
        displayValue: "gemini-3-flash-preview",
        rawValue: "gemini-3-flash-preview"
      },
      tokenCount: { status: "value" as const, displayValue: "560", numericValue: 560 }
    },
    harnessFilters: [
      { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 1 },
      { adapterId: "gemini-cli", label: "Gemini CLI", sessionCount: 2 }
    ],
    activity: [{ day: "2026-05-23", sessionCount: 3, needsAttentionCount: 2 }],
    ...overrides
  };
}

export function buildOverviewHeatmap(
  overrides: Partial<OverviewHeatmapFixture> = {}
): OverviewHeatmapFixture {
  return {
    buckets: Array.from({ length: 30 }, (_, index) => {
      const date = new Date(2026, 3, 29 + index);
      const day = `${date.getFullYear()}-${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;

      if (day === "2026-05-03") {
        return { day, sessionCount: 1, needsAttentionCount: 0 };
      }

      if (day === "2026-05-14") {
        return { day, sessionCount: 2, needsAttentionCount: 1 };
      }

      if (day === "2026-05-28") {
        return { day, sessionCount: 3, needsAttentionCount: 2 };
      }

      return { day, sessionCount: 0, needsAttentionCount: 0 };
    }),
    coverageState: { label: "Available", tone: "info" },
    ...overrides
  };
}

export function buildProject(overrides: Partial<ProjectFixture> = {}) {
  return {
    projectId: "project-1",
    projectDisplayName: "control-plus-zebra",
    primaryRootPath: {
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
    githubStatus: { label: "No Matching PR", tone: "neutral" as const },
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
    pullRequest: { status: "value" as const, displayValue: "No Matching PR" },
    checks: { status: "value" as const, displayValue: "No Matching PR" },
    reviewStatus: { status: "value" as const, displayValue: "No Matching PR" },
    archiveExport: {
      scopeKind: "project" as const,
      scopeId: "project-1",
      scopeLabel: "control-plus-zebra",
      sessionCount: 2,
      sourceCount: 2,
      rawArtifactsAvailable: true,
      rawArtifactCount: 3
    },
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
        title: "Capability Gaps",
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
            projectDisplayName: "Control Plus Zebra",
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
  const detailBySessionId = {
    [firstSession.sessionId]: options.detail ?? buildSessionDetail({ session: firstPreview }),
    [secondSession.sessionId]:
      options.secondDetail ??
      buildSessionDetail({
        session: secondPreview,
        timeline: [
          {
            id: "event-1",
            kind: "message" as const,
            timestamp: "2026-05-23T10:10:01.000Z",
            title: "User message",
            summary: "Summarize the last scan without losing the cancellation trail.",
            metadata: [
              { label: "Role", value: "User" },
              { label: "Ordinal", value: "0" }
            ]
          },
          {
            id: "artifact-1",
            kind: "output-artifact" as const,
            timestamp: "2026-05-23T10:10:05.000Z",
            title: "Output artifact",
            summary: "Scan summary artifact",
            metadata: [
              { label: "Kind", value: "Plain Text" },
              { label: "Reference", value: "scan-summary.txt" }
            ]
          }
        ]
      }),
    ...(options.detailBySessionId ?? {})
  };

  const bridge = {
    getShellState: vi.fn(),
    createArchive: vi.fn().mockResolvedValue({
      ok: true,
      archive: {
        status: "exported",
        archivePath: "/tmp/control-plus-zebra.awb-archive.json",
        manifestVersion: 2,
        rawArtifactsIncluded: false,
        rawArtifactCount: 0
      }
    }),
    openArchive: vi.fn().mockResolvedValue({
      ok: true,
      archiveImport: {
        status: "cancelled"
      }
    }),
    listHarnesses: vi.fn().mockResolvedValue({
      ok: true,
      harnesses: [
        {
          adapterId: "fake-test",
          displayName: "Fake Test Harness",
          capabilityGroups: [],
          defaultRoots: []
        },
        {
          adapterId: "gemini-cli",
          displayName: "Gemini CLI",
          capabilityGroups: [],
          defaultRoots: []
        }
      ]
    }),
    getDashboardStats: vi.fn().mockResolvedValue({
      ok: true,
      stats: options.overview ?? buildOverview()
    }),
    getOverviewActivityHeatmap: vi.fn().mockResolvedValue({
      ok: true,
      heatmap: options.overviewHeatmap ?? buildOverviewHeatmap()
    }),
    listProjects: vi.fn().mockResolvedValue({
      ok: true,
      projects: options.projects ?? [buildProject()]
    }),
    listSessions: vi.fn().mockResolvedValue({
      ok: true,
      sessions: options.sessions ?? [firstSession, secondSession]
    }),
    getSession: vi.fn().mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        ok: true,
        session: sessionId === secondSession.sessionId ? secondPreview : firstPreview
      })
    ),
    getSessionTimeline: vi.fn().mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        ok: true,
        timeline:
          (detailBySessionId[sessionId] ?? detailBySessionId[firstSession.sessionId])?.timeline ??
          null
      })
    ),
    getRunAudit: vi.fn().mockResolvedValue({
      ok: true,
      runAudit: options.runAudit ?? buildRunAudit()
    }),
    listDiagnostics: vi.fn().mockResolvedValue({
      ok: true,
      diagnostics: options.diagnostics ?? buildDiagnostics()
    }),
    listSources: vi.fn().mockResolvedValue({ ok: true, sources: { adapters: [], sources: [] } }),
    addSource: vi.fn(),
    updateSource: vi.fn(),
    disableSource: vi.fn(),
    validateSource: vi.fn(),
    rescanSource: vi.fn(),
    getScannerStatus: vi.fn(),
    rescanAllSources: vi.fn(),
    rescanScannerSource: vi.fn(),
    getProject: vi.fn(),
    getEvents: vi.fn(),
    getToolCalls: vi.fn(),
    getShellCommands: vi.fn(),
    getOutputArtifactPreview: vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        status: "preview-ready",
        outputArtifactId: "artifact-1",
        contentKind: "plain-text",
        text: "Type checking passed.",
        truncated: false,
        byteLength: 21,
        timelineEntry: null
      }
    }),
    loadOutputArtifact: vi.fn().mockResolvedValue({
      ok: true,
      artifact: {
        status: "loaded",
        outputArtifactId: "artifact-1",
        contentKind: "plain-text",
        text: "Type checking passed.",
        byteLength: 21,
        timelineEntry: null
      }
    }),
    getGitSnapshot: vi.fn(),
    getGitHubSnapshot: vi.fn()
  };

  Object.defineProperty(window, "agentWorkbench", {
    configurable: true,
    value: bridge
  });

  return bridge;
}
interface BridgeOptions {
  detail: SessionDetailFixture;
  detailBySessionId: Record<string, SessionDetailFixture>;
  diagnostics: DiagnosticsFixture;
  firstPreview: SessionPreviewFixture;
  firstSession: SessionSummaryFixture;
  overview: OverviewFixture;
  overviewHeatmap: OverviewHeatmapFixture;
  projects: ProjectFixture[];
  runAudit: RunAuditFixture;
  secondDetail: SessionDetailFixture;
  secondPreview: SessionPreviewFixture;
  secondSession: SessionSummaryFixture;
  sessions: SessionSummaryFixture[];
}
