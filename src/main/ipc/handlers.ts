import { z } from "zod";

import {
  createArchiveImportService,
  type ArchiveImportService
} from "../app/archive-import-service.js";
import {
  createArchiveExportService,
  type ArchiveExportService
} from "../app/archive-export-service.js";
import {
  createOutputArtifactViewModelService,
  type OutputArtifactViewModelService
} from "../app/output-artifact-view-model-service.js";
import {
  createDiagnosticsViewModelService,
  type DiagnosticsViewModelService
} from "../app/diagnostics-view-model-service.js";
import {
  createDataSourcesViewModelService,
  type DataSourcesViewModelService
} from "../app/data-sources-view-model-service.js";
import {
  createRunAuditViewModelService,
  type RunAuditViewModelService
} from "../app/run-audit-view-model-service.js";
import {
  createSessionViewModelService,
  type SessionViewModelService
} from "../app/session-view-model-service.js";
import {
  createSessionDetailViewModelService,
  type SessionDetailViewModelService
} from "../app/session-detail-view-model-service.js";
import {
  createTriageViewModelService,
  type TriageViewModelService
} from "../app/triage-view-model-service.js";
import { createWorkbenchRuntime } from "../app/workbench-runtime.js";
import { PaginationValidationError } from "../core/store/index.js";
import { createThemeService, type ThemeService } from "../theme/theme-service.js";
import { IPC_CHANNELS } from "./channels.js";
import {
  createArchiveRequestSchema,
  createArchiveResponseSchema,
  openArchiveRequestSchema,
  openArchiveResponseSchema,
  addSourceRequestSchema,
  dashboardStatsRequestSchema,
  dashboardStatsResponseSchema,
  disableSourceRequestSchema,
  eventsResponseSchema,
  getEventsRequestSchema,
  getHarnessCapabilitiesRequestSchema,
  getHarnessCapabilitiesResponseSchema,
  type CreateArchiveResponse,
  getProjectRequestSchema,
  getProjectResponseSchema,
  getSessionRequestSchema,
  getSessionResponseSchema,
  getSessionByIdRequestSchema,
  getSessionTimelineRequestSchema,
  getRunAuditResponseSchema,
  gitSnapshotRequestSchema,
  gitSnapshotResponseSchema,
  githubSnapshotRequestSchema,
  githubSnapshotResponseSchema,
  listDiagnosticsRequestSchema,
  listDiagnosticsResponseSchema,
  listHarnessesRequestSchema,
  listHarnessesResponseSchema,
  listProjectsRequestSchema,
  listProjectsResponseSchema,
  listSessionsRequestSchema,
  listSessionsResponseSchema,
  outputArtifactLoadResponseSchema,
  outputArtifactPreviewResponseSchema,
  outputArtifactRequestSchema,
  rescanAllSourcesRequestSchema,
  rescanSourceRequestSchema,
  scannerStatusResponseSchema,
  getScannerStatusRequestSchema,
  shellStateViewModelSchema,
  shellCommandsResponseSchema,
  getShellCommandsRequestSchema,
  sessionTimelineResponseSchema,
  sourcesResponseSchema,
  toolCallsResponseSchema,
  getToolCallsRequestSchema,
  updateSourceRequestSchema,
  validateSourceRequestSchema,
  type DashboardStatsResponse,
  type EventsResponse,
  type GetHarnessCapabilitiesResponse,
  type GetProjectResponse,
  type GetSessionResponse,
  type GetRunAuditResponse,
  type GitSnapshotResponse,
  type GitHubSnapshotResponse,
  type ListDiagnosticsResponse,
  type ListHarnessesResponse,
  type ListProjectsResponse,
  type ListSessionsResponse,
  type OpenArchiveResponse,
  type OutputArtifactLoadResponse,
  type OutputArtifactPreviewResponse,
  type SanitizedErrorViewModel,
  type ScannerStatusResponse,
  type SessionTimelineResponse,
  type ShellCommandsResponse,
  type ShellStateViewModel,
  type SourcesResponse,
  type ToolCallsResponse
} from "./view-models.js";

type IpcHandler = (event: unknown, payload?: unknown) => unknown | Promise<unknown>;
type IpcErrorResponse = { ok: false; error: SanitizedErrorViewModel };
type ThemePreference = "system" | "light" | "dark";

