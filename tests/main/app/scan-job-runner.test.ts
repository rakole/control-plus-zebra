import { describe, expect, it, vi } from "vitest";

import { createInProcessScanJobRunner } from "../../../src/main/app/scan-job-runner.js";

describe("in-process scan job runner", () => {
  it("dedupes identical requests but queues a same-source scan when the cutoff changes", async () => {
    let releaseFirstScan: (() => void) | undefined;
    const firstScanGate = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });
    const scanner = {
      scanSource: vi
        .fn()
        .mockImplementationOnce(async () => firstScanGate)
        .mockResolvedValueOnce(undefined)
    };
    const runner = createInProcessScanJobRunner({
      getScanner: () => scanner as never
    });

    const first = runner.scanSource("source-1");
    const duplicate = runner.scanSource("source-1");
    const withDifferentCutoff = runner.scanSource("source-1", {
      sessionStartedAtCutoff: "2026-06-01T00:00:00.000Z"
    });

    expect(duplicate).toBe(first);
    expect(scanner.scanSource).toHaveBeenCalledTimes(1);

    releaseFirstScan?.();
    await first;
    await withDifferentCutoff;

    expect(scanner.scanSource.mock.calls).toEqual([
      ["source-1", undefined],
      [
        "source-1",
        {
          sessionStartedAtCutoff: "2026-06-01T00:00:00.000Z"
        }
      ]
    ]);
  });

  it("holds same-source default scans until retention maintenance releases its lease", async () => {
    let releaseMaintenance: (() => void) | undefined;
    let releaseMaintenanceScan: (() => void) | undefined;
    const maintenanceScanGate = new Promise<void>((resolve) => {
      releaseMaintenanceScan = resolve;
    });
    const scanner = {
      scanSource: vi
        .fn()
        .mockImplementationOnce(async () => maintenanceScanGate)
        .mockResolvedValueOnce(undefined)
    };
    const runner = createInProcessScanJobRunner({
      getScanner: () => scanner as never
    });
    const maintenanceLease = await runner.acquireSourceMaintenanceLease("source-1");
    const maintenanceScan = runner.scanSource("source-1", {
      ignoreMaintenanceLease: true,
      sessionStartedAtCutoff: "2026-06-01T00:00:00.000Z"
    });
    const defaultScan = runner.scanSource("source-1");

    releaseMaintenance = () => {
      releaseMaintenanceScan?.();
      maintenanceLease.release();
    };

    await vi.waitFor(() => {
      expect(scanner.scanSource).toHaveBeenCalledTimes(1);
    });
    expect(scanner.scanSource).toHaveBeenNthCalledWith(1, "source-1", {
      ignoreMaintenanceLease: true,
      sessionStartedAtCutoff: "2026-06-01T00:00:00.000Z"
    });

    releaseMaintenance?.();
    await maintenanceScan;
    await defaultScan;

    expect(scanner.scanSource).toHaveBeenNthCalledWith(2, "source-1", undefined);
  });
});
