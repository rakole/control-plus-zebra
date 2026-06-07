import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FileBackedAppSettingsStore
} from "../../../src/main/app/app-settings-store.js";
import { createRetentionMaintenanceService } from "../../../src/main/app/retention-maintenance-service.js";
import { FileBackedSourceRegistryStore, SourceRegistry } from "../../../src/main/core/registry/index.js";
import type { SourceRecord } from "../../../src/main/core/registry/source-registry.js";

describe("retention maintenance service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("only clears and rescans local writable enabled valid sources, then finalizes settings after success", async () => {
    const harness = await createHarness();
    tempDirs.push(harness.tempDir);
    const eligible = await createScannedSource(harness.sourceRegistry, "eligible");
    const disabled = await createScannedSource(harness.sourceRegistry, "disabled", { enabled: false });
    const invalid = await createScannedSource(harness.sourceRegistry, "invalid", { valid: false });
    let releaseScan: (() => void) | undefined;
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });

    harness.scanJobRunner.scanSource.mockImplementation(async () => scanGate);

    const result = await harness.service.updateSettings({
      retentionDays: 30,
      confirmDestructiveRescan: true
    });

    expect(result).toMatchObject({
      status: "job-started",
      settings: { retentionDays: 7 },
      job: expect.objectContaining({
        retentionDays: 30
      })
    });
    await expect(harness.appSettingsStore.load()).resolves.toEqual({
      retentionDays: 7
    });
    expect(harness.cacheStore.replaceSourceRecords).toHaveBeenCalledWith([eligible.sourceId], []);
    expect(harness.rawArtifactIndex.replaceSourceEntries).toHaveBeenCalledWith(eligible.sourceId, []);
    expect(harness.entityStore.clearCurrentIngestRun).toHaveBeenCalledWith({
      sourceId: eligible.sourceId
    });
    expect(harness.entityStore.cleanupStaleRuns).toHaveBeenCalledWith({
      beforeUpdatedAt: expect.any(String),
      preservePublished: false,
      sourceId: eligible.sourceId
    });
    await vi.waitFor(() => {
      expect(harness.scanJobRunner.scanSource).toHaveBeenCalledWith(eligible.sourceId, {
        ignoreMaintenanceLease: true,
        sessionStartedAtCutoff: expect.any(String)
      });
    });
    expect(harness.scanJobRunner.scanSource).not.toHaveBeenCalledWith(
      disabled.sourceId,
      expect.anything()
    );
    expect(harness.scanJobRunner.scanSource).not.toHaveBeenCalledWith(
      invalid.sourceId,
      expect.anything()
    );

    const disabledAfter = await harness.sourceRegistry.getSource(disabled.sourceId);
    const invalidAfter = await harness.sourceRegistry.getSource(invalid.sourceId);

    expect(disabledAfter?.scan.status).toBe("cached");
    expect(invalidAfter?.scan.status).toBe("cached");

    releaseScan?.();

    await vi.waitFor(async () => {
      await expect(harness.appSettingsStore.load()).resolves.toEqual({
        retentionDays: 30
      });
      expect(harness.service.getStatus().state).toBe("idle");
    });
  });

  it("keeps persisted settings unchanged when destructive maintenance fails", async () => {
    const harness = await createHarness();
    tempDirs.push(harness.tempDir);

    await createScannedSource(harness.sourceRegistry, "eligible");
    harness.scanJobRunner.scanSource.mockRejectedValue(new Error("simulated rescan failure"));

    const result = await harness.service.updateSettings({
      retentionDays: 30,
      confirmDestructiveRescan: true
    });

    expect(result.status).toBe("job-started");
    await vi.waitFor(() => {
      expect(harness.service.getStatus()).toMatchObject({
        state: "failed",
        retentionDays: 30,
        completedSources: 0,
        totalSources: 1
      });
    });
    expect(harness.service.getStatus().message).toContain("simulated rescan failure");
    await expect(harness.appSettingsStore.load()).resolves.toEqual({
      retentionDays: 7
    });
  });

  it("clears and rescans each source in sequence so later sources stay untouched after a failure", async () => {
    const harness = await createHarness();
    tempDirs.push(harness.tempDir);
    const first = await createScannedSource(harness.sourceRegistry, "first");
    const second = await createScannedSource(harness.sourceRegistry, "second");
    const third = await createScannedSource(harness.sourceRegistry, "third");

    harness.scanJobRunner.scanSource
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second source rescan failed"));

    const result = await harness.service.updateSettings({
      retentionDays: 30,
      confirmDestructiveRescan: true
    });

    expect(result.status).toBe("job-started");

    await vi.waitFor(() => {
      expect(harness.service.getStatus()).toMatchObject({
        state: "failed",
        retentionDays: 30,
        completedSources: 1,
        totalSources: 3
      });
    });
    expect(harness.service.getStatus().message).toContain("second source rescan failed");

    expect(harness.cacheStore.replaceSourceRecords).toHaveBeenCalledTimes(2);
    expect(harness.scanJobRunner.scanSource).toHaveBeenCalledTimes(2);
    await expect(harness.appSettingsStore.load()).resolves.toEqual({
      retentionDays: 7
    });

    const sourceStates = await Promise.all([
      harness.sourceRegistry.getSource(first.sourceId),
      harness.sourceRegistry.getSource(second.sourceId),
      harness.sourceRegistry.getSource(third.sourceId)
    ]);

    expect(sourceStates.filter((source) => source?.scan.status === "cached")).toHaveLength(1);
    expect(sourceStates.filter((source) => source?.cache.status === "cached")).toHaveLength(1);
    expect(sourceStates.some((source) => source?.scan.status === "never-scanned")).toBe(true);
  });

  it("releases maintenance source leases only after the new setting is persisted", async () => {
    const harness = await createHarness();
    tempDirs.push(harness.tempDir);
    await createScannedSource(harness.sourceRegistry, "eligible");
    let releaseMaintenanceScan: (() => void) | undefined;
    const maintenanceScanGate = new Promise<void>((resolve) => {
      releaseMaintenanceScan = resolve;
    });
    const releasedWithSettings = vi.fn<(settings: { retentionDays: 3 | 7 | 30 }) => void>();

    const releaseLease = vi.fn(() => {
      void harness.appSettingsStore.load().then((settings) => {
        releasedWithSettings(settings);
      });
    });

    harness.scanJobRunner.acquireSourceMaintenanceLease.mockImplementationOnce(async () => ({
      release: releaseLease
    }));
    harness.scanJobRunner.scanSource.mockImplementationOnce(async () => maintenanceScanGate);

    const result = await harness.service.updateSettings({
      retentionDays: 30,
      confirmDestructiveRescan: true
    });

    expect(result.status).toBe("job-started");

    await vi.waitFor(() => {
      expect(harness.scanJobRunner.acquireSourceMaintenanceLease).toHaveBeenCalledTimes(1);
      expect(harness.scanJobRunner.scanSource).toHaveBeenNthCalledWith(1, expect.any(String), {
        ignoreMaintenanceLease: true,
        sessionStartedAtCutoff: expect.any(String)
      });
    });
    expect(releasedWithSettings).not.toHaveBeenCalled();

    releaseMaintenanceScan?.();

    await vi.waitFor(() => {
      expect(releasedWithSettings).toHaveBeenCalledWith({
        retentionDays: 30
      });
    });
    await expect(harness.appSettingsStore.load()).resolves.toEqual({
      retentionDays: 30
    });
  });
});

