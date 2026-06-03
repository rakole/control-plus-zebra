import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import type { SourceUpdateSignalEvent, WatchLifecycleRecord } from "../core/watcher/index.js";
import type { SourceId } from "../core/model/identifiers.js";
import type { SourceRecord, SourceRegistry } from "../core/registry/source-registry.js";
import { getSourceOperationFlags } from "../core/registry/source-registry.js";
import type { WatchOrchestrator } from "../core/watcher/watch-orchestrator.js";
import type { Scanner } from "../core/ingestion/scanner.js";
import type { ScanJobRunner } from "./scan-job-runner.js";

export interface BackgroundScanSchedulerStatus {
  activeBackgroundScans: number;
  coalescingSources: number;
  lastBackgroundScanAt?: string;
  queuedScans: number;
  watchingSources: number;
}

export interface BackgroundScanSchedulerOptions {
  coalesceMs?: number;
  getScanJobRunner?: () => ScanJobRunner;
  maxConcurrentScans?: number;
  onScanComplete?: (sourceId: SourceId) => Promise<void> | void;
  scanner: Scanner;
  scanJobRunner?: ScanJobRunner;
  sourceRegistry: SourceRegistry;
  watchOrchestrator: WatchOrchestrator;
}

interface QueueEntry {
  reason: string;
  sourceId: SourceId;
}

export class BackgroundScanScheduler {
  readonly #coalesceMs: number;
  readonly #maxConcurrentScans: number;
  readonly #onScanComplete: ((sourceId: SourceId) => Promise<void> | void) | undefined;
  readonly #queue = new Map<SourceId, QueueEntry>();
  readonly #running = new Set<SourceId>();
  readonly #scanner: Scanner;
  readonly #getScanJobRunner: () => ScanJobRunner;
  readonly #sourceRegistry: SourceRegistry;
  readonly #timers = new Map<SourceId, ReturnType<typeof setTimeout>>();
  readonly #watchOrchestrator: WatchOrchestrator;
  readonly #watchers = new Map<string, FSWatcher>();
  #draining = false;
  #lastBackgroundScanAt: string | undefined;
  #watchingSources = new Set<SourceId>();

  constructor(options: BackgroundScanSchedulerOptions) {
    this.#coalesceMs = options.coalesceMs ?? 1000;
    this.#maxConcurrentScans = options.maxConcurrentScans ?? 1;
    this.#onScanComplete = options.onScanComplete;
    this.#scanner = options.scanner;
    this.#getScanJobRunner =
      options.getScanJobRunner ?? (() => expectScanJobRunner(options.scanJobRunner));
    this.#sourceRegistry = options.sourceRegistry;
    this.#watchOrchestrator = options.watchOrchestrator;
  }

