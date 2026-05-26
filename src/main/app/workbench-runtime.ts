import path from "node:path";

import { FileBackedCacheStore } from "../core/cache/file-backed-cache-store.js";
import type { AdapterRegistry } from "../core/registry/adapter-registry.js";
import { createBundledAdapterRegistry } from "../core/registry/register-bundled-adapters.js";
import { SourceRegistry } from "../core/registry/source-registry.js";
import { FileBackedSourceRegistryStore } from "../core/registry/source-registry-store.js";
import { RawArtifactIndex } from "../core/ingestion/raw-artifact-index.js";
import { SQLiteWorkbenchEntityStore } from "../core/store/index.js";
import { Scanner } from "../core/ingestion/scanner.js";
import { WatchOrchestrator } from "../core/watcher/watch-orchestrator.js";
import { createInProcessScanJobRunner, type ScanJobRunner } from "./scan-job-runner.js";
import { syncMissingCurrentRunsFromCacheToEntityStore } from "./workbench-entity-store-sync.js";

export interface WorkbenchRuntimeOptions {
  appDataDir?: string;
  projectDir?: string;
}

export interface WorkbenchRuntime {
  appDataDir: string;
  adapterRegistry: AdapterRegistry;
  cacheStore: FileBackedCacheStore;
  entityStore: SQLiteWorkbenchEntityStore;
  ensureEntityStoreReady(): Promise<void>;
  getEntityStoreHydrationState(): Promise<WorkbenchEntityStoreHydrationState>;
  projectDir: string;
  rawArtifactIndex: RawArtifactIndex;
  scanJobRunner: ScanJobRunner;
  scanner: Scanner;
  sourceRegistry: SourceRegistry;
  watchOrchestrator: WatchOrchestrator;
}

export interface WorkbenchSourceHydrationState {
  sourceId: string;
  status: "cache-fallback" | "store-ready";
  reason?: string;
}

export interface WorkbenchEntityStoreHydrationState {
  failedSourceIds: string[];
  sourceStates: WorkbenchSourceHydrationState[];
}

export function createWorkbenchRuntime(
  options: WorkbenchRuntimeOptions = {}
): WorkbenchRuntime {
  const projectDir = options.projectDir ?? process.cwd();
  const appDataDir =
    options.appDataDir ?? path.join(projectDir, ".agent-workbench");
  const adapterRegistry = createBundledAdapterRegistry();
  const sourceRegistry = new SourceRegistry(
    new FileBackedSourceRegistryStore(path.join(appDataDir, "sources.json"))
  );
  const rawArtifactIndex = new RawArtifactIndex(
    path.join(appDataDir, "raw-artifact-index.json")
  );
  const cacheStore = new FileBackedCacheStore(
    path.join(appDataDir, "normalized-cache.json")
  );
  const entityStore = new SQLiteWorkbenchEntityStore({
    artifactBlobRootDir: path.join(appDataDir, "artifact-blobs"),
    databasePath: path.join(appDataDir, "workbench.sqlite")
  });
  const watchOrchestrator = new WatchOrchestrator({
    async onSourceCacheStale(event) {
      const source = await sourceRegistry.getSource(event.sourceId);
      const reason = event.reason ?? "Watch event marked the source cache stale.";

      if (!source) {
        return;
      }

      await sourceRegistry.saveCacheSummary(event.sourceId, {
        status: "stale",
        diagnostics: source.cache.diagnostics,
        ...(source.cache.cacheKey ? { cacheKey: source.cache.cacheKey } : {}),
        reason
      });
      await sourceRegistry.saveScanSummary(event.sourceId, {
        ...source.scan,
        status: source.scan.status === "never-scanned" ? "never-scanned" : "stale",
        diagnostics: source.scan.diagnostics,
        reason
      });
    }
  });
  const scanner = new Scanner({
    adapterRegistry,
    cacheStore,
    entityStore,
    projectDir,
    rawArtifactIndex,
    sourceRegistry,
    watchOrchestrator
  });

  const runtime = {
    appDataDir,
    adapterRegistry,
    cacheStore,
    entityStore,
    ensureEntityStoreReady: undefined as unknown as () => Promise<void>,
    getEntityStoreHydrationState: undefined as unknown as () => Promise<WorkbenchEntityStoreHydrationState>,
    projectDir,
    rawArtifactIndex,
    scanJobRunner: undefined as unknown as ScanJobRunner,
    scanner,
    sourceRegistry,
    watchOrchestrator
  };

  runtime.scanJobRunner = createInProcessScanJobRunner({
    getScanner: () => runtime.scanner
  });
  let entityStoreReady = false;
  let entityStoreHydrationState: WorkbenchEntityStoreHydrationState = {
    failedSourceIds: [],
    sourceStates: []
  };
  let entityStoreReadyPromise:
    | Promise<Awaited<ReturnType<typeof syncMissingCurrentRunsFromCacheToEntityStore>>>
    | undefined;

  runtime.ensureEntityStoreReady = async () => {
    if (entityStoreReady) {
      return;
    }

    const hydrationPromise =
      entityStoreReadyPromise ??= syncMissingCurrentRunsFromCacheToEntityStore(runtime);

    try {
      const result = await hydrationPromise;

      entityStoreHydrationState = {
        failedSourceIds: [...result.failedSourceIds],
        sourceStates: result.sourceStates.map((state) => ({ ...state }))
      };

      if (result.failedSourceIds.length === 0) {
        entityStoreReady = true;
      }
    } finally {
      if (entityStoreReadyPromise === hydrationPromise) {
        entityStoreReadyPromise = undefined;
      }
    }
  };
  runtime.getEntityStoreHydrationState = async () => {
    await runtime.ensureEntityStoreReady();

    return {
      failedSourceIds: [...entityStoreHydrationState.failedSourceIds],
      sourceStates: entityStoreHydrationState.sourceStates.map((state) => ({ ...state }))
    };
  };

  return runtime;
}
