import { createSourceId } from "../model/identifiers.js";
import type { CapabilityStatus } from "../model/capabilities.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";
import type { SourceRegistryStore } from "./source-registry-store.js";

export type SourceValidationStatus =
  | "not-validated"
  | "validating"
  | "valid"
  | "validation-failed"
  | "unsupported"
  | "unknown";

export type SourceOperationalStatus =
  | "cached"
  | "never-scanned"
  | "scan-failed"
  | "scanned-with-diagnostics"
  | "scanning"
  | "stale"
  | "unsupported"
  | "unknown";

export interface SourceValidationSummary {
  status: SourceValidationStatus;
  diagnostics: Diagnostic[];
  normalizedPath?: string;
  updatedAt?: string;
}

export interface SourceScanSummary {
  status: SourceOperationalStatus;
  diagnostics: Diagnostic[];
  artifactCount?: number;
  sessionCount?: number;
  updatedAt?: string;
  reason?: string;
}

export interface SourceCacheSummary {
  status: SourceOperationalStatus;
  diagnostics: Diagnostic[];
  cacheKey?: string;
  updatedAt?: string;
  reason?: string;
}

export interface SourceWatchSummary {
  status: CapabilityStatus;
  reason?: string;
  strategy?: string;
  updatedAt?: string;
}

export type SourceKind = "local-root" | "imported-archive";
export type SourceAddedBy = "user" | "import";

export interface ImportedArchiveMetadata {
  archivePath: string;
  exportedAt: string;
  importedAt: string;
  manifestVersion: number;
  scopeKind: "project" | "session";
  scopeId: string;
  scopeLabel: string;
  sourceCount: number;
  sessionCount: number;
  projectCount: number;
  rawArtifactCount: number;
}

export interface SourceRecord {
  sourceId: SourceId;
  adapterId: AdapterId;
  displayName?: string;
  rootPath: string;
  enabled: boolean;
  sourceKind: SourceKind;
  addedBy: SourceAddedBy;
  readOnly: boolean;
  validation: SourceValidationSummary;
  scan: SourceScanSummary;
  cache: SourceCacheSummary;
  watch: SourceWatchSummary;
  diagnostics: Diagnostic[];
  archive?: ImportedArchiveMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSourceRecordInput {
  adapterId: AdapterId;
  archive?: ImportedArchiveMetadata;
  addedBy?: SourceAddedBy;
  displayName?: string;
  enabled?: boolean;
  readOnly?: boolean;
  rootPath: string;
  sourceId?: SourceId;
  sourceKind?: SourceKind;
}

export interface UpdateSourceRecordInput {
  adapterId?: AdapterId;
  displayName?: string;
  enabled?: boolean;
  rootPath?: string;
  sourceId: SourceId;
}

export class SourceRegistry {
  readonly #store: SourceRegistryStore;

  constructor(store: SourceRegistryStore) {
    this.#store = store;
  }

  async listSources(): Promise<SourceRecord[]> {
    return this.#store.load();
  }

  async getSource(sourceId: SourceId): Promise<SourceRecord | undefined> {
    const records = await this.#store.load();
    return records.find((record) => record.sourceId === sourceId);
  }

  async createSource(input: CreateSourceRecordInput): Promise<SourceRecord> {
    const records = await this.#store.load();
    const now = new Date().toISOString();
    const nextRecord = sanitizeSourceRecord({
      sourceId:
        input.sourceId ?? createSourceId(input.adapterId, input.rootPath),
      adapterId: input.adapterId,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      rootPath: input.rootPath,
      enabled: input.enabled ?? true,
      sourceKind: input.sourceKind ?? "local-root",
      addedBy: input.addedBy ?? "user",
      readOnly: input.readOnly ?? false,
      validation: createInitialValidationSummary(),
      scan: createInitialOperationalSummary(),
      cache: createInitialCacheSummary(),
      watch: {
        status: "unknown"
      },
      diagnostics: [],
      ...(input.archive ? { archive: input.archive } : {}),
      createdAt: now,
      updatedAt: now
    });
    const filteredRecords = records.filter((record) => record.sourceId !== nextRecord.sourceId);

    filteredRecords.push(nextRecord);
    await this.#store.save(sortRecords(filteredRecords));
    return nextRecord;
  }

  async updateSource(input: UpdateSourceRecordInput): Promise<SourceRecord> {
    return this.mutateSource(input.sourceId, (record) =>
      sanitizeSourceRecord({
        ...record,
        ...(input.adapterId ? { adapterId: input.adapterId } : {}),
        ...(input.displayName !== undefined
          ? input.displayName
            ? { displayName: input.displayName }
            : {}
          : record.displayName
            ? { displayName: record.displayName }
            : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.rootPath ? { rootPath: input.rootPath } : {}),
        updatedAt: new Date().toISOString()
      })
    );
  }