  getStatus(): BackgroundScanSchedulerStatus {
    return {
      activeBackgroundScans: this.#running.size,
      coalescingSources: this.#timers.size,
      ...(this.#lastBackgroundScanAt ? { lastBackgroundScanAt: this.#lastBackgroundScanAt } : {}),
      queuedScans: this.#queue.size,
      watchingSources: this.#watchingSources.size
    };
  }

  async runStartupRefresh(): Promise<void> {
    const sources = await this.#sourceRegistry.listSources();

    this.restorePersistedWatchPlans(sources);

    for (const source of sources) {
      if (!isRefreshEligibleSource(source)) {
        continue;
      }

      if (source.scan.status === "never-scanned" || source.scan.status === "stale" || source.cache.status === "stale") {
        this.enqueue(source.sourceId, "Startup refresh found a source that needs scanning.");
        continue;
      }

      if (source.scan.status !== "cached" && source.cache.status !== "cached") {
        continue;
      }

      let reconciled: SourceRecord;

      try {
        reconciled = await this.#scanner.reconcileSource(source.sourceId);
      } catch {
        continue;
      }

      if (reconciled.scan.status === "stale" || reconciled.cache.status === "stale") {
        this.enqueue(source.sourceId, "Startup reconciliation detected changed artifacts.");
      }
    }
  }

  handleWatchUpdateSignal(event: SourceUpdateSignalEvent): void {
    this.enqueue(event.sourceId, event.reason ?? "Watch event signaled source updates.");
  }

  enqueue(sourceId: SourceId, reason: string): void {
    const existingTimer = this.#timers.get(sourceId);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.#timers.set(
      sourceId,
      setTimeout(() => {
        this.#timers.delete(sourceId);
        this.#queue.set(sourceId, { sourceId, reason });
        void this.drain();
      }, this.#coalesceMs)
    );
  }

  async drain(): Promise<void> {
    if (this.#draining) {
      return;
    }

    this.#draining = true;

    try {
      while (this.#running.size < this.#maxConcurrentScans && this.#queue.size > 0) {
        const entry = this.#queue.values().next().value as QueueEntry | undefined;

        if (!entry) {
          break;
        }

        this.#queue.delete(entry.sourceId);
        const source = await this.#sourceRegistry.getSource(entry.sourceId);

        if (!source || !isRefreshEligibleSource(source)) {
          continue;
        }

        if (source.scan.status !== "stale" && source.cache.status !== "stale" && source.scan.status !== "never-scanned") {
          continue;
        }

        await this.runScan(entry);
      }
    } finally {
      this.#draining = false;

      if (this.#queue.size > 0 && this.#running.size < this.#maxConcurrentScans) {
        void this.drain();
      }
    }
  }

  restorePersistedWatchPlans(sources: SourceRecord[]): void {
    for (const source of sources) {
      if (!isRefreshEligibleSource(source) || source.watch.status !== "supported" || !source.watch.strategy) {
        continue;
      }

      const record: WatchLifecycleRecord = {
        adapterId: source.adapterId,
        sourceId: source.sourceId,
        status: source.watch.status,
        strategy: source.watch.strategy,
        scopePaths: source.watch.scopePaths ?? [],
        plannedAt: source.watch.plannedAt ?? source.watch.updatedAt ?? new Date().toISOString(),
        ...(source.watch.reason ? { reason: source.watch.reason } : {})
      };

      this.#watchOrchestrator.restoreRecord(record);
      this.startNativeWatchers(record);
    }
  }

  private async runScan(entry: QueueEntry): Promise<void> {
    this.#running.add(entry.sourceId);

    try {
      await this.#getScanJobRunner().scanSource(entry.sourceId);
      await this.#onScanComplete?.(entry.sourceId);
      const source = await this.#sourceRegistry.getSource(entry.sourceId);

      if (source) {
        this.restorePersistedWatchPlans([source]);
      }

      this.#lastBackgroundScanAt = new Date().toISOString();
    } catch {
      // The scan job runner persists bounded failure diagnostics. Background
      // scheduling must not turn a failed source into an unhandled rejection.
    } finally {
      this.#running.delete(entry.sourceId);
    }
  }

  private startNativeWatchers(record: WatchLifecycleRecord): void {
    if (record.strategy !== "native") {
      return;
    }

    for (const scopePath of record.scopePaths) {
      const watcherKey = `${record.sourceId}\0${scopePath}`;

      if (this.#watchers.has(watcherKey)) {
        continue;
      }

      try {
        const watcher = watch(
          scopePath,
          {
            recursive: process.platform === "darwin" || process.platform === "win32"
          },
          (_eventType, filename) => {
            const filenameText = typeof filename === "string" ? filename : undefined;
            const observedPath = filenameText ? path.join(scopePath, filenameText) : scopePath;

            void this.#watchOrchestrator.routeEvent({
              adapterId: record.adapterId,
              sourceId: record.sourceId,
              origin: "native",
              observedAt: new Date().toISOString(),
              scopePath: observedPath,
              reason: "Native filesystem watch event signaled source updates."
            });
          }
        );

        watcher.on("error", () => {
          this.#watchers.delete(watcherKey);
          this.#watchingSources.delete(record.sourceId);
        });
        this.#watchers.set(watcherKey, watcher);
        this.#watchingSources.add(record.sourceId);
      } catch {
        this.#watchers.delete(watcherKey);
      }
    }
  }
}

function expectScanJobRunner(scanJobRunner?: ScanJobRunner): ScanJobRunner {
  if (!scanJobRunner) {
    throw new Error("Background scan scheduler requires a scan job runner.");
  }

  return scanJobRunner;
}

function isRefreshEligibleSource(source: SourceRecord): boolean {
  const flags = getSourceOperationFlags(source);

  return (
    source.enabled &&
    source.sourceKind === "local-root" &&
    !source.readOnly &&
    flags.scan &&
    source.validation.status === "valid"
  );
}
