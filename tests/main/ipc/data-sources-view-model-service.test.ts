import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDataSourcesViewModelService } from "../../../src/main/app/data-sources-view-model-service.js";
import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import {
  dataSourcesViewModelSchema,
  dataSourceViewModelSchema,
  type DataSourceViewModel
} from "../../../src/main/ipc/view-models.js";

const fakeFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);

describe("data sources view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("lists harness metadata and empty source state with strict DTOs", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const service = createDataSourcesViewModelService({ runtime });
    const viewModel = await service.listDataSources();

    expect(() => dataSourcesViewModelSchema.parse(viewModel)).not.toThrow();
    expect(viewModel.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapterId: "fake-test",
          displayName: "Fake Test Harness"
        })
      ])
    );
    expect(viewModel.sources).toEqual([]);
  });

  it("keeps validate and scan separate while preserving explicit source truth states", async () => {
    const runtime = await createTempRuntime(tempDirs);
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

    expect(addedSource.validationStatus).toBe("Not Validated");
    expect(addedSource.scanStatus).toBe("Never Scanned");
    expect(addedSource.watchSupport).toBe("Watch Unknown");

    const afterValidate = await service.validateDataSource({ sourceId: addedSource.sourceId });
    const validatedSource = findSource(afterValidate, addedSource.sourceId);

    expect(validatedSource.validationStatus).toBe("Valid");
    expect(validatedSource.scanStatus).toBe("Never Scanned");
    expect(validatedSource.cacheStatus).toBe("Unknown");

    const afterScan = await service.scanDataSource({ sourceId: validatedSource.sourceId });
    const scannedSource = findSource(afterScan, validatedSource.sourceId);

    expect(() => dataSourceViewModelSchema.parse(scannedSource)).not.toThrow();
    expect(scannedSource.scanStatus).toBe("Scanned with Diagnostics");
    expect(scannedSource.cacheStatus).toBe("Cached");
    expect(scannedSource.watchSupport).toBe("Watch Unsupported");
    expect(scannedSource.diagnosticCount).toBeGreaterThan(0);
    expect(JSON.stringify(scannedSource)).not.toMatch(/stack|rawEvents|child_process/u);
  });

  it("preserves validation failures and blocks scanning until validation succeeds", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const service = createDataSourcesViewModelService({ runtime });
    const invalid = await service.addDataSource({
      adapterId: "fake-test",
      rootPath: `${fakeFixturePath}.missing`
    });
    const invalidSource = invalid.sources[0];

    expect(invalidSource).toBeDefined();
    if (!invalidSource) {
      throw new Error("Expected the invalid source draft to be returned.");
    }

    const afterValidate = await service.validateDataSource({ sourceId: invalidSource.sourceId });
    const validated = findSource(afterValidate, invalidSource.sourceId);

    expect(validated.validationStatus).toBe("Validation Failed");
    expect(validated.diagnosticCount).toBeGreaterThan(0);
    await expect(service.scanDataSource({ sourceId: validated.sourceId })).rejects.toThrow(
      /validation/u
    );
  });

  it("rejects malformed DTO states", () => {
    expect(() =>
      dataSourceViewModelSchema.parse({
        sourceId: "source_1",
        adapterId: "fake-test",
        adapterDisplayName: "Fake Test Harness",
        rootPath: fakeFixturePath,
        enabled: true,
        enabledLabel: "Enabled",
        validationStatus: "Clean",
        scanStatus: "Cached",
        cacheStatus: "Cached",
        watchSupport: "Watch Unsupported",
        diagnosticCount: 0,
        capabilityBadges: [],
        diagnostics: []
      })
    ).toThrow();
  });
});

async function createTempRuntime(tempDirs: string[]) {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-data-sources-"));

  tempDirs.push(appDataDir);
  return createWorkbenchRuntime({
    appDataDir,
    projectDir: process.cwd()
  });
}

function findSource(
  viewModel: { sources: DataSourceViewModel[] },
  sourceId: string
): DataSourceViewModel {
  const source = viewModel.sources.find((candidate) => candidate.sourceId === sourceId);

  if (!source) {
    throw new Error(`Expected source '${sourceId}' to be present.`);
  }

  return source;
}
