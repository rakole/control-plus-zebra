type AgentWorkbenchBridge = Window["agentWorkbench"];
type NativeListDataSourcesResponse = Awaited<
  ReturnType<AgentWorkbenchBridge["listDataSources"]>
>;
type NativeDataSourcesResponse = Extract<NativeListDataSourcesResponse, { ok: true }>;
type NativeDataSourcesViewModel = NativeDataSourcesResponse["dataSources"];
type NativeDataSourceAdapterViewModel = NativeDataSourcesViewModel["adapters"][number];
type NativeDataSourceViewModel = NativeDataSourcesViewModel["sources"][number];
type NativeCapabilityBadgeViewModel =
  NativeDataSourceAdapterViewModel["capabilityBadges"][number];

export type SourceTruthLabel = "Supported" | "Unsupported" | "Unknown";
export type DataSourceEnabledLabel = "Enabled" | "Disabled";
export type DataSourceValidationLabel =
  | "Valid"
  | "Invalid"
  | "Not Validated"
  | "Validating"
  | "Unsupported"
  | "Unknown";
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
}

export interface SetDataSourceEnabledRequest {
  sourceId: string;
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

function getBridge(): AgentWorkbenchBridge {
  return window.agentWorkbench;
}

export async function listDataSources(): Promise<ListDataSourcesResponse> {
  const response = await getBridge().listDataSources();

  if (!response.ok) {
    return response;
  }

  return {
    ok: true,
    adapters: response.dataSources.adapters.map(mapAdapter),
    sources: response.dataSources.sources.map(mapSource)
  };
}

export async function addDataSource(
  request: CreateDataSourceRequest
): Promise<DataSourceMutationResponse> {
  const response = await getBridge().addDataSource(request);

  return mapMutationResponse(response, (source) =>
    source.adapterId === request.adapterId && source.rootPath === request.rootPath
  );
}

export async function updateDataSource(
  request: UpdateDataSourceRequest
): Promise<DataSourceMutationResponse> {
  const response = await getBridge().updateDataSource(request);

  return mapMutationResponse(response, (source) =>
    source.adapterId === request.adapterId && source.rootPath === request.rootPath
  );
}

export async function setDataSourceEnabled(
  request: SetDataSourceEnabledRequest
): Promise<DataSourceMutationResponse> {
  const response = await getBridge().setDataSourceEnabled(request);

  return mapMutationResponse(response, (source) => source.sourceId === request.sourceId);
}

export async function validateDataSource(
  request: DataSourceActionRequest
): Promise<DataSourceMutationResponse> {
  const previous = await loadSourceById(request.sourceId);
  const response = await getBridge().validateDataSource(request);

  return mapMutationResponse(response, (source) =>
    source.sourceId === request.sourceId || matchesReplacementSource(source, previous)
  );
}

export async function scanDataSource(
  request: DataSourceActionRequest
): Promise<DataSourceMutationResponse> {
  const response = await getBridge().scanDataSource(request);

  return mapMutationResponse(response, (source) => source.sourceId === request.sourceId);
}

async function loadSourceById(
  sourceId: string
): Promise<NativeDataSourceViewModel | null> {
  const response = await getBridge().listDataSources();

  if (!response.ok) {
    return null;
  }

  return response.dataSources.sources.find((source) => source.sourceId === sourceId) ?? null;
}

function matchesReplacementSource(
  source: NativeDataSourceViewModel,
  previous: NativeDataSourceViewModel | null
): boolean {
  if (!previous || source.adapterId !== previous.adapterId) {
    return false;
  }

  if (
    source.validationUpdatedAt &&
    source.validationUpdatedAt !== previous.validationUpdatedAt
  ) {
    return true;
  }

  const previousSourceName = previous.sourceName?.trim();
  const nextSourceName = source.sourceName?.trim();

  if (previousSourceName || nextSourceName) {
    return previousSourceName === nextSourceName;
  }

  return false;
}

function mapMutationResponse(
  response: NativeListDataSourcesResponse,
  predicate: (source: NativeDataSourceViewModel) => boolean
): DataSourceMutationResponse {
  if (!response.ok) {
    return response;
  }

  const source = response.dataSources.sources.find(predicate);

  if (!source) {
    return {
      ok: false,
      error: {
        code: "data-sources-bridge-mismatch",
        message: "The data source update could not be reconciled with the renderer view."
      }
    };
  }

  return {
    ok: true,
    source: mapSource(source)
  };
}

function mapAdapter(adapter: NativeDataSourceAdapterViewModel): DataSourceAdapterOption {
  const watchPlansCapability = findCapability(adapter.capabilityBadges, "watchPlans");
  const sessionDiscoveryCapability = findCapability(
    adapter.capabilityBadges,
    "sessionDiscovery"
  );

  return {
    adapterId: adapter.adapterId,
    displayName: adapter.displayName,
    ...(adapter.defaultRoots[0] ? { sourceRootHint: adapter.defaultRoots[0].path } : {}),
    ...(watchPlansCapability
      ? { watchSupport: mapAdapterWatchSupport(watchPlansCapability) }
      : {}),
    ...(sessionDiscoveryCapability
      ? { scanSupport: mapAdapterScanSupport(sessionDiscoveryCapability) }
      : {})
  };
}

function mapSource(source: NativeDataSourceViewModel): DataSourceViewModel {
  const scan = mapScanStatus(source);
  const cache = mapCacheStatus(source);

  return {
    sourceId: source.sourceId,
    adapterId: source.adapterId,
    adapterDisplayName: source.adapterDisplayName,
    ...(source.sourceName ? { sourceName: source.sourceName } : {}),
    rootPath: source.rootPath,
    enabled: source.enabled,
    enabledLabel: source.enabledLabel,
    validation: mapValidationStatus(source),
    scan,
    cache,
    watch: mapWatchStatus(source),
    diagnosticCount: source.diagnosticCount,
    diagnostics: source.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message
    })),
    hasCompletedScan:
      scan.label === "Scanned" ||
      scan.label === "Scanned with Diagnostics" ||
      cache.label === "Cached" ||
      cache.label === "Stale"
  };
}

