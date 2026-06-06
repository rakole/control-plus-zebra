import { describe, expect, it } from "vitest";

import { BackgroundScanScheduler } from "../../../src/main/app/background-scan-scheduler.js";
import type { ScanJobRunner } from "../../../src/main/app/scan-job-runner.js";
import type { Scanner } from "../../../src/main/core/ingestion/scanner.js";
import type { SourceRecord, SourceRegistry } from "../../../src/main/core/registry/source-registry.js";
import { WatchOrchestrator } from "../../../src/main/core/watcher/index.js";

describe("BackgroundScanScheduler", () => {
  it("refreshes only eligible local sources during startup", async () => {
    const sources = new Map<string, SourceRecord>([
      ["source-stale", buildSource({ sourceId: "source-stale", scanStatus: "stale", cacheStatus: "stale" })],
      ["source-never", buildSource({ sourceId: "source-never", scanStatus: "never-scanned" })],
      ["source-cached", buildSource({ sourceId: "source-cached", scanStatus: "cached", cacheStatus: "cached" })],
      ["source-archive", buildSource({ sourceId: "source-archive", sourceKind: "imported-archive", readOnly: true })],
      ["source-disabled", buildSource({ sourceId: "source-disabled", enabled: false })],
      ["source-invalid", buildSource({ sourceId: "source-invalid", validationStatus: "validation-failed" })]
    ]);
    const scannedSourceIds: string[] = [];
    const scheduler = createScheduler({
      sources,
      onReconcile(sourceId) {
        if (sourceId === "source-cached") {
          const next = buildSource({ sourceId, scanStatus: "stale", cacheStatus: "stale" });
          sources.set(sourceId, next);
          return next;
        }

        return sources.get(sourceId);
      },
      onScan(sourceId) {
        scannedSourceIds.push(sourceId);
      }
    });

    await scheduler.runStartupRefresh();
    await flushBackgroundWork();

    expect(scannedSourceIds.sort()).toEqual([
      "source-cached",
      "source-never",
      "source-stale"
    ]);
  });

  it("coalesces repeated same-source signals into one background scan", async () => {
    const source = buildSource({
      sourceId: "source-noisy",
      scanStatus: "stale",
      cacheStatus: "stale"
    });
    const sources = new Map([[source.sourceId, source]]);
    const scannedSourceIds: string[] = [];
    const scheduler = createScheduler({
      sources,
      onScan(sourceId) {
        scannedSourceIds.push(sourceId);
      }
    });

    scheduler.enqueue(source.sourceId, "first event");
    scheduler.enqueue(source.sourceId, "second event");
    scheduler.enqueue(source.sourceId, "third event");
    await flushBackgroundWork();

    expect(scannedSourceIds).toEqual(["source-noisy"]);
    expect(scheduler.getStatus()).toMatchObject({
      activeBackgroundScans: 0,
      queuedScans: 0,
      coalescingSources: 0
    });
  });

  it("reports failed background scans without leaving work queued", async () => {
    const source = buildSource({
      sourceId: "source-failed",
      scanStatus: "stale",
      cacheStatus: "stale"
    });
    const sources = new Map([[source.sourceId, source]]);
    const failedSources: Array<{ error: unknown; sourceId: string }> = [];
    const scheduler = createScheduler({
      sources,
      onScan() {
        throw new Error("worker failed");
      },
      onScanFailed(sourceId, error) {
        failedSources.push({ sourceId, error });
      }
    });

    scheduler.enqueue(source.sourceId, "changed artifact");
    await flushBackgroundWork();

    expect(failedSources).toHaveLength(1);
    expect(failedSources[0]?.sourceId).toBe("source-failed");
    expect(failedSources[0]?.error).toBeInstanceOf(Error);
    expect(scheduler.getStatus()).toMatchObject({
      activeBackgroundScans: 0,
      queuedScans: 0
    });
  });

  it("routes scoped watch update signals into coalesced scans", async () => {
    const source = buildSource({
      sourceId: "source-watch",
      scanStatus: "cached",
      cacheStatus: "cached",
      watchStatus: "supported",
      watchStrategy: "poll",
      watchScopePaths: ["/tmp/source/chats"]
    });
    const sources = new Map([[source.sourceId, source]]);
    const scannedSourceIds: string[] = [];
    let scheduler: BackgroundScanScheduler;
    const watchOrchestrator = new WatchOrchestrator({
      onSourceCacheStale(event) {
        const current = sources.get(event.sourceId);

        if (current) {
          sources.set(event.sourceId, {
            ...current,
            scan: { ...current.scan, status: "stale" },
            cache: { ...current.cache, status: "stale" }
          });
        }
      },
      onSourceUpdateSignaled(event) {
        scheduler.handleWatchUpdateSignal(event);
      }
    });

    scheduler = createScheduler({
      sources,
      watchOrchestrator,
      onScan(sourceId) {
        scannedSourceIds.push(sourceId);
      }
    });

    await scheduler.runStartupRefresh();
    const accepted = await watchOrchestrator.routeEvent({
      adapterId: source.adapterId,
      sourceId: source.sourceId,
      origin: "poll",
      observedAt: "2026-05-30T00:00:00.000Z",
      scopePath: "/tmp/source/chats/session-1.jsonl"
    });
    const rejected = await watchOrchestrator.routeEvent({
      adapterId: source.adapterId,
      sourceId: source.sourceId,
      origin: "poll",
      observedAt: "2026-05-30T00:00:01.000Z",
      scopePath: "/tmp/source/outside/session-2.jsonl"
    });
    await flushBackgroundWork();

    expect(accepted.accepted).toBe(true);
    expect(rejected.accepted).toBe(false);
    expect(scannedSourceIds).toEqual(["source-watch"]);
  });
});

