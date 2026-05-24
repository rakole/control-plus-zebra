import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../main/ipc/channels.js";
import type {
  AddDataSourceRequest,
  CreateArchiveRequest,
  GetOverviewRequest,
  GetSessionByIdRequest,
  ListDiagnosticsRequest,
  ListProjectsRequest,
  ListSessionsRequest,
  OpenArchiveRequest,
  ScanDataSourceRequest,
  SetDataSourceEnabledRequest,
  UpdateDataSourceRequest,
  ValidateDataSourceRequest
} from "../main/ipc/view-models.js";
import type { AgentWorkbenchBridge } from "./types.js";
import { agentWorkbenchTheme } from "./theme-bridge.js";

const agentWorkbench: AgentWorkbenchBridge = Object.freeze({
  getShellState() {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellState);
  },
  createArchive(request: CreateArchiveRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.createArchive, request);
  },
  openArchive(request: OpenArchiveRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.openArchive, request);
  },
  getOverview(request: GetOverviewRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.getOverview, request);
  },
  listProjects(request: ListProjectsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listProjects, request);
  },
  listSessions(request: ListSessionsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listSessions, request);
  },
  getSessionById(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSessionById, request);
  },
  getSessionDetail(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSessionDetail, request);
  },
  getRunAudit(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getRunAudit, request);
  },
  listDiagnostics(request: ListDiagnosticsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listDiagnostics, request);
  },
  listDataSources() {
    return ipcRenderer.invoke(IPC_CHANNELS.listDataSources);
  },
  addDataSource(request: AddDataSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.addDataSource, request);
  },
  updateDataSource(request: UpdateDataSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDataSource, request);
  },
  setDataSourceEnabled(request: SetDataSourceEnabledRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.setDataSourceEnabled, request);
  },
  validateDataSource(request: ValidateDataSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.validateDataSource, request);
  },
  scanDataSource(request: ScanDataSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.scanDataSource, request);
  }
});

contextBridge.exposeInMainWorld("agentWorkbench", agentWorkbench);
contextBridge.exposeInMainWorld("agentWorkbenchTheme", agentWorkbenchTheme);
