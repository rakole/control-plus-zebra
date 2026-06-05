import { describe, expect, it } from "vitest";

import type { ArchiveImportService } from "../../../src/main/app/archive-import-service.js";
import type { ArchiveExportService } from "../../../src/main/app/archive-export-service.js";
import type { DiagnosticsViewModelService } from "../../../src/main/app/diagnostics-view-model-service.js";
import { IPC_CHANNELS, registerIpcHandlers } from "../../../src/main/ipc/index.js";
import type { DataSourcesViewModelService } from "../../../src/main/app/data-sources-view-model-service.js";
import type { OutputArtifactViewModelService } from "../../../src/main/app/output-artifact-view-model-service.js";
import type { RunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import type { SessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import type { SessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import type { ThemeService } from "../../../src/main/theme/theme-service.js";
import type { TriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import {
  PaginationValidationError,
  encodeOpaqueCursor
} from "../../../src/main/core/store/index.js";
import {
  createArchiveResponseSchema,
  dashboardStatsResponseSchema,
  getOverviewActivityHeatmapResponseSchema,
  getSessionResponseSchema,
  sessionTimelineResponseSchema,
  getRunAuditResponseSchema,
  listDiagnosticsResponseSchema,
  listProjectsResponseSchema,
  listSessionsResponseSchema,
  outputArtifactLoadResponseSchema,
  outputArtifactPreviewResponseSchema,
  shellStateViewModelSchema,
  sourcesResponseSchema,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel
} from "../../../src/main/ipc/view-models.js";

describe("ipc handlers", () => {
  it("registers only the allowed IPC channels", () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeServices());

    expect([...collector.handlers.keys()]).toEqual([
      IPC_CHANNELS.getShellState,
      IPC_CHANNELS.listHarnesses,
      IPC_CHANNELS.getHarnessCapabilities,
      IPC_CHANNELS.listSources,
      IPC_CHANNELS.addSource,
      IPC_CHANNELS.updateSource,
      IPC_CHANNELS.disableSource,
      IPC_CHANNELS.validateSource,
      IPC_CHANNELS.rescanSource,
      IPC_CHANNELS.getScannerStatus,
      IPC_CHANNELS.rescanAllSources,
      IPC_CHANNELS.rescanScannerSource,
      IPC_CHANNELS.createArchive,
      IPC_CHANNELS.openArchive,
      IPC_CHANNELS.getDashboardStats,
      IPC_CHANNELS.getOverviewActivityHeatmap,
      IPC_CHANNELS.listProjects,
      IPC_CHANNELS.getProject,
      IPC_CHANNELS.listSessions,
      IPC_CHANNELS.getSession,
      IPC_CHANNELS.getSessionTimeline,
      IPC_CHANNELS.getEvents,
      IPC_CHANNELS.getToolCalls,
      IPC_CHANNELS.getShellCommands,
      IPC_CHANNELS.getOutputArtifactPreview,
      IPC_CHANNELS.loadOutputArtifact,
      IPC_CHANNELS.getAuditRunAudit,
      IPC_CHANNELS.getGitSnapshot,
      IPC_CHANNELS.getGitHubSnapshot,
      IPC_CHANNELS.listDiagnostics,
      IPC_CHANNELS.getThemeState,
      IPC_CHANNELS.setThemePreference
    ]);
  });

  it("returns sanitized invalid-request errors for bad get-by-id payloads", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeServices());

    const result = await collector.invoke(IPC_CHANNELS.getSession, { sessionId: "" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        message: "Request payload is not valid for this operation."
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|\/Users|adapter|rawEvents/u);
  });

  it("returns sanitized invalid-request errors for invalid pagination cursors", async () => {
    const collector = createIpcCollector();
    const services = createFakeServices();

    services.sessionService.listSessionsPage = async () => {
      throw new PaginationValidationError("invalid-cursor");
    };
    services.sessionDetailService.getSessionTimeline = async () => {
      throw new PaginationValidationError("invalid-cursor");
    };
    registerIpcHandlers(collector, services);

    const list = await collector.invoke(IPC_CHANNELS.listSessions, {
      cursor: "bad-cursor"
    });
    const timeline = await collector.invoke(IPC_CHANNELS.getSessionTimeline, {
      sessionId: "session_1",
      cursor: "bad-cursor"
    });

    expect(list).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        message: "Request payload is not valid for this operation."
      }
    });
    expect(timeline).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        message: "Request payload is not valid for this operation."
      }
    });
  });

  it("accepts opaque list and timeline cursors at IPC boundaries", async () => {
    const collector = createIpcCollector();
    const services = createFakeServices();
    const requestCursor = encodeOpaqueCursor({
      adapterId: "fake-test",
      fallbackIndex: 0,
      nextCursorBySourceIdJson: "{}"
    });
    const responseCursor = encodeOpaqueCursor({
      adapterId: "fake-test",
      fallbackIndex: 1,
      nextCursorBySourceIdJson: "{}"
    });
    const requests: unknown[] = [];
    const timelineRequests: unknown[] = [];

    services.sessionService.listSessionsPage = async (request = {}) => {
      requests.push(request);
      return {
        sessions: await services.sessionService.listSessions(),
        pageInfo: {
          hasMore: true,
          nextCursor: responseCursor,
          totalCount: 1
        }
      };
    };
    services.sessionDetailService.getSessionTimeline = async (request) => {
      timelineRequests.push(request);
      return {
        timeline: [],
        pageInfo: {
          hasMore: true,
          nextCursor: responseCursor,
          totalCount: 51
        }
      };
    };
    registerIpcHandlers(collector, services);

    const list = await collector.invoke(IPC_CHANNELS.listSessions, {
      adapterId: "fake-test",
      cursor: requestCursor,
      limit: 25
    });
    const timeline = await collector.invoke(IPC_CHANNELS.getSessionTimeline, {
      sessionId: "session_1",
      cursor: requestCursor
    });

    expect(requests).toEqual([
      {
        adapterId: "fake-test",
        cursor: requestCursor,
        limit: 25
      }
    ]);
    expect(() => listSessionsResponseSchema.parse(list)).not.toThrow();
    expect(list).toMatchObject({
      ok: true,
      pageInfo: {
        hasMore: true,
        nextCursor: responseCursor,
        totalCount: 1
      }
    });
    expect(timelineRequests).toEqual([
      {
        sessionId: "session_1",
        cursor: requestCursor
      }
    ]);
    expect(timeline).toEqual({
      ok: true,
      timeline: [],
      pageInfo: {
        hasMore: true,
        nextCursor: responseCursor,
        totalCount: 51
      }
    });
  });

  it("returns schema-valid DTOs for shell, list, and get handlers", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeServices());

    const shell = await collector.invoke(IPC_CHANNELS.getShellState);
    const archive = await collector.invoke(IPC_CHANNELS.createArchive, {
      scope: { kind: "project", projectId: "project-1" },
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true
    });
    const overview = await collector.invoke(IPC_CHANNELS.getDashboardStats);
    const heatmap = await collector.invoke(IPC_CHANNELS.getOverviewActivityHeatmap);
    const projects = await collector.invoke(IPC_CHANNELS.listProjects);
    const list = await collector.invoke(IPC_CHANNELS.listSessions);
    const get = await collector.invoke(IPC_CHANNELS.getSession, { sessionId: "session_1" });
    const timeline = await collector.invoke(IPC_CHANNELS.getSessionTimeline, {
      sessionId: "session_1"
    });
    const previewArtifact = await collector.invoke(IPC_CHANNELS.getOutputArtifactPreview, {
      sessionId: "session_1",
      outputArtifactId: "output-artifact_1"
    });
    const loadedArtifact = await collector.invoke(IPC_CHANNELS.loadOutputArtifact, {
      sessionId: "session_1",
      outputArtifactId: "output-artifact_1"
    });
    const runAudit = await collector.invoke(IPC_CHANNELS.getAuditRunAudit, {
      sessionId: "session_1"
    });
    const diagnostics = await collector.invoke(IPC_CHANNELS.listDiagnostics);
    const sources = await collector.invoke(IPC_CHANNELS.listSources);
    const scanner = await collector.invoke(IPC_CHANNELS.getScannerStatus);

    expect(overview).toMatchObject({
      ok: true,
      stats: {
        usageSummary: {
          tokenMetrics: {
            totalTokens: { status: "unsupported", displayValue: "Unsupported" },
            inputTokens: { status: "unsupported", displayValue: "Unsupported" },
            outputTokens: { status: "unsupported", displayValue: "Unsupported" },
            thoughtTokens: { status: "unsupported", displayValue: "Unsupported" },
            cacheReadTokens: { status: "unsupported", displayValue: "Unsupported" }
          }
        }
      }
    });
    expect(list).toMatchObject({
      ok: true,
      sessions: [
        expect.objectContaining({
          usageSummary: expect.objectContaining({
            tokenMetrics: expect.objectContaining({
              totalTokens: { status: "unsupported", displayValue: "Unsupported" },
              inputTokens: { status: "unsupported", displayValue: "Unsupported" },
              outputTokens: { status: "unsupported", displayValue: "Unsupported" },
              thoughtTokens: { status: "unsupported", displayValue: "Unsupported" },
              cacheReadTokens: { status: "unsupported", displayValue: "Unsupported" }
            })
          })
        })
      ]
    });
    expect(get).toMatchObject({
      ok: true,
      session: expect.objectContaining({
        usageSummary: expect.objectContaining({
          tokenMetrics: expect.objectContaining({
            totalTokens: { status: "unsupported", displayValue: "Unsupported" },
            inputTokens: { status: "unsupported", displayValue: "Unsupported" },
            outputTokens: { status: "unsupported", displayValue: "Unsupported" },
            thoughtTokens: { status: "unsupported", displayValue: "Unsupported" },
            cacheReadTokens: { status: "unsupported", displayValue: "Unsupported" }
          })
        })
      })
    });

    expect(() => shellStateViewModelSchema.parse(shell)).not.toThrow();
    expect(() => createArchiveResponseSchema.parse(archive)).not.toThrow();
    expect(() => dashboardStatsResponseSchema.parse(overview)).not.toThrow();
    expect(() => getOverviewActivityHeatmapResponseSchema.parse(heatmap)).not.toThrow();
    expect(() => listProjectsResponseSchema.parse(projects)).not.toThrow();
    expect(() => listSessionsResponseSchema.parse(list)).not.toThrow();
    expect(() => getSessionResponseSchema.parse(get)).not.toThrow();
    expect(() => sessionTimelineResponseSchema.parse(timeline)).not.toThrow();
    expect(() => outputArtifactPreviewResponseSchema.parse(previewArtifact)).not.toThrow();
    expect(() => outputArtifactLoadResponseSchema.parse(loadedArtifact)).not.toThrow();
    expect(() => getRunAuditResponseSchema.parse(runAudit)).not.toThrow();
    expect(() => listDiagnosticsResponseSchema.parse(diagnostics)).not.toThrow();
    expect(() => sourcesResponseSchema.parse(sources)).not.toThrow();
    expect(scanner).toMatchObject({
      ok: true,
      scanner: {
        queuedScans: 0,
        activeBackgroundScans: 0,
        coalescingSources: 0,
        watchingSources: 0
      }
    });
  });

  it("routes the dedicated overview heatmap request through the triage service", async () => {
    const collector = createIpcCollector();
    const services = createFakeServices();
    const requests: unknown[] = [];

    services.triageService.getOverviewActivityHeatmap = async (request) => {
      requests.push(request ?? {});
      return {
        buckets: Array.from({ length: 30 }, (_, index) => ({
          day: `2026-05-${String(index + 1).padStart(2, "0")}`,
          sessionCount: index === 29 ? 1 : 0,
          needsAttentionCount: index === 29 ? 1 : 0
        })),
        coverageState: {
          label: "Available",
          tone: "info"
        }
      };
    };
    registerIpcHandlers(collector, services);

    const response = await collector.invoke(IPC_CHANNELS.getOverviewActivityHeatmap, {
      adapterId: "fake-test"
    });

    expect(requests).toEqual([{ adapterId: "fake-test" }]);
    expect(() => getOverviewActivityHeatmapResponseSchema.parse(response)).not.toThrow();
  });

  it("does not register the retired sessions run-audit alias", () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeServices());

    expect(collector.handlers.has("sessions:getRunAudit")).toBe(false);
  });
});

