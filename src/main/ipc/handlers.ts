import { z } from "zod";

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
import { IPC_CHANNELS } from "./channels.js";
import {
  addDataSourceRequestSchema,
  dataSourcesResponseSchema,
  getOverviewRequestSchema,
  getOverviewResponseSchema,
  getSessionByIdRequestSchema,
  getSessionByIdResponseSchema,
  getSessionDetailResponseSchema,
  getRunAuditResponseSchema,
  listDiagnosticsRequestSchema,
  listDiagnosticsResponseSchema,
  listProjectsRequestSchema,
  listProjectsResponseSchema,
  listSessionsRequestSchema,
  listSessionsResponseSchema,
  setDataSourceEnabledRequestSchema,
  shellStateViewModelSchema,
  updateDataSourceRequestSchema,
  validateDataSourceRequestSchema,
  scanDataSourceRequestSchema,
  type DataSourcesResponse,
  type GetOverviewResponse,
  type GetSessionByIdResponse,
  type GetSessionDetailResponse,
  type GetRunAuditResponse,
  type ListDiagnosticsResponse,
  type ListProjectsResponse,
  type ListSessionsResponse,
  type SanitizedErrorViewModel,
  type ShellStateViewModel
} from "./view-models.js";

type IpcHandler = (event: unknown, payload?: unknown) => unknown | Promise<unknown>;
type IpcErrorResponse = { ok: false; error: SanitizedErrorViewModel };

export interface IpcMainLike {
  handle(channel: string, listener: IpcHandler): void;
}

export interface IpcServices {
  dataSourcesService: DataSourcesViewModelService;
  diagnosticsService: DiagnosticsViewModelService;
  runAuditService: RunAuditViewModelService;
  sessionService: SessionViewModelService;
  sessionDetailService: SessionDetailViewModelService;
  triageService: TriageViewModelService;
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

  ipcMain.handle(IPC_CHANNELS.getOverview, async (_event, payload) => {
    const request = getOverviewRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetOverviewResponse;
    }

    try {
      return getOverviewResponseSchema.parse({
        ok: true,
        overview: await services.triageService.getOverview(request.data)
      }) satisfies GetOverviewResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetOverviewResponse;
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

  ipcMain.handle(IPC_CHANNELS.listSessions, async (_event, payload) => {
    const request = listSessionsRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError();
    }

    try {
      const sessions = (await services.sessionService.listSessions()).filter(
        (session) => !request.data.adapterId || session.adapterId === request.data.adapterId
      );

      return listSessionsResponseSchema.parse({
        ok: true,
        sessions
      }) satisfies ListSessionsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies ListSessionsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSessionById, async (_event, payload) => {
    const request = getSessionByIdRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetSessionByIdResponse;
    }

    try {
      const session = await services.sessionService.getSessionById(request.data);

      return getSessionByIdResponseSchema.parse({
        ok: true,
        session
      }) satisfies GetSessionByIdResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetSessionByIdResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSessionDetail, async (_event, payload) => {
    const request = getSessionByIdRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetSessionDetailResponse;
    }

    try {
      return getSessionDetailResponseSchema.parse({
        ok: true,
        detail: await services.sessionDetailService.getSessionDetail(request.data)
      }) satisfies GetSessionDetailResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetSessionDetailResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getRunAudit, async (_event, payload) => {
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

  ipcMain.handle(IPC_CHANNELS.listDataSources, async (_event, payload) => {
    const request = z.undefined().safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies DataSourcesResponse;
    }

    return runDataSourcesOperation(() => services.dataSourcesService.listDataSources());
  });

  ipcMain.handle(IPC_CHANNELS.addDataSource, async (_event, payload) => {
    const request = addDataSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies DataSourcesResponse;
    }

    return runDataSourcesOperation(() => services.dataSourcesService.addDataSource(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.updateDataSource, async (_event, payload) => {
    const request = updateDataSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies DataSourcesResponse;
    }

    return runDataSourcesOperation(() =>
      services.dataSourcesService.updateDataSource(request.data)
    );
  });

  ipcMain.handle(IPC_CHANNELS.setDataSourceEnabled, async (_event, payload) => {
    const request = setDataSourceEnabledRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies DataSourcesResponse;
    }

    return runDataSourcesOperation(() =>
      services.dataSourcesService.setDataSourceEnabled(request.data)
    );
  });

  ipcMain.handle(IPC_CHANNELS.validateDataSource, async (_event, payload) => {
    const request = validateDataSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies DataSourcesResponse;
    }

    return runDataSourcesOperation(() =>
      services.dataSourcesService.validateDataSource(request.data)
    );
  });

  ipcMain.handle(IPC_CHANNELS.scanDataSource, async (_event, payload) => {
    const request = scanDataSourceRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies DataSourcesResponse;
    }

    return runDataSourcesOperation(() => services.dataSourcesService.scanDataSource(request.data));
  });
}

function createDefaultIpcServices(): IpcServices {
  const runtime = createWorkbenchRuntime();

  return {
    sessionService: createSessionViewModelService({ runtime }),
    sessionDetailService: createSessionDetailViewModelService({ runtime }),
    runAuditService: createRunAuditViewModelService({ runtime }),
    triageService: createTriageViewModelService({ runtime }),
    diagnosticsService: createDiagnosticsViewModelService({ runtime }),
    dataSourcesService: createDataSourcesViewModelService({ runtime })
  };
}

async function runDataSourcesOperation(
  operation: () => Promise<Awaited<ReturnType<DataSourcesViewModelService["listDataSources"]>>>
): Promise<DataSourcesResponse> {
  try {
    return dataSourcesResponseSchema.parse({
      ok: true,
      dataSources: await operation()
    }) satisfies DataSourcesResponse;
  } catch {
    return buildDataSourcesLoadFailedError() satisfies DataSourcesResponse;
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
