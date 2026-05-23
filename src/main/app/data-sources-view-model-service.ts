import type { HarnessDescriptor } from "../core/adapter-contract/index.js";
import type { CapabilityState, CapabilityStatus, HarnessCapabilities } from "../core/model/capabilities.js";
import { createSourceId } from "../core/model/identifiers.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import type {
  SourceCacheSummary,
  SourceOperationalStatus,
  SourceRecord,
  SourceValidationStatus
} from "../core/registry/source-registry.js";
import {
  addDataSourceRequestSchema,
  type AddDataSourceRequest,
  dataSourcesViewModelSchema,
  type DataSourcesViewModel,
  type DataSourceOperationalStatus,
  type DataSourceValidationStatus,
  scanDataSourceRequestSchema,
  type ScanDataSourceRequest,
  setDataSourceEnabledRequestSchema,
  type SetDataSourceEnabledRequest,
  updateDataSourceRequestSchema,
  type UpdateDataSourceRequest,
  validateDataSourceRequestSchema,
  type ValidateDataSourceRequest,
  type CapabilityBadgeLabel,
  type DataSourceAdapterViewModel,
  type DataSourceDiagnosticViewModel,
  type DataSourceViewModel,
  type WatchSupportStatus
} from "../ipc/view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

const capabilityKeys = [
  "sessionDiscovery",
  "liveSessionObservation",
  "eventStreaming",
  "messageCapture",
  "toolCallCapture",
  "shellCommandCapture",
  "outputArtifactCapture",
  "fileMutationCapture",
  "sourceValidation",
  "watchPlans",
  "gitContextCapture",
  "githubContextCapture",
  "verificationSignals"
] as const satisfies readonly (keyof HarnessCapabilities)[];

const settingsChangedReason = "Source settings changed. Validate again before scanning.";

export interface DataSourcesViewModelService {
  listDataSources(): Promise<DataSourcesViewModel>;
  addDataSource(request: AddDataSourceRequest): Promise<DataSourcesViewModel>;
  updateDataSource(request: UpdateDataSourceRequest): Promise<DataSourcesViewModel>;
  setDataSourceEnabled(request: SetDataSourceEnabledRequest): Promise<DataSourcesViewModel>;
  validateDataSource(request: ValidateDataSourceRequest): Promise<DataSourcesViewModel>;
  scanDataSource(request: ScanDataSourceRequest): Promise<DataSourcesViewModel>;
}

export interface DataSourcesViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createDataSourcesViewModelService(
  options: DataSourcesViewModelServiceOptions = {}
): DataSourcesViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    async listDataSources() {
      return buildViewModel(runtime);
    },

    async addDataSource(request) {
      const parsed = addDataSourceRequestSchema.parse(request);
      runtime.adapterRegistry.require(parsed.adapterId);
      await runtime.sourceRegistry.createSource({
        adapterId: parsed.adapterId,
        rootPath: parsed.rootPath,
        ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
        ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {})
      });

      return buildViewModel(runtime);
    },

    async updateDataSource(request) {
      const parsed = updateDataSourceRequestSchema.parse(request);
      const current = await requireSource(runtime, parsed.sourceId);
      const nextAdapterId = parsed.adapterId ?? current.adapterId;
      const nextRootPath = parsed.rootPath ?? current.rootPath;
      const identityChanged =
        nextAdapterId !== current.adapterId || nextRootPath !== current.rootPath;

      runtime.adapterRegistry.require(nextAdapterId);

      let nextSource = await runtime.sourceRegistry.updateSource({
        sourceId: current.sourceId,
        ...(parsed.adapterId ? { adapterId: parsed.adapterId } : {}),
        ...(parsed.displayName !== undefined ? { displayName: parsed.displayName } : {}),
        ...(parsed.rootPath ? { rootPath: parsed.rootPath } : {})
      });

      if (identityChanged) {
        nextSource = await runtime.sourceRegistry.replaceSourceIdentity(
          nextSource.sourceId,
          createSourceId(nextAdapterId, nextRootPath)
        );
        await markSourceDirtyAfterSettingsChange(runtime, nextSource);
      }

      return buildViewModel(runtime);
    },

    async setDataSourceEnabled(request) {
      const parsed = setDataSourceEnabledRequestSchema.parse(request);

      await runtime.sourceRegistry.setSourceEnabled(parsed.sourceId, parsed.enabled);
      return buildViewModel(runtime);
    },

    async validateDataSource(request) {
      const parsed = validateDataSourceRequestSchema.parse(request);

      await runtime.scanner.validateSource(parsed.sourceId);
      return buildViewModel(runtime);
    },

    async scanDataSource(request) {
      const parsed = scanDataSourceRequestSchema.parse(request);
      const source = await requireSource(runtime, parsed.sourceId);

      if (!source.enabled) {
        throw new Error("Disabled sources cannot be scanned.");
      }

      if (source.validation.status !== "valid") {
        throw new Error("Source validation must succeed before scanning.");
      }

      await runtime.scanner.scanSource(parsed.sourceId);
      return buildViewModel(runtime);
    }
  };
}

