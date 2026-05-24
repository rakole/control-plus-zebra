import { describe, expect, it } from "vitest";

import type { ArchiveExportService } from "../../../src/main/app/archive-export-service.js";
import type { DiagnosticsViewModelService } from "../../../src/main/app/diagnostics-view-model-service.js";
import { IPC_CHANNELS, registerIpcHandlers } from "../../../src/main/ipc/index.js";
import type { DataSourcesViewModelService } from "../../../src/main/app/data-sources-view-model-service.js";
import type { RunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import type { SessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import type { SessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import type { TriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import {
  createArchiveResponseSchema,
  dataSourcesResponseSchema,
  getOverviewResponseSchema,
  getSessionByIdResponseSchema,
  getSessionDetailResponseSchema,
  getRunAuditResponseSchema,
  listDiagnosticsResponseSchema,
  listProjectsResponseSchema,
  listSessionsResponseSchema,
  shellStateViewModelSchema,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel
} from "../../../src/main/ipc/view-models.js";

describe("ipc handlers", () => {
  it("registers only the allowed IPC channels", () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeServices());

    expect([...collector.handlers.keys()]).toEqual([
      IPC_CHANNELS.getShellState,
      IPC_CHANNELS.createArchive,
      IPC_CHANNELS.getOverview,
      IPC_CHANNELS.listProjects,
      IPC_CHANNELS.listSessions,
      IPC_CHANNELS.getSessionById,
      IPC_CHANNELS.getSessionDetail,
      IPC_CHANNELS.getRunAudit,
      IPC_CHANNELS.listDiagnostics,
      IPC_CHANNELS.listDataSources,
      IPC_CHANNELS.addDataSource,
      IPC_CHANNELS.updateDataSource,
      IPC_CHANNELS.setDataSourceEnabled,
      IPC_CHANNELS.validateDataSource,
      IPC_CHANNELS.scanDataSource
    ]);
  });

  it("returns sanitized invalid-request errors for bad get-by-id payloads", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeServices());

    const result = await collector.invoke(IPC_CHANNELS.getSessionById, { sessionId: "" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        message: "Request payload is not valid for this operation."
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|\/Users|adapter|rawEvents/u);
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
    const overview = await collector.invoke(IPC_CHANNELS.getOverview);
    const projects = await collector.invoke(IPC_CHANNELS.listProjects);
    const list = await collector.invoke(IPC_CHANNELS.listSessions);
    const get = await collector.invoke(IPC_CHANNELS.getSessionById, { sessionId: "session_1" });
    const detail = await collector.invoke(IPC_CHANNELS.getSessionDetail, {
      sessionId: "session_1"
    });
    const runAudit = await collector.invoke(IPC_CHANNELS.getRunAudit, {
      sessionId: "session_1"
    });
    const diagnostics = await collector.invoke(IPC_CHANNELS.listDiagnostics);
    const sources = await collector.invoke(IPC_CHANNELS.listDataSources);

    expect(() => shellStateViewModelSchema.parse(shell)).not.toThrow();
    expect(() => createArchiveResponseSchema.parse(archive)).not.toThrow();
    expect(() => getOverviewResponseSchema.parse(overview)).not.toThrow();
    expect(() => listProjectsResponseSchema.parse(projects)).not.toThrow();
    expect(() => listSessionsResponseSchema.parse(list)).not.toThrow();
    expect(() => getSessionByIdResponseSchema.parse(get)).not.toThrow();
    expect(() => getSessionDetailResponseSchema.parse(detail)).not.toThrow();
    expect(() => getRunAuditResponseSchema.parse(runAudit)).not.toThrow();
    expect(() => listDiagnosticsResponseSchema.parse(diagnostics)).not.toThrow();
    expect(() => dataSourcesResponseSchema.parse(sources)).not.toThrow();
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
  archiveExportService: ArchiveExportService;
  dataSourcesService: DataSourcesViewModelService;
  diagnosticsService: DiagnosticsViewModelService;
  runAuditService: RunAuditViewModelService;
  sessionService: SessionViewModelService;
  sessionDetailService: SessionDetailViewModelService;
  triageService: TriageViewModelService;
} {
  const summary: SessionSummaryViewModel = {
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
    projectName: "control-plus-zebra",
    firstPrompt: "Define the shared contracts.",
    capabilityBadges: [
      {
        key: "sessionDiscovery",
        label: "Session discovery",
        state: "Supported"
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
    triageMetrics: {
      toolCalls: { status: "value", displayValue: "1", numericValue: 1 },
      fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
      commands: { status: "value", displayValue: "1", numericValue: 1 },
      failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
      tokenCount: { status: "unsupported", displayValue: "Unsupported" }
    }
  };
  const preview: SessionPreviewViewModel = {
    ...summary,
    projectName: "control-plus-zebra",
    diagnostics: []
  };
  const dataSourcesViewModel = {
    adapters: [
      {
        adapterId: "fake-test",
        displayName: "Fake Test Harness",
        capabilityBadges: [],
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
        manifestVersion: 1,
        rawArtifactsIncluded: false,
        rawArtifactCount: 0
      };
    }
  };

  const sessionService: SessionViewModelService = {
    getShellState() {
      return {
        appName: "Agent Workbench",
        readOnly: true,
        allowedOperations: [
          IPC_CHANNELS.getShellState,
          IPC_CHANNELS.createArchive,
          IPC_CHANNELS.getOverview,
          IPC_CHANNELS.listProjects,
          IPC_CHANNELS.listSessions,
          IPC_CHANNELS.getSessionById,
          IPC_CHANNELS.getSessionDetail,
          IPC_CHANNELS.getRunAudit,
          IPC_CHANNELS.listDiagnostics,
          IPC_CHANNELS.listDataSources,
          IPC_CHANNELS.addDataSource,
          IPC_CHANNELS.updateDataSource,
          IPC_CHANNELS.setDataSourceEnabled,
          IPC_CHANNELS.validateDataSource,
          IPC_CHANNELS.scanDataSource
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
        harnessFilters: [
          { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 1 }
        ],
        activity: [{ day: "2026-05-23", sessionCount: 1, needsAttentionCount: 1 }]
      };
    },
    async listProjects() {
      return [
        {
          projectId: "project-1",
          projectName: "control-plus-zebra",
          repoPath: {
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
    }
  };

  return {
    archiveExportService,
    dataSourcesService,
    diagnosticsService,
    runAuditService,
    sessionService,
    sessionDetailService,
    triageService
  };
}