function mapValidationStatus(
  source: NativeDataSourceViewModel
): DataSourceStatusViewModel<DataSourceValidationLabel> {
  switch (source.validationStatus) {
    case "Valid":
      return {
        label: "Valid",
        detail: "Source root validated through the shared source registry."
      };
    case "Validation Failed":
      return {
        label: "Invalid",
        detail: "Source validation failed for the current root path."
      };
    case "Validating":
      return {
        label: "Validating",
        detail: "Validation is running for this data source."
      };
    case "Unsupported":
      return {
        label: "Unsupported",
        detail: "This harness does not currently report source validation support."
      };
    case "Unknown":
      return {
        label: "Unknown",
        detail: "Validation results are unavailable for this source."
      };
    case "Not Validated":
      return {
        label: "Not Validated",
        detail: "Validate the source before scanning."
      };
  }
}

function mapScanStatus(
  source: NativeDataSourceViewModel
): DataSourceStatusViewModel<DataSourceScanLabel> {
  switch (source.scanStatus) {
    case "Cached":
      return {
        label: "Scanned",
        detail: source.scanReason ?? "Normalization completed and cache snapshot is current."
      };
    case "Stale":
      return {
        label: "Scanned",
        detail: source.scanReason ?? "Source contents changed since the last cached scan."
      };
    case "Scanned with Diagnostics":
      return {
        label: "Scanned with Diagnostics",
        detail:
          source.scanReason ??
          "Normalization completed with parser diagnostics that need review."
      };
    case "Scan Failed":
      return {
        label: "Scan Failed",
        detail:
          source.scanReason ??
          "Review source, adapter, cache, and normalization diagnostics before trying again."
      };
    case "Scanning":
      return {
        label: "Scanning",
        detail: "Shared scanner orchestration is running for this data source."
      };
    case "Unsupported":
      return {
        label: "Unsupported",
        detail: "This harness does not currently report scan support."
      };
    case "Unknown":
      return {
        label: "Unknown",
        detail: "Scan status is unavailable for this source."
      };
    case "Never Scanned":
      return {
        label: "Never Scanned",
        detail: "No scan has completed for this data source yet."
      };
  }
}

function mapCacheStatus(
  source: NativeDataSourceViewModel
): DataSourceStatusViewModel<DataSourceCacheLabel> {
  switch (source.cacheStatus) {
    case "Cached":
      return {
        label: "Cached",
        detail: source.cacheReason ?? "Cache snapshot is current for the latest scan."
      };
    case "Stale":
      return {
        label: "Stale",
        detail:
          source.cacheReason ??
          "Source settings changed. Validate the source, then rescan to refresh cache state."
      };
    case "Unsupported":
      return {
        label: "Unsupported",
        detail: "Cache support is unavailable for this source."
      };
    case "Unknown":
      return {
        label: "Unknown",
        detail: "Cache status is unavailable until a scan completes."
      };
    case "Never Scanned":
    case "Scan Failed":
    case "Scanned with Diagnostics":
    case "Scanning":
      return {
        label: "Unknown",
        detail: "Cache status is unavailable until a scan completes."
      };
  }
}

function mapWatchStatus(
  source: NativeDataSourceViewModel
): DataSourceStatusViewModel<DataSourceWatchLabel> {
  switch (source.watchSupport) {
    case "Watch Supported":
      return {
        label: "Watch Supported",
        detail:
          source.watchReason ?? "Shared watcher plan is available for this harness."
      };
    case "Watch Unsupported":
      return {
        label: "Watch Unsupported",
        detail:
          source.watchReason ?? "Shared watching is unsupported for this source."
      };
    case "Watch Unknown":
      return {
        label: "Watch Unknown",
        detail:
          source.watchReason ??
          "Watch support has not been reported for this data source."
      };
  }
}

function mapAdapterWatchSupport(
  capability: NativeCapabilityBadgeViewModel
): DataSourceStatusViewModel<DataSourceWatchLabel> {
  switch (capability.state) {
    case "Supported":
      return {
        label: "Watch Supported",
        detail: capability.reason ?? "Shared watcher plan is available for this harness."
      };
    case "Unsupported":
      return {
        label: "Watch Unsupported",
        detail: capability.reason ?? "Shared watching is unsupported for this harness."
      };
    case "Unknown":
      return {
        label: "Watch Unknown",
        detail:
          capability.reason ?? "Watch support has not been reported for this harness."
      };
  }
}

function mapAdapterScanSupport(
  capability: NativeCapabilityBadgeViewModel
): DataSourceStatusViewModel<SourceTruthLabel> {
  return {
    label: capability.state,
    ...(capability.reason ? { detail: capability.reason } : {})
  };
}

function findCapability(
  capabilityBadges: NativeCapabilityBadgeViewModel[],
  key: string
): NativeCapabilityBadgeViewModel | undefined {
  return capabilityBadges.find((capability) => capability.key === key);
}
