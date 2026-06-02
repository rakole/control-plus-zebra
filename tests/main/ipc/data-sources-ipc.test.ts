import { describe, expect, it, vi } from "vitest";

import type { ArchiveImportService } from "../../../src/main/app/archive-import-service.js";
import type { ArchiveExportService } from "../../../src/main/app/archive-export-service.js";
import type { DiagnosticsViewModelService } from "../../../src/main/app/diagnostics-view-model-service.js";
import type { DataSourcesViewModelService } from "../../../src/main/app/data-sources-view-model-service.js";
import type { OutputArtifactViewModelService } from "../../../src/main/app/output-artifact-view-model-service.js";
import type { RunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import type { SessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import type { SessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import type { ThemeService } from "../../../src/main/theme/theme-service.js";
import type { TriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { IPC_CHANNELS, registerIpcHandlers } from "../../../src/main/ipc/index.js";
import { sourcesResponseSchema } from "../../../src/main/ipc/view-models.js";

describe("data sources IPC handlers", () => {
  it("routes validate and scan through separate named service methods", async () => {
    const collector = createIpcCollector();
    const services = createServices();

    registerIpcHandlers(collector, services);

    const validate = await collector.invoke(IPC_CHANNELS.validateSource, {
      sourceId: "source-1"
    });
    const scan = await collector.invoke(IPC_CHANNELS.rescanSource, {
      sourceId: "source-1"
    });

    expect(services.dataSourcesService.validateDataSource).toHaveBeenCalledWith({
      sourceId: "source-1"
    });
    expect(services.dataSourcesService.scanDataSource).toHaveBeenCalledWith({
      sourceId: "source-1"
    });
    expect(() => sourcesResponseSchema.parse(validate)).not.toThrow();
    expect(() => sourcesResponseSchema.parse(scan)).not.toThrow();
  });

  it("routes archive import through the dedicated import service", async () => {
    const collector = createIpcCollector();
    const services = createServices();

    registerIpcHandlers(collector, services);

    const result = await collector.invoke(IPC_CHANNELS.openArchive, {
      archivePath: "/tmp/example.awb-archive.json"
    });

    expect(services.archiveImportService.openArchive).toHaveBeenCalledWith({
      archivePath: "/tmp/example.awb-archive.json"
    });
    expect(result).toEqual({
      ok: true,
      archiveImport: {
        status: "cancelled"
      }
    });
  });

  it("returns sanitized invalid-request errors for bad data source payloads", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createServices());

    const result = await collector.invoke(IPC_CHANNELS.addSource, {
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

    const result = await collector.invoke(IPC_CHANNELS.rescanSource, {
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
        capabilityGroups: [],
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
    getScannerStatus: vi.fn(async () => ({
      status: "idle" as const,
      totalSources: 0,
      enabledSources: 0,
      activeScans: 0,
      staleSources: 0,
      queuedScans: 0,
      activeBackgroundScans: 0,
      coalescingSources: 0,
      watchingSources: 0
    })),
    ...overrides
  };

  const archiveExportService: ArchiveExportService = {
    createArchive: vi.fn(async () => ({
      status: "cancelled" as const,
      rawArtifactsIncluded: false,
      rawArtifactCount: 0
    }))
  };

  const archiveImportService: ArchiveImportService = {
    openArchive: vi.fn(async () => ({
      status: "cancelled" as const
    }))
  };

  const sessionService: SessionViewModelService = {
    getShellState: vi.fn(() => ({
      appName: "Ctr + Zebra" as const,
      readOnly: true as const,
      allowedOperations: [
        IPC_CHANNELS.getShellState,
        IPC_CHANNELS.createArchive,
        IPC_CHANNELS.openArchive,
        IPC_CHANNELS.getDashboardStats,
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
      usageSummary: {
        models: { status: "unknown" as const, displayValue: "Unknown" },
        tokenCount: { status: "unsupported" as const, displayValue: "Unsupported" }
      },
      harnessFilters: [],
      activity: []
    })),
    getOverviewActivityHeatmap: vi.fn(async () => ({
      buckets: Array.from({ length: 30 }, (_, index) => ({
        day: `2026-04-${String(index + 1).padStart(2, "0")}`,
        sessionCount: 0,
        needsAttentionCount: 0
      })),
      coverageState: {
        label: "Available" as const,
        tone: "info" as const
      }
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
  const outputArtifactService: OutputArtifactViewModelService = {
    getPreview: vi.fn(async ({ outputArtifactId }) => ({
      status: "unavailable" as const,
      outputArtifactId,
      reason: "Output artifact fixtures are not used by data source IPC tests.",
      timelineEntry: null
    })),
    loadArtifact: vi.fn(async ({ outputArtifactId }) => ({
      status: "unavailable" as const,
      outputArtifactId,
      reason: "Output artifact fixtures are not used by data source IPC tests.",
      timelineEntry: null
    }))
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
