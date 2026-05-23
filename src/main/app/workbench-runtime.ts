import path from "node:path";

import { FileBackedCacheStore } from "../core/cache/file-backed-cache-store.js";
import type { AdapterRegistry } from "../core/registry/adapter-registry.js";
import { createBundledAdapterRegistry } from "../core/registry/register-bundled-adapters.js";
import { SourceRegistry } from "../core/registry/source-registry.js";
import { FileBackedSourceRegistryStore } from "../core/registry/source-registry-store.js";
import { RawArtifactIndex } from "../core/ingestion/raw-artifact-index.js";
import { Scanner } from "../core/ingestion/scanner.js";
import { WatchOrchestrator } from "../core/watcher/watch-orchestrator.js";

export interface WorkbenchRuntimeOptions {
  appDataDir?: string;
  projectDir?: string;
}

export interface WorkbenchRuntime {
  appDataDir: string;
  adapterRegistry: AdapterRegistry;
  cacheStore: FileBackedCacheStore;
  rawArtifactIndex: RawArtifactIndex;
  scanner: Scanner;
  sourceRegistry: SourceRegistry;
  watchOrchestrator: WatchOrchestrator;
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
  const watchOrchestrator = new WatchOrchestrator();
  const scanner = new Scanner({
    adapterRegistry,
    cacheStore,
    projectDir,
    rawArtifactIndex,
    sourceRegistry,
    watchOrchestrator
  });

  return {
    appDataDir,
    adapterRegistry,
    cacheStore,
    rawArtifactIndex,
    scanner,
    sourceRegistry,
    watchOrchestrator
  };
}
