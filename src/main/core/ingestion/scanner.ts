import { createHash } from "node:crypto";

import type { SessionSourceAdapter } from "../adapter-contract/session-source-adapter.js";
import type {
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  RawHarnessEvent
} from "../adapter-contract/types.js";
import type { FileBackedCacheStore, NormalizedCacheRecord } from "../cache/file-backed-cache-store.js";
import { createCacheKey } from "../cache/cache-keys.js";
import { buildDiagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../model/confidence.js";
import { createSourceId } from "../model/identifiers.js";
import { createSafeFilesystem, type SafeFilesystem } from "../security/safe-filesystem.js";
import type { RawArtifactIndex } from "./raw-artifact-index.js";
import { createRawArtifactIndexEntries, fingerprintEntries, RAW_ARTIFACT_SCHEMA_VERSION } from "./raw-artifact-index.js";
import { validateNormalizedResult, NORMALIZATION_SCHEMA_VERSION } from "./normalization-validator.js";
import { mergeNormalizedResults } from "./session-merger.js";
import type { AdapterRegistry } from "../registry/adapter-registry.js";
import type { SourceRecord, SourceRegistry } from "../registry/source-registry.js";
import type { WatchOrchestrator } from "../watcher/watch-orchestrator.js";

export interface ScannerOptions {
  adapterRegistry: AdapterRegistry;
  cacheStore: FileBackedCacheStore;
  projectDir: string;
  rawArtifactIndex: RawArtifactIndex;
  sourceRegistry: SourceRegistry;
  watchOrchestrator: WatchOrchestrator;
}

export interface SourceValidationExecution {
  source: SourceRecord;
}

export interface SourceScanExecution {
  cachedRecord?: NormalizedCacheRecord;
  source: SourceRecord;
}

type RuntimeAdapterContext = AdapterContext & { safeFilesystem: SafeFilesystem };

export class Scanner {
  readonly #adapterRegistry: AdapterRegistry;
  readonly #cacheStore: FileBackedCacheStore;
  readonly #projectDir: string;
  readonly #rawArtifactIndex: RawArtifactIndex;
  readonly #sourceRegistry: SourceRegistry;
  readonly #watchOrchestrator: WatchOrchestrator;

  constructor(options: ScannerOptions) {
    this.#adapterRegistry = options.adapterRegistry;
    this.#cacheStore = options.cacheStore;
    this.#projectDir = options.projectDir;
    this.#rawArtifactIndex = options.rawArtifactIndex;
    this.#sourceRegistry = options.sourceRegistry;
    this.#watchOrchestrator = options.watchOrchestrator;
  }

  async validateSource(sourceId: string): Promise<SourceValidationExecution> {
    const source = await this.requireSource(sourceId);
    const adapter = this.#adapterRegistry.require(source.adapterId);
    const context = this.createContext({
      allowedRootPaths: [source.rootPath]
    });

    await this.#sourceRegistry.saveValidationSummary(source.sourceId, {
      status: "validating",
      diagnostics: source.validation.diagnostics
    });

    const validation = await adapter.validateSourceRoot(
      {
        rootPath: source.rootPath,
        ...(source.displayName ? { displayName: source.displayName } : {})
      },
      context
    );
    let nextSource = source;
    const normalizedPath = validation.normalizedPath ?? source.rootPath;
    const nextSourceId = createSourceIdentity(adapter, normalizedPath);

    if (nextSource.sourceId !== nextSourceId) {
      nextSource = await this.#sourceRegistry.replaceSourceIdentity(source.sourceId, nextSourceId);
    }

    nextSource = await this.#sourceRegistry.updateSource({
      sourceId: nextSource.sourceId,
      rootPath: normalizedPath
    });
    nextSource = await this.#sourceRegistry.saveValidationSummary(nextSource.sourceId, {
      status: toValidationStatus(validation.ok, validation.capabilities?.sourceValidation.status),
      diagnostics: validation.diagnostics,
      ...(validation.normalizedPath ? { normalizedPath: validation.normalizedPath } : {})
    });

    return {
      source: nextSource
    };
  }

  async reconcileSource(sourceId: string): Promise<SourceRecord> {
    const source = await this.requireSource(sourceId);

    if (source.validation.status !== "valid") {
      return source;
    }

    const adapter = this.#adapterRegistry.require(source.adapterId);
    const validationContext = this.createContext({
      allowedRootPaths: [source.rootPath]
    });
    const discoveredSources = await collectAsync(
      adapter.discoverSources(
        {
          rootPath: source.rootPath,
          ...(source.displayName ? { displayName: source.displayName } : {})
        },
        validationContext
      )
    );
    const discoveredSource = discoveredSources[0];

    if (!discoveredSource) {
      return source;
    }

    const artifactContext = this.createContext({
      allowedRootPaths: [source.rootPath]
    });
    const artifacts = await collectAsync(adapter.discoverArtifacts(discoveredSource, artifactContext));
    const diagnosticsHash = createDiagnosticsHash(source.diagnostics);
    const indexEntries = createRawArtifactIndexEntries({
      adapterVersion: adapter.descriptor.adapterVersion,
      artifacts,
      diagnosticsHash,
      parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
      schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
    });
    const change = await this.#rawArtifactIndex.hasSourceChanged(source.sourceId, indexEntries);

    if (!change.changed) {
      return source;
    }

    const staleReason = "Source contents changed since the last cached scan.";

    await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
      status: "stale",
      diagnostics: source.diagnostics,
      reason: staleReason
    });

    return (
      await this.#sourceRegistry.saveScanSummary(source.sourceId, {
        ...source.scan,
        status: source.scan.status === "never-scanned" ? "never-scanned" : "stale",
        diagnostics: source.diagnostics,
        reason: staleReason
      })
    );
  }

  async scanSource(sourceId: string): Promise<SourceScanExecution> {
    const source = await this.requireSource(sourceId);

    if (!source.enabled) {
      throw new Error("Disabled sources cannot be scanned.");
    }

    if (source.validation.status !== "valid") {
      throw new Error("Sources must validate before scanning.");
    }

    const adapter = this.#adapterRegistry.require(source.adapterId);
    const validationContext = this.createContext({
      allowedRootPaths: [source.rootPath]
    });
    const configuredRoot = {
      rootPath: source.rootPath,
      ...(source.displayName ? { displayName: source.displayName } : {})
    };

    await this.#sourceRegistry.saveScanSummary(source.sourceId, {
      status: "scanning",
      diagnostics: source.diagnostics
    });

    const discoveredSources = await collectAsync(
      adapter.discoverSources(configuredRoot, validationContext)
    );

    if (discoveredSources.length === 0) {
      const missingSourceDiagnostic = buildDiagnostic(
        adapter.descriptor.id,
        "scanner.source.missing",
        "The adapter did not discover any sources for the configured root.",
        "error",
        "source",
        HIGH_CONFIDENCE,
        {
          sourceId: source.sourceId,
          nativeId: source.rootPath
        }
      );
      const nextSource = await this.#sourceRegistry.saveScanSummary(source.sourceId, {
        status: "scan-failed",
        diagnostics: [missingSourceDiagnostic]
      });

      await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
        status: "unknown",
        diagnostics: [missingSourceDiagnostic]
      });

      return {
        source: nextSource
      };
    }

    const normalizedResults = [];
    let scanDiagnostics = [...source.validation.diagnostics];
    let totalArtifacts = 0;
    let totalSessions = 0;
    let cacheRecord: NormalizedCacheRecord | undefined;

    for (const discoveredSource of discoveredSources) {
      const discoveryContext = this.createContext({
        allowedRootPaths: [discoveredSource.rootPath]
      });
      const artifacts = await collectAsync(adapter.discoverArtifacts(discoveredSource, discoveryContext));
      totalArtifacts += artifacts.length;
      const artifactPaths = artifacts.flatMap((artifact) => (artifact.path ? [artifact.path] : []));
      const parseContext = this.createContext({
        allowedArtifactPaths: artifactPaths,
        allowedRootPaths: [discoveredSource.rootPath]
      });
      const artifactsWithMetadata: RawArtifactRef[] = await Promise.all(
        artifacts.map(async (artifact) => {
          if (!artifact.path) {
            return artifact;
          }

          const fileStat = await parseContext.safeFilesystem.statPath(artifact.path);

          return applySafeArtifactMetadata(artifact, fileStat);
        })
      );
      const rawEvents = await collectRawEvents(adapter, artifactsWithMetadata, parseContext);
      const normalized = await adapter.normalize(
        {
          source: discoveredSource,
          artifacts: artifactsWithMetadata,
          rawEvents
        },
        parseContext
      );
      const validation = validateNormalizedResult(normalized);

      if (!validation.ok) {
        scanDiagnostics = [...scanDiagnostics, ...validation.diagnostics];
        continue;
      }

      const watchRecord = await this.#watchOrchestrator.planForSource(
        adapter,
        discoveredSource,
        parseContext
      );

      await this.#sourceRegistry.saveWatchSummary(source.sourceId, {
        status: watchRecord.status,
        ...(watchRecord.reason ? { reason: watchRecord.reason } : {}),
        strategy: watchRecord.strategy
      });

      const indexDiagnosticsHash = createDiagnosticsHash(normalized.diagnostics);
      const indexEntries = createRawArtifactIndexEntries({
        adapterVersion: adapter.descriptor.adapterVersion,
        artifacts: artifactsWithMetadata,
        diagnosticsHash: indexDiagnosticsHash,
        parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
        schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
      });

      await this.#rawArtifactIndex.replaceSourceEntries(source.sourceId, indexEntries);

      const artifactFingerprint = fingerprintEntries(indexEntries);
      const cacheKey = createCacheKey({
        adapterId: normalized.adapterId,
        sourceId: normalized.sourceId,
        adapterVersion: adapter.descriptor.adapterVersion,
        parserVersion: adapter.descriptor.parserVersion ?? adapter.descriptor.adapterVersion,
        schemaVersion: NORMALIZATION_SCHEMA_VERSION,
        diagnosticsHash: indexDiagnosticsHash,
        artifacts: indexEntries
      });
      const now = new Date().toISOString();

      cacheRecord = {
        cacheKey,
        adapterId: normalized.adapterId,
        sourceId: normalized.sourceId,
        artifactFingerprint,
        createdAt: now,
        updatedAt: now,
        normalized
      };

      await this.#cacheStore.writeRecord(cacheRecord);
      normalizedResults.push(normalized);
      scanDiagnostics = [...scanDiagnostics, ...normalized.diagnostics];
      totalSessions += normalized.sessions.length;
    }

    const merged = mergeNormalizedResults(normalizedResults);
    const nextScanStatus =
      normalizedResults.length === 0
        ? "scan-failed"
        : scanDiagnostics.some((diagnostic) => diagnostic.severity === "error") ||
            scanDiagnostics.length > source.validation.diagnostics.length
          ? "scanned-with-diagnostics"
          : "cached";
    const nextCacheStatus =
      normalizedResults.length === 0
        ? "unknown"
        : "cached";
    const nextSource = await this.#sourceRegistry.saveScanSummary(source.sourceId, {
      status: nextScanStatus,
      diagnostics: scanDiagnostics,
      artifactCount: totalArtifacts,
      sessionCount: totalSessions
    });

    await this.#sourceRegistry.saveCacheSummary(source.sourceId, {
      status: nextCacheStatus,
      diagnostics: scanDiagnostics,
      ...(cacheRecord ? { cacheKey: cacheRecord.cacheKey } : {})
    });

    return {
      ...(cacheRecord ? { cachedRecord: cacheRecord } : {}),
      source: merged ? await this.#sourceRegistry.getSource(source.sourceId).then((record) => record ?? nextSource) : nextSource
    };
  }

  private createContext(input: {
    allowedArtifactPaths?: string[];
    allowedRootPaths: string[];
  }): RuntimeAdapterContext {
    return {
      projectDir: this.#projectDir,
      platform: process.platform,
      safeFilesystem: createSafeFilesystem({
        allowedRootPaths: input.allowedRootPaths,
        ...(input.allowedArtifactPaths ? { allowedArtifactPaths: input.allowedArtifactPaths } : {})
      })
    };
  }

  private async requireSource(sourceId: string): Promise<SourceRecord> {
    const source = await this.#sourceRegistry.getSource(sourceId);

    if (!source) {
      throw new Error(`Source '${sourceId}' is not registered.`);
    }

    return source;
  }
}

