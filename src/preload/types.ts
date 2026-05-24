import type {
  AddDataSourceRequest,
  AddSourceRequest,
  CreateArchiveRequest,
  CreateArchiveResponse,
  DashboardStatsRequest,
  DashboardStatsResponse,
  DataSourcesResponse,
  DisableSourceRequest,
  EventsResponse,
  GetEventsRequest,
  GitHubSnapshotRequest,
  GitHubSnapshotResponse,
  GitSnapshotRequest,
  GitSnapshotResponse,
  GetHarnessCapabilitiesRequest,
  GetHarnessCapabilitiesResponse,
  GetOverviewRequest,
  GetOverviewResponse,
  GetProjectRequest,
  GetProjectResponse,
  GetSessionRequest,
  GetSessionResponse,
  GetSessionTimelineRequest,
  GetSessionByIdRequest,
  GetSessionDetailResponse,
  GetSessionByIdResponse,
  GetRunAuditResponse,
  ListDiagnosticsRequest,
  ListDiagnosticsResponse,
  ListHarnessesResponse,
  ListProjectsRequest,
  ListProjectsResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  OpenArchiveRequest,
  OpenArchiveResponse,
  OutputArtifactPreviewResponse,
  OutputArtifactRequest,
  OutputArtifactLoadResponse,
  RescanSourceRequest,
  ScanDataSourceRequest,
  ScannerStatusResponse,
  SetDataSourceEnabledRequest,
  ShellStateViewModel,
  ShellCommandsResponse,
  SessionTimelineResponse,
  SourcesResponse,
  ToolCallsResponse,
  UpdateSourceRequest,
  UpdateDataSourceRequest,
  ValidateSourceRequest,
  ValidateDataSourceRequest
} from "../main/ipc/view-models.js";

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export interface ThemeState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
}

export interface AgentWorkbenchBridge {
  getShellState(): Promise<ShellStateViewModel>;
  listHarnesses(): Promise<ListHarnessesResponse>;
  getHarnessCapabilities(
    request?: GetHarnessCapabilitiesRequest
  ): Promise<GetHarnessCapabilitiesResponse>;
  listSources(): Promise<SourcesResponse>;
  addSource(request: AddSourceRequest): Promise<SourcesResponse>;
  updateSource(request: UpdateSourceRequest): Promise<SourcesResponse>;
  disableSource(request: DisableSourceRequest): Promise<SourcesResponse>;
  validateSource(request: ValidateSourceRequest): Promise<SourcesResponse>;
  rescanSource(request: RescanSourceRequest): Promise<SourcesResponse>;
  getScannerStatus(): Promise<ScannerStatusResponse>;
  rescanAllSources(): Promise<SourcesResponse>;
  rescanScannerSource(request: RescanSourceRequest): Promise<SourcesResponse>;
  createArchive(request: CreateArchiveRequest): Promise<CreateArchiveResponse>;
  openArchive(request?: OpenArchiveRequest): Promise<OpenArchiveResponse>;
  getDashboardStats(request?: DashboardStatsRequest): Promise<DashboardStatsResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `getDashboardStats`.
   */
  getOverview(request?: GetOverviewRequest): Promise<GetOverviewResponse>;
  listProjects(request?: ListProjectsRequest): Promise<ListProjectsResponse>;
  getProject(request: GetProjectRequest): Promise<GetProjectResponse>;
  listSessions(request?: ListSessionsRequest): Promise<ListSessionsResponse>;
  getSession(request: GetSessionRequest): Promise<GetSessionResponse>;
  getSessionTimeline(request: GetSessionTimelineRequest): Promise<SessionTimelineResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `getSession`.
   */
  getSessionById(request: GetSessionByIdRequest): Promise<GetSessionByIdResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `getSession` plus `getSessionTimeline`.
   */
  getSessionDetail(request: GetSessionByIdRequest): Promise<GetSessionDetailResponse>;
  getEvents(request: GetEventsRequest): Promise<EventsResponse>;
  getToolCalls(request: GetSessionTimelineRequest): Promise<ToolCallsResponse>;
  getShellCommands(request: GetSessionTimelineRequest): Promise<ShellCommandsResponse>;
  getOutputArtifactPreview(
    request: OutputArtifactRequest
  ): Promise<OutputArtifactPreviewResponse>;
  loadOutputArtifact(request: OutputArtifactRequest): Promise<OutputArtifactLoadResponse>;
  getRunAudit(request: GetSessionByIdRequest): Promise<GetRunAuditResponse>;
  getGitSnapshot(request: GitSnapshotRequest): Promise<GitSnapshotResponse>;
  getGitHubSnapshot(request: GitHubSnapshotRequest): Promise<GitHubSnapshotResponse>;
  listDiagnostics(request?: ListDiagnosticsRequest): Promise<ListDiagnosticsResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `listSources`.
   */
  listDataSources(): Promise<DataSourcesResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `addSource`.
   */
  addDataSource(request: AddDataSourceRequest): Promise<DataSourcesResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `updateSource`.
   */
  updateDataSource(request: UpdateDataSourceRequest): Promise<DataSourcesResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `disableSource` or a future explicit enable operation.
   */
  setDataSourceEnabled(request: SetDataSourceEnabledRequest): Promise<DataSourcesResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `validateSource`.
   */
  validateDataSource(request: ValidateDataSourceRequest): Promise<DataSourcesResponse>;
  /**
   * @deprecated TODO(Wave 5): Remove once renderer bridge callers migrate to
   * `rescanSource`.
   */
  scanDataSource(request: ScanDataSourceRequest): Promise<DataSourcesResponse>;
}

export interface AgentWorkbenchThemeBridge {
  getThemeState(): Promise<ThemeState>;
  setThemePreference(preference: ThemePreference): Promise<void>;
  onThemeStateChanged(callback: (state: ThemeState) => void): () => void;
}

declare global {
  interface Window {
    agentWorkbench: AgentWorkbenchBridge;
    agentWorkbenchTheme: AgentWorkbenchThemeBridge;
  }
}
