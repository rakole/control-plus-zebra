import type {
  AddDataSourceRequest,
  CreateArchiveRequest,
  CreateArchiveResponse,
  DataSourcesResponse,
  GetOverviewRequest,
  GetOverviewResponse,
  GetSessionByIdRequest,
  GetSessionDetailResponse,
  GetSessionByIdResponse,
  GetRunAuditResponse,
  ListDiagnosticsRequest,
  ListDiagnosticsResponse,
  ListProjectsRequest,
  ListProjectsResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  OpenArchiveRequest,
  OpenArchiveResponse,
  ScanDataSourceRequest,
  SetDataSourceEnabledRequest,
  ShellStateViewModel,
  UpdateDataSourceRequest,
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
  createArchive(request: CreateArchiveRequest): Promise<CreateArchiveResponse>;
  openArchive(request?: OpenArchiveRequest): Promise<OpenArchiveResponse>;
  getOverview(request?: GetOverviewRequest): Promise<GetOverviewResponse>;
  listProjects(request?: ListProjectsRequest): Promise<ListProjectsResponse>;
  listSessions(request?: ListSessionsRequest): Promise<ListSessionsResponse>;
  getSessionById(request: GetSessionByIdRequest): Promise<GetSessionByIdResponse>;
  getSessionDetail(request: GetSessionByIdRequest): Promise<GetSessionDetailResponse>;
  getRunAudit(request: GetSessionByIdRequest): Promise<GetRunAuditResponse>;
  listDiagnostics(request?: ListDiagnosticsRequest): Promise<ListDiagnosticsResponse>;
  listDataSources(): Promise<DataSourcesResponse>;
  addDataSource(request: AddDataSourceRequest): Promise<DataSourcesResponse>;
  updateDataSource(request: UpdateDataSourceRequest): Promise<DataSourcesResponse>;
  setDataSourceEnabled(request: SetDataSourceEnabledRequest): Promise<DataSourcesResponse>;
  validateDataSource(request: ValidateDataSourceRequest): Promise<DataSourcesResponse>;
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
