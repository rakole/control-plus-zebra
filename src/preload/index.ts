import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../main/ipc/channels.js";
import type {
  AddSourceRequest,
  CreateArchiveRequest,
  DashboardStatsRequest,
  DisableSourceRequest,
  GetEventsRequest,
  GetHarnessCapabilitiesRequest,
  GetOverviewActivityHeatmapRequest,
  GetProjectRequest,
  GetSessionRequest,
  GetSessionTimelineRequest,
  GetSessionByIdRequest,
  GetShellCommandsRequest,
  GetToolCallsRequest,
  ListDiagnosticsRequest,
  ListProjectsRequest,
  ListSessionsRequest,
  OpenArchiveRequest,
  OutputArtifactRequest,
  RescanSourceRequest,
  RetentionJobStatusViewModel,
  SourceDataChangedEvent,
  UpdateSettingsRequest,
  UpdateSourceRequest,
  ValidateSourceRequest
} from "../main/ipc/view-models.js";
import { retentionJobStatusViewModelSchema, sourceDataChangedEventSchema } from "../main/ipc/view-models.js";
import type { AgentWorkbenchBridge } from "./types.js";
import { agentWorkbenchTheme } from "./theme-bridge.js";

const agentWorkbench: AgentWorkbenchBridge = Object.freeze({
  getShellState() {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellState);
  },
  listHarnesses() {
    return ipcRenderer.invoke(IPC_CHANNELS.listHarnesses);
  },
  getHarnessCapabilities(request: GetHarnessCapabilitiesRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.getHarnessCapabilities, request);
  },
  listSources() {
    return ipcRenderer.invoke(IPC_CHANNELS.listSources);
  },
  addSource(request: AddSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.addSource, request);
  },
  updateSource(request: UpdateSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.updateSource, request);
  },
  disableSource(request: DisableSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.disableSource, request);
  },
  validateSource(request: ValidateSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.validateSource, request);
  },
  rescanSource(request: RescanSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.rescanSource, request);
  },
  getScannerStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.getScannerStatus);
  },
  rescanAllSources() {
    return ipcRenderer.invoke(IPC_CHANNELS.rescanAllSources);
  },
  rescanScannerSource(request: RescanSourceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.rescanScannerSource, request);
  },
  createArchive(request: CreateArchiveRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.createArchive, request);
  },
  openArchive(request: OpenArchiveRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.openArchive, request);
  },
  getDashboardStats(request: DashboardStatsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.getDashboardStats, request);
  },
  getOverviewActivityHeatmap(request: GetOverviewActivityHeatmapRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.getOverviewActivityHeatmap, request);
  },
  listProjects(request: ListProjectsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listProjects, request);
  },
  getProject(request: GetProjectRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getProject, request);
  },
  listSessions(request: ListSessionsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listSessions, request);
  },
  getSession(request: GetSessionRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSession, request);
  },
  getSessionTimeline(request: GetSessionTimelineRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSessionTimeline, request);
  },
  getEvents(request: GetEventsRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getEvents, request);
  },
  getToolCalls(request: GetToolCallsRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getToolCalls, request);
  },
  getShellCommands(request: GetShellCommandsRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellCommands, request);
  },
  getOutputArtifactPreview(request: OutputArtifactRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getOutputArtifactPreview, request);
  },
  loadOutputArtifact(request: OutputArtifactRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.loadOutputArtifact, request);
  },
  getRunAudit(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getAuditRunAudit, request);
  },
  getGitSnapshot(request: GetProjectRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getGitSnapshot, request);
  },
  getGitHubSnapshot(request: GetProjectRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getGitHubSnapshot, request);
  },
  listDiagnostics(request: ListDiagnosticsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listDiagnostics, request);
  },
  getSettings() {
    return ipcRenderer.invoke(IPC_CHANNELS.getSettings);
  },
  updateSettings(request: UpdateSettingsRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.updateSettings, request);
  },
  getRetentionJobStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.getRetentionJobStatus);
  },
  onRetentionJobChanged(callback: (status: RetentionJobStatusViewModel) => void) {
    const listener = (_event: Electron.IpcRendererEvent, status: RetentionJobStatusViewModel) => {
      const parsed = retentionJobStatusViewModelSchema.safeParse(status);

      if (parsed.success) {
        callback(parsed.data);
      }
    };

    ipcRenderer.on(IPC_CHANNELS.retentionJobChanged, listener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.retentionJobChanged, listener);
    };
  },
  onSourceDataChanged(callback: (event: SourceDataChangedEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, event: SourceDataChangedEvent) => {
      const parsed = sourceDataChangedEventSchema.safeParse(event);

      if (parsed.success) {
        callback(parsed.data);
      }
    };

    ipcRenderer.on(IPC_CHANNELS.sourceDataChanged, listener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sourceDataChanged, listener);
    };
  }
});

contextBridge.exposeInMainWorld("agentWorkbench", agentWorkbench);
contextBridge.exposeInMainWorld("agentWorkbenchTheme", agentWorkbenchTheme);
