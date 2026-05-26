import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import { createScannedRuntime } from "../ipc/triage-test-runtime.js";

describe("workbench runtime hydration hardening", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("retries bootstrap hydration after a failed attempt instead of caching the rejection", async () => {
    const runtime = await createTempRuntime(tempDirs);
    let listLatestRecordsCalls = 0;

    runtime.cacheStore.listLatestRecords = async () => {
      listLatestRecordsCalls += 1;

      if (listLatestRecordsCalls === 1) {
        throw new Error("Simulated bootstrap cache read failure.");
      }

      return [];
    };

    await expect(runtime.ensureEntityStoreReady()).rejects.toThrow(
      "Simulated bootstrap cache read failure."
    );
    await expect(runtime.ensureEntityStoreReady()).resolves.toBeUndefined();
    expect(listLatestRecordsCalls).toBe(2);
  });

  it("hydrates healthy sources while retrying failed cache imports on later bootstrap passes", async () => {
    const seedRuntime = await createScannedRuntime(tempDirs);
    const runtime = await createTempRuntime(tempDirs);
    const sourceRecords = (await seedRuntime.sourceRegistry.listSources()).slice(0, 2);
    const sourceIds = new Set(sourceRecords.map((source) => source.sourceId));
    const cacheRecords = (await seedRuntime.cacheStore.listLatestRecords()).filter((record) =>
      sourceIds.has(record.sourceId)
    );
    const failingRecord = cacheRecords[0];
    const healthyRecord = cacheRecords[1];
    const beginIngestRunAttempts = new Map<string, number>();
    const originalBeginIngestRun = runtime.entityStore.beginIngestRun.bind(runtime.entityStore);

    expect(sourceRecords).toHaveLength(2);
    expect(cacheRecords).toHaveLength(2);

    if (!failingRecord || !healthyRecord) {
      throw new Error("Expected two scanned cache records for bootstrap hydration.");
    }

    for (const source of sourceRecords) {
      await runtime.sourceRegistry.replaceSource(source);
    }

    for (const record of cacheRecords) {
      await runtime.cacheStore.writeRecord(record);
    }

    runtime.entityStore.beginIngestRun = async (input) => {
      const attempt = (beginIngestRunAttempts.get(input.sourceId) ?? 0) + 1;

      beginIngestRunAttempts.set(input.sourceId, attempt);

      if (input.sourceId === failingRecord.sourceId && attempt === 1) {
        throw new Error("Simulated bootstrap cache import failure.");
      }

      return originalBeginIngestRun(input);
    };

    await expect(runtime.ensureEntityStoreReady()).resolves.toBeUndefined();
    await expect(
      runtime.entityStore.getCurrentIngestRun({ sourceId: healthyRecord.sourceId })
    ).resolves.toBeDefined();
    await expect(
      runtime.entityStore.getCurrentIngestRun({ sourceId: failingRecord.sourceId })
    ).resolves.toBeUndefined();
    expect(beginIngestRunAttempts.get(healthyRecord.sourceId)).toBe(1);
    expect(beginIngestRunAttempts.get(failingRecord.sourceId)).toBe(1);

    await expect(runtime.ensureEntityStoreReady()).resolves.toBeUndefined();
    await expect(
      runtime.entityStore.getCurrentIngestRun({ sourceId: failingRecord.sourceId })
    ).resolves.toBeDefined();
    expect(beginIngestRunAttempts.get(healthyRecord.sourceId)).toBe(1);
    expect(beginIngestRunAttempts.get(failingRecord.sourceId)).toBe(2);
  });

  it("tracks per-source fallback hydration state when one cache import fails", async () => {
    const seedRuntime = await createScannedRuntime(tempDirs);
    const runtime = await createTempRuntime(tempDirs);
    const sourceRecords = (await seedRuntime.sourceRegistry.listSources()).slice(0, 2);
    const sourceIds = new Set(sourceRecords.map((source) => source.sourceId));
    const cacheRecords = (await seedRuntime.cacheStore.listLatestRecords()).filter((record) =>
      sourceIds.has(record.sourceId)
    );
    const failingRecord = cacheRecords[0];
    const healthyRecord = cacheRecords[1];
    const originalBeginIngestRun = runtime.entityStore.beginIngestRun.bind(runtime.entityStore);

    expect(sourceRecords).toHaveLength(2);
    expect(cacheRecords).toHaveLength(2);
    if (!failingRecord || !healthyRecord) {
      throw new Error("Expected two scanned cache records for bootstrap hydration.");
    }

    for (const source of sourceRecords) {
      await runtime.sourceRegistry.replaceSource(source);
    }

    for (const record of cacheRecords) {
      await runtime.cacheStore.writeRecord(record);
    }

    runtime.entityStore.beginIngestRun = async (input) => {
      if (input.sourceId === failingRecord.sourceId) {
        throw new Error("Simulated bootstrap cache import failure.");
      }

      return originalBeginIngestRun(input);
    };

    const hydrationState = await runtime.getEntityStoreHydrationState();

    expect(hydrationState.failedSourceIds).toEqual([failingRecord.sourceId]);
    expect(hydrationState.sourceStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: healthyRecord.sourceId,
          status: "store-ready"
        }),
        expect.objectContaining({
          sourceId: failingRecord.sourceId,
          status: "cache-fallback",
          reason: expect.stringContaining("entity-store hydration failed")
        })
      ])
    );
  });
});

async function createTempRuntime(tempDirs: string[]) {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-workbench-runtime-"));

  tempDirs.push(appDataDir);
  return createWorkbenchRuntime({
    appDataDir,
    projectDir: process.cwd()
  });
}