function createIpcCollector() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();

  return {
    handlers,
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown) {
      handlers.set(channel, listener);
    },
    async invoke(channel: string, payload?: unknown) {
      const handler = handlers.get(channel);

      if (!handler) {
        throw new Error(`No handler registered for ${channel}`);
      }

      return handler({}, payload);
    }
  };
}

function createFakeServices(): {
  archiveImportService: ArchiveImportService;
  archiveExportService: ArchiveExportService;
  dataSourcesService: DataSourcesViewModelService;
  diagnosticsService: DiagnosticsViewModelService;
  outputArtifactService: OutputArtifactViewModelService;
  runAuditService: RunAuditViewModelService;
  sessionService: SessionViewModelService;
  sessionDetailService: SessionDetailViewModelService;
  themeService: ThemeService;
  triageService: TriageViewModelService;
} {
  const summary = {
    adapterId: "fake-test",
    adapterDisplayName: "Fake Test Harness",
    sourceId: "source_1",
    sessionId: "session_1",
    nativeSessionId: "native-session-1",
    title: "Safe fake session",
    lifecycleStatus: "completed",
    lifecycleState: {
      label: "Completed",
      tone: "positive"
    },
    startedAt: "2026-05-23T10:00:00.000Z",
    endedAt: "2026-05-23T10:00:01.000Z",
    projectDisplayName: "control-plus-zebra",
    firstUserPrompt: "Define the shared contracts.",
    capabilityGroups: [
      {
        key: "discovery",
        label: "Discovery",
        capabilities: [
          {
            key: "discovery.sessionDiscovery",
            label: "Session discovery",
            state: "Supported"
          }
        ]
      }
    ],
    diagnosticWarningCount: 0,
    verificationState: {
      label: "Passed",
      tone: "positive"
    },
    runAuditState: {
      label: "Needs Review",
      tone: "warning"
    },
    attentionReasons: ["Capability Missing"],
    evidenceSummary: {
      messages: 1,
      toolCalls: 1,
      shellCommands: 1,
      outputArtifacts: 1,
      fileMutations: 1,
      diagnostics: 0
    },
    evidenceMetrics: {
      messages: { status: "value", displayValue: "1", numericValue: 1 },
      toolCalls: { status: "value", displayValue: "1", numericValue: 1 },
      shellCommands: { status: "value", displayValue: "1", numericValue: 1 },
      outputArtifacts: { status: "value", displayValue: "1", numericValue: 1 },
      fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
      diagnostics: { status: "value", displayValue: "0", numericValue: 0 }
    },
    usageSummary: {
      models: { status: "unknown", displayValue: "Unknown" },
      tokenMetrics: {
        totalTokens: { status: "unsupported", displayValue: "Unsupported" },
        inputTokens: { status: "unsupported", displayValue: "Unsupported" },
        outputTokens: { status: "unsupported", displayValue: "Unsupported" },
        thoughtTokens: { status: "unsupported", displayValue: "Unsupported" },
        cacheReadTokens: { status: "unsupported", displayValue: "Unsupported" }
      },
      tokenCount: { status: "unsupported", displayValue: "Unsupported" }
    },
    triageMetrics: {
      toolCalls: { status: "value", displayValue: "1", numericValue: 1 },
      fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
      commands: { status: "value", displayValue: "1", numericValue: 1 },
      failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
      tokenCount: { status: "unsupported", displayValue: "Unsupported" }
    }
  } as unknown as SessionSummaryViewModel;
  const preview = {
    ...summary,
    diagnostics: []
  } as unknown as SessionPreviewViewModel;
  const dataSourcesViewModel = {
    adapters: [
      {
        adapterId: "fake-test",
        displayName: "Fake Test Harness",
        capabilityGroups: [],
        defaultRoots: []
      }
    ],
    sources: []
  };

  const archiveExportService: ArchiveExportService = {
    async createArchive() {
      return {
        status: "exported",
        archivePath: "/tmp/control-plus-zebra.awb-archive.json",
        manifestVersion: 2,
        rawArtifactsIncluded: false,
        rawArtifactCount: 0
      };
    }
  };

  const archiveImportService: ArchiveImportService = {
    async openArchive() {
      return {
        status: "cancelled"
      };
    }
  };

  const sessionService: SessionViewModelService = {
    getShellState() {
      return {
        appName: "Ctr + Zebra",
        readOnly: true,
        allowedOperations: [
          IPC_CHANNELS.getShellState,
          IPC_CHANNELS.createArchive,
          IPC_CHANNELS.openArchive,
          IPC_CHANNELS.getDashboardStats,
          IPC_CHANNELS.getOverviewActivityHeatmap,
          IPC_CHANNELS.listProjects,
          IPC_CHANNELS.listSessions,
          IPC_CHANNELS.getSession,
          IPC_CHANNELS.getSessionTimeline,
          IPC_CHANNELS.getAuditRunAudit,
          IPC_CHANNELS.listDiagnostics,
          IPC_CHANNELS.listSources,
          IPC_CHANNELS.addSource,
          IPC_CHANNELS.updateSource,
          IPC_CHANNELS.disableSource,
          IPC_CHANNELS.validateSource,
          IPC_CHANNELS.rescanSource,
          IPC_CHANNELS.getThemeState,
          IPC_CHANNELS.setThemePreference
        ],
        adapters: [
          {
            adapterId: "fake-test",
            displayName: "Fake Test Harness"
          }
        ]
      };
    },
    async listSessions() {
      return [summary];
    },
    async getSessionById({ sessionId }: { sessionId: string }) {
      return sessionId === preview.sessionId ? preview : null;
    }
  };

  const sessionDetailService: SessionDetailViewModelService = {
    async getSessionDetail({ sessionId }: { sessionId: string }) {
      if (sessionId !== preview.sessionId) {
        return null;
      }

      return {
        session: preview,
        timeline: []
      };
    }
  };

  const runAuditService: RunAuditViewModelService = {
    async getRunAudit({ sessionId }: { sessionId: string }) {
      if (sessionId !== preview.sessionId) {
        return null;
      }

      return {
        session: preview,
        sections: [],
        archiveExport: {
          scopeKind: "session",
          scopeId: "session_1",
          scopeLabel: "Safe fake session",
          sessionCount: 1,
          sourceCount: 1,
          rawArtifactsAvailable: false,
          rawArtifactCount: 0,
          rawArtifactsReason: "No indexed raw artifacts are available for this archive scope."
        }
      };
    }
  };

  const outputArtifactService: OutputArtifactViewModelService = {
    async getPreview({ outputArtifactId }: { outputArtifactId: string }) {
      return {
        status: "preview-ready",
        outputArtifactId,
        contentKind: "plain-text",
        mediaType: "text/plain",
        text: "safe preview",
        truncated: false,
        timelineEntry: null
      };
    },
    async loadArtifact({ outputArtifactId }: { outputArtifactId: string }) {
      return {
        status: "loaded",
        outputArtifactId,
        contentKind: "plain-text",
        mediaType: "text/plain",
        text: "safe full artifact",
        byteLength: 18,
        timelineEntry: null
      };
    }
  };

  const triageService: TriageViewModelService = {
    async getOverview() {
      return {
        metrics: {
          totalProjects: { status: "value", displayValue: "1", numericValue: 1 },
          totalSessions: { status: "value", displayValue: "1", numericValue: 1 },
          activeOrRecentSessions: { status: "value", displayValue: "1", numericValue: 1 },
          failedVerification: { status: "value", displayValue: "0", numericValue: 0 },
          cancelledSessions: { status: "value", displayValue: "0", numericValue: 0 },
          needsAttentionSessions: { status: "value", displayValue: "1", numericValue: 1 },
          toolActivity: { status: "value", displayValue: "1", numericValue: 1 }
        },
        usageSummary: {
          models: { status: "unknown", displayValue: "Unknown" },
          tokenMetrics: {
            totalTokens: { status: "unsupported", displayValue: "Unsupported" },
            inputTokens: { status: "unsupported", displayValue: "Unsupported" },
            outputTokens: { status: "unsupported", displayValue: "Unsupported" },
            thoughtTokens: { status: "unsupported", displayValue: "Unsupported" },
            cacheReadTokens: { status: "unsupported", displayValue: "Unsupported" }
          },
          tokenCount: { status: "unsupported", displayValue: "Unsupported" }
        },
        harnessFilters: [
          { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 1 }
        ],
        activity: [{ day: "2026-05-23", sessionCount: 1, needsAttentionCount: 1 }]
      };
    },
    async getOverviewActivityHeatmap() {
      return {
        buckets: Array.from({ length: 30 }, (_, index) => ({
          day: `2026-04-${String(index + 1).padStart(2, "0")}`,
          sessionCount: index === 29 ? 1 : 0,
          needsAttentionCount: index === 29 ? 1 : 0
        })),
        coverageState: {
          label: "Available",
          tone: "info"
        }
      };
    },
    async listProjects() {
      return [
        {
          projectId: "project-1",
          projectDisplayName: "control-plus-zebra",
          primaryRootPath: {
            status: "value",
            displayValue: "/workspace/control-plus-zebra",
            rawValue: "/workspace/control-plus-zebra"
          },
          validatedRepoRoot: {
            status: "unknown",
            displayValue: "Unknown"
          },
          observedHarnesses: ["Fake Test Harness"],
          latestActivityAt: "2026-05-23T10:00:01.000Z",
          sessionCount: 1,
          latestVerification: { label: "Passed", tone: "positive" },
          latestRunAudit: { label: "Needs Review", tone: "warning" },
          gitStatus: { label: "Unknown", tone: "neutral" },
          githubStatus: { label: "Unknown", tone: "neutral" },
          branch: { status: "unknown", displayValue: "Unknown" },
          head: { status: "unknown", displayValue: "Unknown" },
          dirtyState: { label: "Unknown", tone: "neutral" },
          changedFiles: { status: "unknown", displayValue: "Unknown" },
          untrackedFiles: { status: "unknown", displayValue: "Unknown" },
          additions: { status: "unknown", displayValue: "Unknown" },
          deletions: { status: "unknown", displayValue: "Unknown" },
          remoteUrl: { status: "unknown", displayValue: "Unknown" },
          pullRequest: { status: "unknown", displayValue: "Unknown" },
          checks: { status: "unknown", displayValue: "Unknown" },
          reviewStatus: { status: "unknown", displayValue: "Unknown" },
          archiveExport: {
            scopeKind: "project",
            scopeId: "project-1",
            scopeLabel: "control-plus-zebra",
            sessionCount: 1,
            sourceCount: 1,
            rawArtifactsAvailable: false,
            rawArtifactCount: 0,
            rawArtifactsReason: "No indexed raw artifacts are available for this archive scope."
          }
        }
      ];
    }
  };

  const diagnosticsService: DiagnosticsViewModelService = {
    async listDiagnostics() {
      return {
        harnessFilters: [
          { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 1 }
        ],
        severityFilters: ["info", "warning", "error"],
        groups: []
      };
    }
  };

  const dataSourcesService: DataSourcesViewModelService = {
    async listDataSources() {
      return dataSourcesViewModel;
    },
    async addDataSource() {
      return dataSourcesViewModel;
    },
    async updateDataSource() {
      return dataSourcesViewModel;
    },
    async setDataSourceEnabled() {
      return dataSourcesViewModel;
    },
    async validateDataSource() {
      return dataSourcesViewModel;
    },
    async scanDataSource() {
      return dataSourcesViewModel;
    },
    async getScannerStatus() {
      return {
        status: "idle",
        totalSources: dataSourcesViewModel.sources.length,
        enabledSources: 0,
        activeScans: 0,
        staleSources: 0,
        queuedScans: 0,
        activeBackgroundScans: 0,
        coalescingSources: 0,
        watchingSources: 0
      };
    }
  };
  const themeService: ThemeService = {
    getThemeState() {
      return {
        preference: "system",
        effectiveTheme: "light",
        shouldUseHighContrastColors: false
      };
    },
    setThemePreference() {},
    onThemeStateChanged() {
      return () => {};
    },
    registerWindow() {},
    unregisterWindow() {},
    dispose() {}
  };

  return {
    archiveImportService,
    archiveExportService,
    dataSourcesService,
    diagnosticsService,
    outputArtifactService,
    runAuditService,
    sessionService,
    sessionDetailService,
    themeService,
    triageService
  };
}