function createSourceIdentity(adapter: SessionSourceAdapter, normalizedPath: string): string {
  return createSourceId(adapter.descriptor.id, normalizedPath);
}

function toValidationStatus(
  ok: boolean,
  sourceValidationCapability?: "supported" | "unsupported" | "unknown"
) {
  if (sourceValidationCapability === "unsupported") {
    return "unsupported";
  }

  if (sourceValidationCapability === "unknown") {
    return "unknown";
  }

  return ok ? "valid" : "validation-failed";
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

async function collectRawEvents(
  adapter: SessionSourceAdapter,
  artifacts: RawArtifactRef[],
  context: AdapterContext
): Promise<RawHarnessEvent[]> {
  const rawEvents: RawHarnessEvent[] = [];

  for (const artifact of artifacts) {
    rawEvents.push(...(await collectAsync(adapter.parseArtifact(artifact, context))));
  }

  return rawEvents;
}

export function applySafeArtifactMetadata<
  TArtifact extends {
    byteLength?: number;
    inode?: number;
    mtimeMs?: number;
  }
>(artifact: TArtifact, fileStat: { byteLength?: number; inode?: number; mtimeMs: number }): TArtifact {
  return {
    ...artifact,
    ...(artifact.byteLength !== undefined
      ? { byteLength: artifact.byteLength }
      : fileStat.byteLength !== undefined
        ? { byteLength: fileStat.byteLength }
        : {}),
    ...(artifact.inode !== undefined
      ? { inode: artifact.inode }
      : fileStat.inode !== undefined
        ? { inode: fileStat.inode }
        : {}),
    ...(artifact.mtimeMs !== undefined ? { mtimeMs: artifact.mtimeMs } : { mtimeMs: fileStat.mtimeMs })
  };
}

function createDiagnosticsHash(diagnostics: Array<{ code: string; message: string; severity: string }>) {
  const stable = diagnostics
    .map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}:${diagnostic.message}`)
    .sort()
    .join("|");

  return createHash("sha256").update(stable).digest("hex");
}
