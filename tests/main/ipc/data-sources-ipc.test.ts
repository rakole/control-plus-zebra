import { describe, expect, it, vi } from "vitest";

import type { DiagnosticsViewModelService } from "../../../src/main/app/diagnostics-view-model-service.js";
import type { DataSourcesViewModelService } from "../../../src/main/app/data-sources-view-model-service.js";
import type { RunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import type { SessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import type { SessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import type { TriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { IPC_CHANNELS, registerIpcHandlers } from "../../../src/main/ipc/index.js";
import { dataSourcesResponseSchema } from "../../../src/main/ipc/view-models.js";

describe("data sources IPC handlers", () => {
  it("routes validate and scan through separate named service methods", async () => {
    const collector = createIpcCollector();
    const services = createServices();

    registerIpcHandlers(collector, services);

    const validate = await collector.invoke(IPC_CHANNELS.validateDataSource, {
      sourceId: "source-1"
    });
    const scan = await collector.invoke(IPC_CHANNELS.scanDataSource, {
      sourceId: "source-1"
    });

    expect(services.dataSourcesService.validateDataSource).toHaveBeenCalledWith({
      sourceId: "source-1"
    });
    expect(services.dataSourcesService.scanDataSource).toHaveBeenCalledWith({
      sourceId: "source-1"
    });
    expect(() => dataSourcesResponseSchema.parse(validate)).not.toThrow();
    expect(() => dataSourcesResponseSchema.parse(scan)).not.toThrow();
  });

  it("returns sanitized invalid-request errors for bad data source payloads", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createServices());

    const result = await collector.invoke(IPC_CHANNELS.addDataSource, {
      adapterId: "",
      rootPath: ""
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        message: "Request payload is not valid for this operation."
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|\/Users|rawEvents/u);
  });

  it("sanitizes service failures for source operations", async () => {
    const collector = createIpcCollector();
    const services = createServices({
      scanDataSource: vi.fn(async () => {
        throw new Error("raw path /tmp/private-source plus stack");
      })
    });

    registerIpcHandlers(collector, services);

    const result = await collector.invoke(IPC_CHANNELS.scanDataSource, {
      sourceId: "source-1"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "data-sources-load-failed",
        message: "Data sources could not be loaded."
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/\/tmp\/private-source|stack/u);
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

function createServices(overrides: Partial<DataSourcesViewModelService> = {}) {
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

  const dataSourcesService: DataSourcesViewModelService = {
    listDataSources: vi.fn(async () => dataSourcesViewModel),
    addDataSource: vi.fn(async () => dataSourcesViewModel),
    updateDataSource: vi.fn(async () => dataSourcesViewModel),
    setDataSourceEnabled: vi.fn(async () => dataSourcesViewModel),
    validateDataSource: vi.fn(async () => dataSourcesViewModel),
    scanDataSource: vi.fn(async () => dataSourcesViewModel),
    ...overrides
  };

  const sessionService: SessionViewModelService = {
    getShellState: vi.fn(() => ({
      appName: "Agent Workbench" as const,
      readOnly: true as const,
      allowedOperations: [
        IPC_CHANNELS.getShellState,
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
      adapters: []
    })),
    listSessions: vi.fn(async () => []),
    getSessionById: vi.fn(async () => null)
  };

  const sessionDetailService: SessionDetailViewModelService = {
    getSessionDetail: vi.fn(async () => null)
  };

  const runAuditService: RunAuditViewModelService = {
    getRunAudit: vi.fn(async () => null)
  };

  const triageService: TriageViewModelService = {
    getOverview: vi.fn(async () => ({
      metrics: {
        totalProjects: { status: "value" as const, displayValue: "0", numericValue: 0 },
        totalSessions: { status: "value" as const, displayValue: "0", numericValue: 0 },
        activeOrRecentSessions: {
          status: "value" as const,
          displayValue: "0",
          numericValue: 0
        },
        failedVerification: { status: "value" as const, displayValue: "0", numericValue: 0 },
        cancelledSessions: { status: "value" as const, displayValue: "0", numericValue: 0 },
        needsAttentionSessions: {
          status: "value" as const,
          displayValue: "0",
          numericValue: 0
        },
        toolActivity: { status: "value" as const, displayValue: "0", numericValue: 0 }
      },
      harnessFilters: [],
      activity: []
    })),
    listProjects: vi.fn(async () => [])
  };

  const diagnosticsService: DiagnosticsViewModelService = {
    listDiagnostics: vi.fn(async () => ({
      harnessFilters: [],
      severityFilters: ["info", "warning", "error"] as Array<
        "info" | "warning" | "error"
      >,
      groups: []
    }))
  };

  return {
    dataSourcesService,
    diagnosticsService,
    runAuditService,
    sessionService,
    sessionDetailService,
    triageService
  };
}