async function buildViewModel(runtime: WorkbenchRuntime): Promise<DataSourcesViewModel> {
  const [descriptors, sources] = await Promise.all([
    Promise.resolve(runtime.adapterRegistry.listDescriptors()),
    runtime.sourceRegistry.listSources()
  ]);

  return dataSourcesViewModelSchema.parse({
    adapters: descriptors.map(toAdapterViewModel),
    sources: sources.map((source) => toSourceViewModel(source, descriptors))
  });
}

function toAdapterViewModel(descriptor: HarnessDescriptor): DataSourceAdapterViewModel {
  return {
    adapterId: descriptor.id,
    displayName: descriptor.displayName,
    capabilityBadges: capabilityKeys.map((key) =>
      toCapabilityBadge(key, descriptor.capabilities[key])
    ),
    defaultRoots: descriptor.defaultRoots.map((root) => ({
      path: root.path,
      label: root.label,
      kind: root.kind
    }))
  };
}

function toSourceViewModel(
  source: SourceRecord,
  descriptors: HarnessDescriptor[]
): DataSourceViewModel {
  const descriptor = descriptors.find((candidate) => candidate.id === source.adapterId);
  const diagnostics = collectSourceDiagnostics(source);

  return {
    sourceId: source.sourceId,
    adapterId: source.adapterId,
    adapterDisplayName: descriptor?.displayName ?? source.adapterId,
    ...(source.displayName ? { sourceName: source.displayName } : {}),
    rootPath: source.rootPath,
    enabled: source.enabled,
    enabledLabel: source.enabled ? "Enabled" : "Disabled",
    validationStatus: toValidationStatusLabel(source.validation.status),
    ...(source.validation.updatedAt ? { validationUpdatedAt: source.validation.updatedAt } : {}),
    ...(source.validation.normalizedPath ? { validationPath: source.validation.normalizedPath } : {}),
    scanStatus: toOperationalStatusLabel(source.scan.status),
    ...(source.scan.updatedAt ? { scanUpdatedAt: source.scan.updatedAt } : {}),
    ...(source.scan.reason ? { scanReason: source.scan.reason } : {}),
    ...(source.scan.artifactCount !== undefined ? { artifactCount: source.scan.artifactCount } : {}),
    ...(source.scan.sessionCount !== undefined ? { sessionCount: source.scan.sessionCount } : {}),
    cacheStatus: toOperationalStatusLabel(source.cache.status),
    ...(source.cache.updatedAt ? { cacheUpdatedAt: source.cache.updatedAt } : {}),
    ...(source.cache.reason ? { cacheReason: source.cache.reason } : {}),
    ...(source.cache.cacheKey ? { cacheKey: source.cache.cacheKey } : {}),
    watchSupport: toWatchSupportLabel(source.watch.status),
    ...(source.watch.strategy ? { watchStrategy: source.watch.strategy } : {}),
    ...(source.watch.reason ? { watchReason: source.watch.reason } : {}),
    diagnosticCount: diagnostics.length,
    capabilityBadges: descriptor
      ? capabilityKeys.map((key) => toCapabilityBadge(key, descriptor.capabilities[key]))
      : [],
    diagnostics
  };
}