async function createHarness() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-retention-maintenance-"));
  const appSettingsStore = new FileBackedAppSettingsStore(tempDir);
  const sourceRegistry = new SourceRegistry(
    new FileBackedSourceRegistryStore(path.join(tempDir, "sources.json"))
  );
  const cacheStore = {
    listLatestRecords: vi.fn(async () => []),
    replaceSourceRecords: vi.fn(async () => {})
  };
  const rawArtifactIndex = {
    replaceSourceEntries: vi.fn(async () => {})
  };
  const entityStore = {
    clearCurrentIngestRun: vi.fn(async () => {}),
    cleanupStaleRuns: vi.fn(async () => ({
      removedCount: 0,
      removedIngestRunIds: []
    }))
  };
  const scanJobRunner = {
    acquireSourceMaintenanceLease: vi.fn(async () => ({
      release: vi.fn()
    })),
    getActiveScanCount: vi.fn(() => 0),
    scanSource: vi.fn(async () => {})
  };

  await appSettingsStore.save({ retentionDays: 7 });

  const service = createRetentionMaintenanceService({
    runtime: {
      appSettingsStore,
      cacheStore,
      entityStore,
      rawArtifactIndex,
      scanJobRunner,
      sourceRegistry
    } as never
  });

  return {
    appSettingsStore,
    cacheStore,
    entityStore,
    rawArtifactIndex,
    scanJobRunner,
    service,
    sourceRegistry,
    tempDir
  };
}

async function createScannedSource(
  sourceRegistry: SourceRegistry,
  name: string,
  options: {
    enabled?: boolean;
    valid?: boolean;
  } = {}
): Promise<SourceRecord> {
  const source = await sourceRegistry.createSource({
    adapterId: "fake-test",
    enabled: options.enabled ?? true,
    rootPath: path.join("/tmp", `${name}.fixture.json`)
  });

  await sourceRegistry.saveValidationSummary(source.sourceId, {
    status: options.valid === false ? "validation-failed" : "valid",
    diagnostics: []
  });
  await sourceRegistry.saveScanSummary(source.sourceId, {
    status: "cached",
    diagnostics: []
  });
  return sourceRegistry.saveCacheSummary(source.sourceId, {
    status: "cached",
    diagnostics: []
  });
}
