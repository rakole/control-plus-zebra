import type { HarnessDescriptor } from "../core/adapter-contract/index.js";
import type { CapabilityStatus } from "../core/model/capabilities.js";
import { createSourceId } from "../core/model/identifiers.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import type {
  SourceCacheSummary,
  SourceOperationalStatus,
  SourceRecord,
  SourceValidationStatus
} from "../core/registry/source-registry.js";
import {
  getSourceOperationFlags,
  isImportedArchiveSource
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
import { syncLatestSourceCacheRecordToEntityStore } from "./workbench-entity-store-sync.js";
import { toCapabilityGroups } from "./capability-view-models.js";

const settingsChangedReason = "Source settings changed. Validate again before scanning.";
const importedArchiveReadOnlyReason =
  "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import.";

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

      assertSourceSupportsOperation(current, "configure");
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

      if (parsed.enabled !== undefined) {
        await runtime.sourceRegistry.setSourceEnabled(nextSource.sourceId, parsed.enabled);
      }

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
      const source = await requireSource(runtime, parsed.sourceId);

      assertSourceSupportsOperation(source, "configure");
      await runtime.sourceRegistry.setSourceEnabled(parsed.sourceId, parsed.enabled);
      return buildViewModel(runtime);
    },

    async validateDataSource(request) {
      const parsed = validateDataSourceRequestSchema.parse(request);
      const source = await requireSource(runtime, parsed.sourceId);

      assertSourceSupportsOperation(source, "validate");
      await runtime.scanner.validateSource(parsed.sourceId);
      return buildViewModel(runtime);
    },

    async scanDataSource(request) {
      const parsed = scanDataSourceRequestSchema.parse(request);
      const source = await requireSource(runtime, parsed.sourceId);

      assertSourceSupportsOperation(source, "scan");
      if (!source.enabled) {
        throw new Error("Disabled sources cannot be scanned.");
      }

      if (source.validation.status !== "valid") {
        throw new Error("Source validation must succeed before scanning.");
      }

      await runtime.scanJobRunner.scanSource(parsed.sourceId);
      await syncLatestSourceCacheRecordToEntityStore(runtime, parsed.sourceId);
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
    capabilityGroups: toCapabilityGroups(descriptor.capabilities),
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
  const operationFlags = getSourceOperationFlags(source);
  const readOnly = source.readOnly || !operationFlags.configurable;
  const readOnlyReason = getReadOnlyReason(source, readOnly);

  return {
    sourceId: source.sourceId,
    adapterId: source.adapterId,
    adapterDisplayName: descriptor?.displayName ?? source.adapterId,
    ...(source.displayName ? { sourceName: source.displayName } : {}),
    rootPath: source.rootPath,
    enabled: source.enabled,
    enabledLabel: source.enabled ? "Enabled" : "Disabled",
    sourceKind: toSourceKindLabel(source),
    addedBy: toAddedByLabel(source),
    readOnly,
    ...(readOnly ? { readOnlyLabel: "Read Only" as const } : {}),
    ...(readOnlyReason ? { readOnlyReason } : {}),
    ...(source.archive ? { archiveMetadata: source.archive } : {}),
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
    capabilityGroups: descriptor ? toCapabilityGroups(descriptor.capabilities) : [],
    diagnostics
  };
}

function assertSourceSupportsOperation(
  source: SourceRecord,
  operation: "configure" | "validate" | "scan"
): void {
  const operationFlags = getSourceOperationFlags(source);

  if (
    (operation === "configure" && operationFlags.configurable) ||
    (operation === "validate" && operationFlags.validate) ||
    (operation === "scan" && operationFlags.scan)
  ) {
    return;
  }

  throw new Error(
    getReadOnlyReason(source, true) ??
      `This source does not support the '${operation}' operation.`
  );
}

function getReadOnlyReason(source: SourceRecord, readOnly: boolean): string | undefined {
  if (!readOnly) {
    return undefined;
  }

  if (isImportedArchiveSource(source)) {
    return importedArchiveReadOnlyReason;
  }

  return "This source is read-only. Update, enable, validate, and scan operations are disabled.";
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
  const nextCacheStatus: SourceOperationalStatus =
    source.cache.status === "cached" ? "stale" : source.cache.status;
  const nextCacheSummary: SourceCacheSummary = {
    ...source.cache,
    status: nextCacheStatus,
    diagnostics: source.cache.diagnostics,
    ...(nextCacheStatus === "stale" ? { reason: settingsChangedReason } : {})
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

function toSourceKindLabel(source: SourceRecord): "Imported Archive" | "Local Source" {
  return source.sourceKind === "imported-archive" ? "Imported Archive" : "Local Source";
}

function toAddedByLabel(source: SourceRecord): "Configured" | "Import" {
  return source.addedBy === "import" ? "Import" : "Configured";
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