async function requireSource(runtime: WorkbenchRuntime, sourceId: string): Promise<SourceRecord> {
  const source = await runtime.sourceRegistry.getSource(sourceId);

  if (!source) {
    throw new Error(`Source '${sourceId}' is not registered.`);
  }

  return source;
}

async function markSourceDirtyAfterSettingsChange(
  runtime: WorkbenchRuntime,
  source: SourceRecord
): Promise<void> {
  const nextScanStatus: SourceOperationalStatus =
    source.scan.status === "never-scanned" ? "never-scanned" : "stale";
  const nextCacheSummary: SourceCacheSummary = {
    ...source.cache,
    status: source.cache.cacheKey ? "stale" : source.cache.status,
    diagnostics: source.cache.diagnostics,
    ...(source.cache.cacheKey ? { reason: settingsChangedReason } : {})
  };

  await runtime.sourceRegistry.saveValidationSummary(source.sourceId, {
    status: "not-validated",
    diagnostics: source.validation.diagnostics
  });
  await runtime.sourceRegistry.saveScanSummary(source.sourceId, {
    ...source.scan,
    status: nextScanStatus,
    diagnostics: source.scan.diagnostics,
    ...(nextScanStatus === "stale" ? { reason: settingsChangedReason } : {})
  });
  await runtime.sourceRegistry.saveCacheSummary(source.sourceId, nextCacheSummary);
  await runtime.sourceRegistry.saveWatchSummary(source.sourceId, {
    status: "unknown",
    reason: "Validate the source to refresh watch support."
  });
}

function collectSourceDiagnostics(source: SourceRecord): DataSourceDiagnosticViewModel[] {
  const diagnostics = [
    ...source.validation.diagnostics.map((diagnostic) =>
      toSourceDiagnosticViewModel(diagnostic, "source")
    ),
    ...source.scan.diagnostics.map((diagnostic) =>
      toSourceDiagnosticViewModel(
        diagnostic,
        diagnostic.code.startsWith("normalization.") ? "normalization" : "source"
      )
    ),
    ...source.cache.diagnostics.map((diagnostic) =>
      toSourceDiagnosticViewModel(diagnostic, "cache")
    )
  ];
  const seen = new Map<string, DataSourceDiagnosticViewModel>();

  for (const diagnostic of diagnostics) {
    seen.set(`${diagnostic.sourceArea}:${diagnostic.code}:${diagnostic.message}`, diagnostic);
  }

  return [...seen.values()];
}

function toSourceDiagnosticViewModel(
  diagnostic: Diagnostic,
  fallbackArea: DataSourceDiagnosticViewModel["sourceArea"]
): DataSourceDiagnosticViewModel {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    sourceArea: diagnostic.scope === "adapter" ? "adapter" : fallbackArea
  };
}

function toCapabilityBadge(key: keyof HarnessCapabilities, state: CapabilityState) {
  return {
    key,
    label: humanizeCapabilityKey(key),
    state: toCapabilityLabel(state.status),
    ...(state.reason ? { reason: state.reason } : {})
  };
}

function toCapabilityLabel(status: CapabilityState["status"]): CapabilityBadgeLabel {
  switch (status) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

function toValidationStatusLabel(status: SourceValidationStatus): DataSourceValidationStatus {
  switch (status) {
    case "not-validated":
      return "Not Validated";
    case "validating":
      return "Validating";
    case "valid":
      return "Valid";
    case "validation-failed":
      return "Validation Failed";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

function toOperationalStatusLabel(status: SourceOperationalStatus): DataSourceOperationalStatus {
  switch (status) {
    case "never-scanned":
      return "Never Scanned";
    case "scanning":
      return "Scanning";
    case "scan-failed":
      return "Scan Failed";
    case "scanned-with-diagnostics":
      return "Scanned with Diagnostics";
    case "cached":
      return "Cached";
    case "stale":
      return "Stale";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

function toWatchSupportLabel(status: CapabilityStatus): WatchSupportStatus {
  switch (status) {
    case "supported":
      return "Watch Supported";
    case "unsupported":
      return "Watch Unsupported";
    case "unknown":
      return "Watch Unknown";
  }
}

function humanizeCapabilityKey(key: keyof HarnessCapabilities): string {
  return key.replace(/([A-Z])/gu, " $1").replace(/^./u, (first) => first.toUpperCase());
}