  async replaceSourceIdentity(
    currentSourceId: SourceId,
    nextSourceId: SourceId
  ): Promise<SourceRecord> {
    if (currentSourceId === nextSourceId) {
      const current = await this.getSource(currentSourceId);

      if (!current) {
        throw new Error(`Source '${currentSourceId}' is not registered.`);
      }

      return current;
    }

    const records = await this.#store.load();
    const current = records.find((record) => record.sourceId === currentSourceId);

    if (!current) {
      throw new Error(`Source '${currentSourceId}' is not registered.`);
    }

    const nextRecord = sanitizeSourceRecord({
      ...current,
      sourceId: nextSourceId,
      updatedAt: new Date().toISOString()
    });
    const nextRecords = records.filter(
      (record) => record.sourceId !== currentSourceId && record.sourceId !== nextSourceId
    );

    nextRecords.push(nextRecord);
    await this.#store.save(sortRecords(nextRecords));
    return nextRecord;
  }

  async setSourceEnabled(sourceId: SourceId, enabled: boolean): Promise<SourceRecord> {
    return this.updateSource({
      sourceId,
      enabled
    });
  }

  async saveValidationSummary(
    sourceId: SourceId,
    summary: SourceValidationSummary
  ): Promise<SourceRecord> {
    return this.mutateSource(sourceId, (record) => ({
      ...record,
      validation: {
        ...summary,
        updatedAt: summary.updatedAt ?? new Date().toISOString()
      },
      diagnostics: mergeDiagnostics(summary.diagnostics, record.scan.diagnostics, record.cache.diagnostics),
      updatedAt: new Date().toISOString()
    }));
  }

  async saveScanSummary(sourceId: SourceId, summary: SourceScanSummary): Promise<SourceRecord> {
    return this.mutateSource(sourceId, (record) => ({
      ...record,
      scan: {
        ...summary,
        updatedAt: summary.updatedAt ?? new Date().toISOString()
      },
      diagnostics: mergeDiagnostics(record.validation.diagnostics, summary.diagnostics, record.cache.diagnostics),
      updatedAt: new Date().toISOString()
    }));
  }

  async saveCacheSummary(sourceId: SourceId, summary: SourceCacheSummary): Promise<SourceRecord> {
    return this.mutateSource(sourceId, (record) => ({
      ...record,
      cache: {
        ...summary,
        updatedAt: summary.updatedAt ?? new Date().toISOString()
      },
      diagnostics: mergeDiagnostics(record.validation.diagnostics, record.scan.diagnostics, summary.diagnostics),
      updatedAt: new Date().toISOString()
    }));
  }

  async saveWatchSummary(sourceId: SourceId, summary: SourceWatchSummary): Promise<SourceRecord> {
    return this.mutateSource(sourceId, (record) => ({
      ...record,
      watch: {
        ...summary,
        updatedAt: summary.updatedAt ?? new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    }));
  }

  async replaceSource(record: SourceRecord): Promise<SourceRecord> {
    const records = await this.#store.load();
    const nextRecords = records.filter((item) => item.sourceId !== record.sourceId);

    nextRecords.push(record);
    await this.#store.save(sortRecords(nextRecords));
    return record;
  }

  private async mutateSource(
    sourceId: SourceId,
    mutate: (record: SourceRecord) => SourceRecord
  ): Promise<SourceRecord> {
    const records = await this.#store.load();
    const current = records.find((record) => record.sourceId === sourceId);

    if (!current) {
      throw new Error(`Source '${sourceId}' is not registered.`);
    }

    const nextRecord = sanitizeSourceRecord(mutate(current));
    const nextRecords = records.filter((record) => record.sourceId !== sourceId);

    nextRecords.push(nextRecord);
    await this.#store.save(sortRecords(nextRecords));
    return nextRecord;
  }
}

function sanitizeSourceRecord(record: SourceRecord): SourceRecord {
  return {
    sourceId: record.sourceId,
    adapterId: record.adapterId,
    ...(record.displayName ? { displayName: record.displayName } : {}),
    rootPath: record.rootPath,
    enabled: record.enabled,
    sourceKind: record.sourceKind,
    addedBy: record.addedBy,
    readOnly: record.readOnly,
    validation: record.validation,
    scan: record.scan,
    cache: record.cache,
    watch: record.watch,
    diagnostics: record.diagnostics,
    ...(record.archive ? { archive: record.archive } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function isImportedArchiveSource(record: SourceRecord): boolean {
  return record.sourceKind === "imported-archive" || record.readOnly;
}

export function createInitialValidationSummary(): SourceValidationSummary {
  return {
    status: "not-validated",
    diagnostics: []
  };
}

export function createInitialOperationalSummary(): SourceScanSummary {
  return {
    status: "never-scanned",
    diagnostics: []
  };
}

export function createInitialCacheSummary(): SourceCacheSummary {
  return {
    status: "unknown",
    diagnostics: []
  };
}

function mergeDiagnostics(...groups: Diagnostic[][]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();

  for (const diagnostics of groups) {
    for (const diagnostic of diagnostics) {
      seen.set(diagnostic.id, diagnostic);
    }
  }

  return [...seen.values()];
}

function sortRecords(records: SourceRecord[]): SourceRecord[] {
  return [...records].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}
