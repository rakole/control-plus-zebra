import type {
  AddDataSourceRequest,
  DataSourcesResponse,
  GetSessionByIdRequest,
  GetSessionByIdResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ScanDataSourceRequest,
  SetDataSourceEnabledRequest,
  ShellStateViewModel,
  UpdateDataSourceRequest,
  ValidateDataSourceRequest
} from "../main/ipc/view-models.js";

export interface AgentWorkbenchBridge {
  getShellState(): Promise<ShellStateViewModel>;
  listSessions(request?: ListSessionsRequest): Promise<ListSessionsResponse>;
  getSessionById(request: GetSessionByIdRequest): Promise<GetSessionByIdResponse>;
  listDataSources(): Promise<DataSourcesResponse>;
  addDataSource(request: AddDataSourceRequest): Promise<DataSourcesResponse>;
  updateDataSource(request: UpdateDataSourceRequest): Promise<DataSourcesResponse>;
  setDataSourceEnabled(request: SetDataSourceEnabledRequest): Promise<DataSourcesResponse>;
  validateDataSource(request: ValidateDataSourceRequest): Promise<DataSourcesResponse>;
  scanDataSource(request: ScanDataSourceRequest): Promise<DataSourcesResponse>;
}

declare global {
  interface Window {
    agentWorkbench: AgentWorkbenchBridge;
  }
}
