import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../main/ipc/channels.js";
import type { GetSessionByIdRequest, ListSessionsRequest } from "../main/ipc/view-models.js";
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
  }
});

contextBridge.exposeInMainWorld("agentWorkbench", agentWorkbench);