export interface IpcMainLike {
  handle(channel: string, listener: IpcHandler): void;
}

export interface IpcServices {
  archiveImportService: ArchiveImportService;
  archiveExportService: ArchiveExportService;
  dataSourcesService: DataSourcesViewModelService;
  diagnosticsService: DiagnosticsViewModelService;
  runAuditService: RunAuditViewModelService;
  sessionService: SessionViewModelService;
  sessionDetailService: SessionDetailViewModelService;
  outputArtifactService: OutputArtifactViewModelService;
  triageService: TriageViewModelService;
  themeService: ThemeService;
}

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  services: IpcServices = createDefaultIpcServices()
): void {
  ipcMain.handle(IPC_CHANNELS.getShellState, async (_event, payload) => {
    const request = z.undefined().safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError();
    }

    return shellStateViewModelSchema.parse(
      services.sessionService.getShellState()
    ) satisfies ShellStateViewModel;
  });

  ipcMain.handle(IPC_CHANNELS.listHarnesses, async (_event, payload) => {
    const request = listHarnessesRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies ListHarnessesResponse;
    }

    return runHarnessesOperation(async () => (await services.dataSourcesService.listDataSources()).adapters);
  });

  ipcMain.handle(IPC_CHANNELS.getHarnessCapabilities, async (_event, payload) => {
    const request = getHarnessCapabilitiesRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetHarnessCapabilitiesResponse;
    }

    return runHarnessCapabilitiesOperation(async () => {
      const harnesses = (await services.dataSourcesService.listDataSources()).adapters;

      return request.data.adapterId
        ? harnesses.filter((harness) => harness.adapterId === request.data.adapterId)
        : harnesses;
    });
  });

  ipcMain.handle(IPC_CHANNELS.listSources, async (_event, payload) => {
    const request = z.undefined().safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() => services.dataSourcesService.listDataSources());
  });

  ipcMain.handle(IPC_CHANNELS.addSource, async (_event, payload) => {
    const request = addSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() => services.dataSourcesService.addDataSource(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.updateSource, async (_event, payload) => {
    const request = updateSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() => services.dataSourcesService.updateDataSource(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.disableSource, async (_event, payload) => {
    const request = disableSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() =>
      services.dataSourcesService.setDataSourceEnabled({
        sourceId: request.data.sourceId,
        enabled: false
      })
    );
  });

  ipcMain.handle(IPC_CHANNELS.validateSource, async (_event, payload) => {
    const request = validateSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() => services.dataSourcesService.validateDataSource(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.rescanSource, async (_event, payload) => {
    const request = rescanSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() => services.dataSourcesService.scanDataSource(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.getScannerStatus, async (_event, payload) => {
    const request = getScannerStatusRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies ScannerStatusResponse;
    }

    return runScannerStatusOperation(() => services.dataSourcesService.listDataSources());
  });

  ipcMain.handle(IPC_CHANNELS.rescanAllSources, async (_event, payload) => {
    const request = rescanAllSourcesRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(async () => {
      const current = await services.dataSourcesService.listDataSources();
      const scanTargets = current.sources.filter(
        (source) => source.enabled && !source.readOnly && source.validationStatus === "Valid"
      );
      let latest = current;

      for (const source of scanTargets) {
        latest = await services.dataSourcesService.scanDataSource({
          sourceId: source.sourceId
        });
      }

      return latest;
    });
  });

  ipcMain.handle(IPC_CHANNELS.rescanScannerSource, async (_event, payload) => {
    const request = rescanSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SourcesResponse;
    }

    return runSourcesOperation(() => services.dataSourcesService.scanDataSource(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.createArchive, async (_event, payload) => {
    const request = createArchiveRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies CreateArchiveResponse;
    }

    try {
      return createArchiveResponseSchema.parse({
        ok: true,
        archive: await services.archiveExportService.createArchive(request.data)
      }) satisfies CreateArchiveResponse;
    } catch {
      return buildArchiveExportFailedError() satisfies CreateArchiveResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.openArchive, async (_event, payload) => {
    const request = openArchiveRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError() satisfies OpenArchiveResponse;
    }

    try {
      return openArchiveResponseSchema.parse({
        ok: true,
        archiveImport: await services.archiveImportService.openArchive(request.data)
      }) satisfies OpenArchiveResponse;
    } catch {
      return buildArchiveImportFailedError() satisfies OpenArchiveResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDashboardStats, async (_event, payload) => {
    const request = dashboardStatsRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError() satisfies DashboardStatsResponse;
    }

    try {
      return dashboardStatsResponseSchema.parse({
        ok: true,
        stats: await services.triageService.getOverview(request.data)
      }) satisfies DashboardStatsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies DashboardStatsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.listProjects, async (_event, payload) => {
    const request = listProjectsRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError() satisfies ListProjectsResponse;
    }

    try {
      return listProjectsResponseSchema.parse({
        ok: true,
        projects: await services.triageService.listProjects(request.data)
      }) satisfies ListProjectsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies ListProjectsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getProject, async (_event, payload) => {
    const request = getProjectRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetProjectResponse;
    }

    try {
      const projects = await services.triageService.listProjects();

      return getProjectResponseSchema.parse({
        ok: true,
        project:
          projects.find((project) => project.projectId === request.data.projectId) ?? null
      }) satisfies GetProjectResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetProjectResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.listSessions, async (_event, payload) => {
    const request = listSessionsRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError();
    }

    try {
      const page = services.sessionService.listSessionsPage
        ? await services.sessionService.listSessionsPage(request.data)
        : paginateItems(
            (await services.sessionService.listSessions()).filter(
              (session) => !request.data.adapterId || session.adapterId === request.data.adapterId
            ),
            request.data
          );

      return listSessionsResponseSchema.parse({
        ok: true,
        sessions: page.sessions,
        pageInfo: page.pageInfo
      }) satisfies ListSessionsResponse;
    } catch (error) {
      if (error instanceof PaginationValidationError) {
        return buildInvalidRequestError() satisfies ListSessionsResponse;
      }

      return buildSessionLoadFailedError() satisfies ListSessionsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSession, async (_event, payload) => {
    const request = getSessionRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetSessionResponse;
    }

    try {
      const session = await services.sessionService.getSessionById(request.data);

      return getSessionResponseSchema.parse({
        ok: true,
        session
      }) satisfies GetSessionResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetSessionResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSessionTimeline, async (_event, payload) => {
    const request = getSessionTimelineRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies SessionTimelineResponse;
    }

    try {
      const page = services.sessionDetailService.getSessionTimeline
        ? await services.sessionDetailService.getSessionTimeline(request.data)
        : paginateNullableItems(
            (await services.sessionDetailService.getSessionDetail(request.data))?.timeline ?? null,
            request.data
          );

      return sessionTimelineResponseSchema.parse({
        ok: true,
        timeline: page.timeline,
        pageInfo: page.pageInfo
      }) satisfies SessionTimelineResponse;
    } catch (error) {
      if (error instanceof PaginationValidationError) {
        return buildInvalidRequestError() satisfies SessionTimelineResponse;
      }

      return buildSessionLoadFailedError() satisfies SessionTimelineResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getEvents, async (_event, payload) => {
    const request = getEventsRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies EventsResponse;
    }

    try {
      const detail = await services.sessionDetailService.getSessionDetail(request.data);

      return eventsResponseSchema.parse({
        ok: true,
        events: detail?.timeline ?? null
      }) satisfies EventsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies EventsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getToolCalls, async (_event, payload) => {
    const request = getToolCallsRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies ToolCallsResponse;
    }

    try {
      const detail = await services.sessionDetailService.getSessionDetail(request.data);

      return toolCallsResponseSchema.parse({
        ok: true,
        toolCalls: detail?.timeline.filter((event) => event.kind === "tool-call") ?? null
      }) satisfies ToolCallsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies ToolCallsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getShellCommands, async (_event, payload) => {
    const request = getShellCommandsRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies ShellCommandsResponse;
    }

    try {
      const detail = await services.sessionDetailService.getSessionDetail(request.data);

      return shellCommandsResponseSchema.parse({
        ok: true,
        shellCommands: detail?.timeline.filter((event) => event.kind === "shell-command") ?? null
      }) satisfies ShellCommandsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies ShellCommandsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getOutputArtifactPreview, async (_event, payload) => {
    const request = outputArtifactRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies OutputArtifactPreviewResponse;
    }

    try {
      return outputArtifactPreviewResponseSchema.parse({
        ok: true,
        preview: await services.outputArtifactService.getPreview(request.data)
      }) satisfies OutputArtifactPreviewResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies OutputArtifactPreviewResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.loadOutputArtifact, async (_event, payload) => {
    const request = outputArtifactRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies OutputArtifactLoadResponse;
    }

    try {
      return outputArtifactLoadResponseSchema.parse({
        ok: true,
        artifact: await services.outputArtifactService.loadArtifact(request.data)
      }) satisfies OutputArtifactLoadResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies OutputArtifactLoadResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getAuditRunAudit, async (_event, payload) => {
    const request = getSessionByIdRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetRunAuditResponse;
    }

    try {
      return getRunAuditResponseSchema.parse({
        ok: true,
        runAudit: await services.runAuditService.getRunAudit(request.data)
      }) satisfies GetRunAuditResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetRunAuditResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getGitSnapshot, async (_event, payload) => {
    const request = gitSnapshotRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GitSnapshotResponse;
    }

    try {
      const project = (await services.triageService.listProjects()).find(
        (candidate) => candidate.projectId === request.data.projectId
      );

      return gitSnapshotResponseSchema.parse({
        ok: true,
        snapshot: project
          ? {
              projectId: project.projectId,
              validatedRepoRoot: project.validatedRepoRoot,
              remoteUrl: project.remoteUrl,
              status: project.gitStatus,
              branch: project.branch,
              head: project.head,
              dirtyState: project.dirtyState,
              changedFiles: project.changedFiles,
              untrackedFiles: project.untrackedFiles,
              additions: project.additions,
              deletions: project.deletions
            }
          : null
      }) satisfies GitSnapshotResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GitSnapshotResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getGitHubSnapshot, async (_event, payload) => {
    const request = githubSnapshotRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GitHubSnapshotResponse;
    }

    try {
      const project = (await services.triageService.listProjects()).find(
        (candidate) => candidate.projectId === request.data.projectId
      );

      return githubSnapshotResponseSchema.parse({
        ok: true,
        snapshot: project
          ? {
              projectId: project.projectId,
              remoteUrl: project.remoteUrl,
              status: project.githubStatus,
              pullRequest: project.pullRequest,
              checks: project.checks,
              reviewStatus: project.reviewStatus
            }
          : null
      }) satisfies GitHubSnapshotResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GitHubSnapshotResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.listDiagnostics, async (_event, payload) => {
    const request = listDiagnosticsRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError() satisfies ListDiagnosticsResponse;
    }

    try {
      return listDiagnosticsResponseSchema.parse({
        ok: true,
        diagnostics: await services.diagnosticsService.listDiagnostics(request.data)
      }) satisfies ListDiagnosticsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies ListDiagnosticsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getThemeState, (_event, payload) => {
    const request = z.undefined().safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError();
    }

    return services.themeService.getThemeState();
  });

  ipcMain.handle(IPC_CHANNELS.setThemePreference, async (_event, payload) => {
    const request = z.enum(["system", "light", "dark"]).safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError();
    }

    await services.themeService.setThemePreference(request.data satisfies ThemePreference);
  });
}

function createDefaultIpcServices(): IpcServices {
  const runtime = createWorkbenchRuntime();

  return {
    archiveImportService: createArchiveImportService({ runtime }),
    archiveExportService: createArchiveExportService({ runtime }),
    sessionService: createSessionViewModelService({ runtime }),
    sessionDetailService: createSessionDetailViewModelService({ runtime }),
    outputArtifactService: createOutputArtifactViewModelService({ runtime }),
    runAuditService: createRunAuditViewModelService({ runtime }),
    triageService: createTriageViewModelService({ runtime }),
    diagnosticsService: createDiagnosticsViewModelService({ runtime }),
    dataSourcesService: createDataSourcesViewModelService({ runtime }),
    themeService: createThemeService({
      nativeTheme: {
        themeSource: "system",
        shouldUseDarkColors: false,
        shouldUseHighContrastColors: false,
        on() {},
        removeListener() {}
      },
      loadPreference: () => "system",
      savePreference() {}
    })
  };
}

async function runSourcesOperation(
  operation: () => Promise<Awaited<ReturnType<DataSourcesViewModelService["listDataSources"]>>>
): Promise<SourcesResponse> {
  try {
    return sourcesResponseSchema.parse({
      ok: true,
      sources: await operation()
    }) satisfies SourcesResponse;
  } catch {
    return buildDataSourcesLoadFailedError() satisfies SourcesResponse;
  }
}

async function runHarnessesOperation(
  operation: () => Promise<Awaited<ReturnType<DataSourcesViewModelService["listDataSources"]>>["adapters"]>
): Promise<ListHarnessesResponse> {
  try {
    return listHarnessesResponseSchema.parse({
      ok: true,
      harnesses: await operation()
    }) satisfies ListHarnessesResponse;
  } catch {
    return buildDataSourcesLoadFailedError() satisfies ListHarnessesResponse;
  }
}

async function runHarnessCapabilitiesOperation(
  operation: () => Promise<Awaited<ReturnType<DataSourcesViewModelService["listDataSources"]>>["adapters"]>
): Promise<GetHarnessCapabilitiesResponse> {
  try {
    return getHarnessCapabilitiesResponseSchema.parse({
      ok: true,
      harnesses: await operation()
    }) satisfies GetHarnessCapabilitiesResponse;
  } catch {
    return buildDataSourcesLoadFailedError() satisfies GetHarnessCapabilitiesResponse;
  }
}

async function runScannerStatusOperation(
  operation: () => Promise<Awaited<ReturnType<DataSourcesViewModelService["listDataSources"]>>>
): Promise<ScannerStatusResponse> {
  try {
    const dataSources = await operation();
    const activeScans = dataSources.sources.filter(
      (source) => source.scanStatus === "Scanning"
    ).length;

    return scannerStatusResponseSchema.parse({
      ok: true,
      scanner: {
        status: activeScans > 0 ? "scanning" : "idle",
        totalSources: dataSources.sources.length,
        enabledSources: dataSources.sources.filter((source) => source.enabled).length,
        activeScans,
        staleSources: dataSources.sources.filter(
          (source) => source.scanStatus === "Stale" || source.cacheStatus === "Stale"
        ).length
      }
    }) satisfies ScannerStatusResponse;
  } catch {
    return buildDataSourcesLoadFailedError() satisfies ScannerStatusResponse;
  }
}

function buildInvalidRequestError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "invalid-request",
      message: "Request payload is not valid for this operation."
    }
  };
}

function buildArchiveImportFailedError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "archive-import-failed",
      message:
        "Archive import could not complete. Check that the archive is readable and matches the supported harness-neutral format."
    }
  };
}

function buildSessionLoadFailedError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "session-load-failed",
      message: "Session data could not be loaded."
    }
  };
}

function buildDataSourcesLoadFailedError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "data-sources-load-failed",
      message: "Data sources could not be loaded."
    }
  };
}

function buildArchiveExportFailedError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "archive-export-failed",
      message:
        "Archive export could not complete. Check the archive destination, current source data, and privacy options, then try the export again."
    }
  };
}

function paginateItems<T>(
  items: T[],
  request: { cursor?: string | undefined; limit?: number | undefined }
): {
  pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
  sessions: T[];
} {
  const offset = Number.parseInt(request.cursor ?? "0", 10);
  const limit = request.limit ?? 50;
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    sessions: page,
    pageInfo: {
      hasMore: nextOffset < items.length,
      ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
      totalCount: items.length
    }
  };
}

function paginateNullableItems<T>(
  items: T[] | null,
  request: { cursor?: string | undefined; limit?: number | undefined }
): {
  pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
  timeline: T[] | null;
} {
  if (!items) {
    return {
      timeline: null,
      pageInfo: {
        hasMore: false,
        totalCount: 0
      }
    };
  }

  const page = paginateItems(items, {
    ...(request.cursor ? { cursor: request.cursor } : {}),
    limit: request.limit ?? 100
  });

  return {
    timeline: page.sessions,
    pageInfo: page.pageInfo
  };
}
