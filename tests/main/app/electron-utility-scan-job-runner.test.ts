import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDataSourcesViewModelService } from "../../../src/main/app/data-sources-view-model-service.js";
import { createElectronUtilityScanJobRunner } from "../../../src/main/app/electron-utility-scan-job-runner.js";
import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";

const fakeFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);
const fakeWorkerPath = path.resolve(".vite/build/scan-source-worker.js");

class FakeUtilityChild extends EventEmitter {
  readonly stderr = new EventEmitter();
}

describe("electron utility scan job runner", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("keeps the service responsive while a worker scan is pending and marks crashes as failed scans", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-utility-scan-runner-"));

    tempDirs.push(appDataDir);
    const runtime = createWorkbenchRuntime({
      appDataDir,
      projectDir: process.cwd()
    });
    const service = createDataSourcesViewModelService({ runtime });
    const afterAdd = await service.addDataSource({
      adapterId: "fake-test",
      displayName: "Fixture Source",
      rootPath: fakeFixturePath
    });
    const addedSource = afterAdd.sources[0];

    expect(addedSource).toBeDefined();
    if (!addedSource) {
      throw new Error("Expected the added source to be returned.");
    }

    const afterValidate = await service.validateDataSource({ sourceId: addedSource.sourceId });
    const validatedSource = afterValidate.sources.find(
      (source) => source.sourceId === addedSource.sourceId
    );

    expect(validatedSource?.validationStatus).toBe("Valid");

    let child: FakeUtilityChild | undefined;
    let resolveChildReady: (() => void) | undefined;
    const childReady = new Promise<void>((resolve) => {
      resolveChildReady = resolve;
    });
    runtime.scanJobRunner = createElectronUtilityScanJobRunner({
      appDataDir: runtime.appDataDir,
      forkUtilityProcess(modulePath) {
        expect(modulePath).toBe(fakeWorkerPath);
        child = new FakeUtilityChild();
        resolveChildReady?.();
        return child;
      },
      projectDir: runtime.projectDir,
      sourceRegistry: runtime.sourceRegistry,
      workerScriptPath: fakeWorkerPath
    });

    const scanPromise = service.scanDataSource({ sourceId: addedSource.sourceId });
    await childReady;
    const intermediate = await service.listDataSources();

    expect(intermediate.sources.find((source) => source.sourceId === addedSource.sourceId)).toBeDefined();
    expect(runtime.scanJobRunner.getActiveScanCount()).toBe(1);

    child?.stderr.emit("data", "worker stderr ".repeat(80));
    child?.emit("exit", 9);

    await expect(scanPromise).rejects.toThrow(/Scan worker exited/u);
    expect(runtime.scanJobRunner.getActiveScanCount()).toBe(0);

    const failedSource = await runtime.sourceRegistry.getSource(addedSource.sourceId);

    expect(failedSource?.scan.status).toBe("scan-failed");
    expect(failedSource?.cache.status).toBe("unknown");
    expect(failedSource?.scan.diagnostics.some((diagnostic) => diagnostic.code === "scanner.scan.worker-failed")).toBe(
      true
    );
    expect(failedSource?.scan.diagnostics.at(-1)?.message.length ?? 0).toBeLessThanOrEqual(512);
  });
});