function createScheduler(options: {
  sources: Map<string, SourceRecord>;
  onReconcile?: (sourceId: string) => SourceRecord | undefined;
  onScan?: (sourceId: string) => void;
  onScanFailed?: (sourceId: string, error: unknown) => void;
  watchOrchestrator?: WatchOrchestrator;
}): BackgroundScanScheduler {
  const sourceRegistry = {
    async getSource(sourceId: string) {
      return options.sources.get(sourceId);
    },
    async listSources() {
      return [...options.sources.values()];
    }
  } as SourceRegistry;
  const scanner = {
    async reconcileSource(sourceId: string) {
      const source = options.onReconcile?.(sourceId) ?? options.sources.get(sourceId);

      if (!source) {
        throw new Error(`Missing test source '${sourceId}'.`);
      }

      return source;
    }
  } as Scanner;
  const scanJobRunner: ScanJobRunner = {
    getActiveScanCount() {
      return 0;
    },
    async scanSource(sourceId) {
      options.onScan?.(sourceId);
    }
  };

  return new BackgroundScanScheduler({
    coalesceMs: 0,
    scanner,
    ...(options.onScanFailed ? { onScanFailed: options.onScanFailed } : {}),
    scanJobRunner,
    sourceRegistry,
    watchOrchestrator: options.watchOrchestrator ?? new WatchOrchestrator()
  });
}

function buildSource(input: {
  sourceId: string;
  cacheStatus?: SourceRecord["cache"]["status"];
  enabled?: boolean;
  readOnly?: boolean;
  scanStatus?: SourceRecord["scan"]["status"];
  sourceKind?: SourceRecord["sourceKind"];
  validationStatus?: SourceRecord["validation"]["status"];
  watchScopePaths?: string[];
  watchStatus?: SourceRecord["watch"]["status"];
  watchStrategy?: SourceRecord["watch"]["strategy"];
}): SourceRecord {
  return {
    sourceId: input.sourceId,
    adapterId: "fake-test",
    rootPath: `/tmp/${input.sourceId}`,
    enabled: input.enabled ?? true,
    sourceKind: input.sourceKind ?? "local-root",
    addedBy: input.sourceKind === "imported-archive" ? "import" : "user",
    readOnly: input.readOnly ?? false,
    validation: {
      status: input.validationStatus ?? "valid",
      diagnostics: []
    },
    scan: {
      status: input.scanStatus ?? "cached",
      diagnostics: []
    },
    cache: {
      status: input.cacheStatus ?? "cached",
      diagnostics: []
    },
    watch: {
      status: input.watchStatus ?? "unknown",
      ...(input.watchStrategy ? { strategy: input.watchStrategy } : {}),
      scopePaths: input.watchScopePaths ?? [],
      plannedAt: "2026-05-30T00:00:00.000Z"
    },
    diagnostics: [],
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z"
  };
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
