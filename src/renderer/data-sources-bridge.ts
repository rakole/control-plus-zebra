export type SourceTruthLabel = "Supported" | "Unsupported" | "Unknown";
export type DataSourceEnabledLabel = "Enabled" | "Disabled";
export type DataSourceValidationLabel = "Valid" | "Invalid" | "Not Validated" | "Unknown";
export type DataSourceScanLabel =
  | "Never Scanned"
  | "Scanning"
  | "Scan Failed"
  | "Scanned"
  | "Scanned with Diagnostics"
  | "Unsupported"
  | "Unknown";
export type DataSourceCacheLabel = "Cached" | "Stale" | "Unsupported" | "Unknown";
export type DataSourceWatchLabel = "Watch Supported" | "Watch Unsupported" | "Watch Unknown";
export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DataSourceDiagnosticViewModel {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
}

export interface DataSourceStatusViewModel<TLabel extends string> {
  label: TLabel;
  detail?: string;
}

export interface DataSourceAdapterOption {
  adapterId: string;
  displayName: string;
  sourceRootHint?: string | undefined;
  watchSupport?: DataSourceStatusViewModel<DataSourceWatchLabel> | undefined;
  scanSupport?: DataSourceStatusViewModel<SourceTruthLabel> | undefined;
}

export interface DataSourceViewModel {
  sourceId: string;
  adapterId: string;
  adapterDisplayName: string;
  sourceName?: string | undefined;
  rootPath: string;
  enabled: boolean;
  enabledLabel: DataSourceEnabledLabel;
  validation: DataSourceStatusViewModel<DataSourceValidationLabel>;
  scan: DataSourceStatusViewModel<DataSourceScanLabel>;
  cache: DataSourceStatusViewModel<DataSourceCacheLabel>;
  watch: DataSourceStatusViewModel<DataSourceWatchLabel>;
  diagnosticCount: number;
  diagnostics: DataSourceDiagnosticViewModel[];
  hasCompletedScan?: boolean | undefined;
}

export interface SanitizedErrorViewModel {
  code: string;
  message: string;
}

export interface ListDataSourcesRequest {
  adapterId?: string;
}

export type ListDataSourcesResponse =
  | {
      ok: true;
      adapters: DataSourceAdapterOption[];
      sources: DataSourceViewModel[];
    }
  | {
      ok: false;
      error: SanitizedErrorViewModel;
    };

export interface CreateDataSourceRequest {
  adapterId: string;
  displayName?: string | undefined;
  rootPath: string;
  enabled: boolean;
}

export interface UpdateDataSourceRequest {
  sourceId: string;
  adapterId: string;
  displayName?: string | undefined;
  rootPath: string;
  enabled: boolean;
}

export interface DataSourceActionRequest {
  sourceId: string;
}

export type DataSourceMutationResponse =
  | {
      ok: true;
      source: DataSourceViewModel;
    }
  | {
      ok: false;
      error: SanitizedErrorViewModel;
    };

type AgentWorkbenchDataSourcesBridge = Window["agentWorkbench"] & {
  listDataSources?: (request?: ListDataSourcesRequest) => Promise<ListDataSourcesResponse>;
  getDataSources?: (request?: ListDataSourcesRequest) => Promise<ListDataSourcesResponse>;
  createDataSource?: (request: CreateDataSourceRequest) => Promise<DataSourceMutationResponse>;
  addDataSource?: (request: CreateDataSourceRequest) => Promise<DataSourceMutationResponse>;
  updateDataSource?: (request: UpdateDataSourceRequest) => Promise<DataSourceMutationResponse>;
  saveDataSource?: (request: UpdateDataSourceRequest) => Promise<DataSourceMutationResponse>;
  validateDataSource?: (request: DataSourceActionRequest) => Promise<DataSourceMutationResponse>;
  validateSource?: (request: DataSourceActionRequest) => Promise<DataSourceMutationResponse>;
  scanDataSource?: (request: DataSourceActionRequest) => Promise<DataSourceMutationResponse>;
  runDataSourceScan?: (request: DataSourceActionRequest) => Promise<DataSourceMutationResponse>;
};

type SourceMethod<TMethod> = TMethod | undefined;

function getBridge(): AgentWorkbenchDataSourcesBridge {
  return window.agentWorkbench as AgentWorkbenchDataSourcesBridge;
}

function requireMethod<TMethod>(
  ...candidates: Array<SourceMethod<TMethod>>
): Exclude<TMethod, undefined> {
  for (const candidate of candidates) {
    if (candidate) {
      return candidate as Exclude<TMethod, undefined>;
    }
  }

  throw new Error("Required Data Sources bridge method is unavailable.");
}

export function listDataSources(
  request: ListDataSourcesRequest = {}
): Promise<ListDataSourcesResponse> {
  const bridge = getBridge();
  const method = requireMethod(bridge.listDataSources, bridge.getDataSources);

  return method(request);
}

export function createDataSource(
  request: CreateDataSourceRequest
): Promise<DataSourceMutationResponse> {
  const bridge = getBridge();
  const method = requireMethod(bridge.createDataSource, bridge.addDataSource);

  return method(request);
}

export function updateDataSource(
  request: UpdateDataSourceRequest
): Promise<DataSourceMutationResponse> {
  const bridge = getBridge();
  const method = requireMethod(bridge.updateDataSource, bridge.saveDataSource);

  return method(request);
}

export function validateDataSource(
  request: DataSourceActionRequest
): Promise<DataSourceMutationResponse> {
  const bridge = getBridge();
  const method = requireMethod(bridge.validateDataSource, bridge.validateSource);

  return method(request);
}

export function scanDataSource(
  request: DataSourceActionRequest
): Promise<DataSourceMutationResponse> {
  const bridge = getBridge();
  const method = requireMethod(bridge.scanDataSource, bridge.runDataSourceScan);

  return method(request);
}
