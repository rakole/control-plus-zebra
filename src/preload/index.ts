import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../main/ipc/channels.js";
import type {
  AddDataSourceRequest,
  GetSessionByIdRequest,
  ListSessionsRequest,
  ScanDataSourceRequest,
  SetDataSourceEnabledRequest,
  UpdateDataSourceRequest,
  ValidateDataSourceRequest
} from "../main/ipc/view-models.js";
import type { AgentWorkbenchBridge } from "./types.js";

const agentWorkbench: AgentWorkbenchBridge = Object.freeze({
  getShellState() {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellState);
  },
  listSessions(request: ListSessionsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listSessions, request);
  },
  getSessionById(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSessionById, request);
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
