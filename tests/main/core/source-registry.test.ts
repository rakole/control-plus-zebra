import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDiagnostic } from "../../../src/main/core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import {
  SourceRegistry,
  FileBackedSourceRegistryStore,
  getSourceOperationFlags,
  isImportedArchiveSource
} from "../../../src/main/core/registry/index.js";

async function createRegistryHarness() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-source-registry-"));
  const filePath = path.join(tempDir, "sources.json");
  const store = new FileBackedSourceRegistryStore(filePath);

  return {
    filePath,
    registry: new SourceRegistry(store),
    store
  };
}

describe("SourceRegistry", () => {
  it("persists source records with harness-neutral fields and reloads them", async () => {
    const { filePath, registry, store } = await createRegistryHarness();
    const created = await registry.createSource({
      adapterId: "fake-test",
      displayName: "Fixture Source",
      rootPath: "/tmp/fake-source.json"
    });

    await registry.setSourceEnabled(created.sourceId, false);

    const reloadedRegistry = new SourceRegistry(store);
    const [reloaded] = await reloadedRegistry.listSources();

    expect(reloaded).toMatchObject({
      sourceId: created.sourceId,
      adapterId: "fake-test",
      displayName: "Fixture Source",
      rootPath: "/tmp/fake-source.json",
      enabled: false
    });
    expect(reloaded?.validation.status).toBe("not-validated");
    expect(reloaded?.scan.status).toBe("never-scanned");
    expect(reloaded?.cache.status).toBe("unknown");

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.version).toBe(2);
    expect(persisted.records).toHaveLength(1);
  });

  it("preserves validation failure diagnostics across reloads", async () => {
    const { store, registry } = await createRegistryHarness();
    const created = await registry.createSource({
      adapterId: "fake-test",
      rootPath: "/tmp/missing-fixture.json"
    });
    const diagnostic = buildDiagnostic(
      "fake-test",
      "source.validation.failed",
      "Fixture path is missing.",
      "error",
      "source",
      HIGH_CONFIDENCE,
      {
        sourceId: created.sourceId,
        nativeId: "/tmp/missing-fixture.json"
      }
    );

    await registry.saveValidationSummary(created.sourceId, {
      status: "validation-failed",
      diagnostics: [diagnostic],
      normalizedPath: "/tmp/missing-fixture.json"
    });

    const reloaded = await new SourceRegistry(store).getSource(created.sourceId);

    expect(reloaded?.validation.status).toBe("validation-failed");
    expect(reloaded?.validation.diagnostics).toEqual([diagnostic]);
    expect(reloaded?.diagnostics).toEqual([diagnostic]);
  });

  it("persists durable watch plan fields across reloads", async () => {
    const { store, registry } = await createRegistryHarness();
    const created = await registry.createSource({
      adapterId: "fake-test",
      rootPath: "/tmp/watchable-source.json"
    });

    await registry.saveWatchPlan({
      adapterId: "fake-test",
      sourceId: created.sourceId,
      status: "supported",
      strategy: "poll",
      scopePaths: ["/tmp/watchable-source.json", "/tmp/watchable-sidecars"],
      reason: "Poll the fixture source and sidecar directory.",
      plannedAt: "2026-05-24T09:00:00.000Z"
    });

    const reloaded = await new SourceRegistry(store).getSource(created.sourceId);
    const persisted = JSON.parse(await readFile(store.getFilePath(), "utf8"));

    expect(reloaded?.watch).toMatchObject({
      status: "supported",
      strategy: "poll",
      scopePaths: ["/tmp/watchable-source.json", "/tmp/watchable-sidecars"],
      reason: "Poll the fixture source and sidecar directory.",
      plannedAt: "2026-05-24T09:00:00.000Z"
    });
    expect(persisted.version).toBe(2);
  });

  it("loads version 1 registry files and backfills empty watch scope paths", async () => {
    const { filePath, store } = await createRegistryHarness();

    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          records: [
            {
              sourceId: "fake-test:/tmp/legacy.json",
              adapterId: "fake-test",
              rootPath: "/tmp/legacy.json",
              enabled: true,
              sourceKind: "local-root",
              addedBy: "user",
              readOnly: false,
              validation: {
                status: "not-validated",
                diagnostics: []
              },
              scan: {
                status: "never-scanned",
                diagnostics: []
              },
              cache: {
                status: "unknown",
                diagnostics: []
              },
              watch: {
                status: "unsupported",
                strategy: "none",
                reason: "Legacy registry payload"
              },
              diagnostics: [],
              createdAt: "2026-05-24T09:00:00.000Z",
              updatedAt: "2026-05-24T09:00:00.000Z"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const [reloaded] = await new SourceRegistry(store).listSources();

    expect(reloaded?.watch).toMatchObject({
      status: "unsupported",
      strategy: "none",
      reason: "Legacy registry payload",
      scopePaths: []
    });
  });

  it("keeps distinct source identities when adapter or root differs even with the same display name", async () => {
    const { registry } = await createRegistryHarness();
    const first = await registry.createSource({
      adapterId: "fake-test",
      displayName: "Shared Name",
      rootPath: "/tmp/one.json"
    });
    const second = await registry.createSource({
      adapterId: "fake-test",
      displayName: "Shared Name",
      rootPath: "/tmp/two.json"
    });
    const third = await registry.createSource({
      adapterId: "other-test",
      displayName: "Shared Name",
      rootPath: "/tmp/one.json"
    });

    expect(new Set([first.sourceId, second.sourceId, third.sourceId]).size).toBe(3);
  });

  it("persists imported archive metadata and read-only source semantics across reloads", async () => {
    const { store, registry } = await createRegistryHarness();
    const created = await registry.createSource({
      adapterId: "gemini-cli",
      displayName: "Imported Project Archive",
      rootPath: "/tmp/control-plus-zebra.awb-archive.json",
      readOnly: true,
      sourceKind: "imported-archive",
      addedBy: "import",
      archive: {
        archivePath: "/tmp/control-plus-zebra.awb-archive.json",
        exportedAt: "2026-05-24T08:00:00.000Z",
        importedAt: "2026-05-24T08:05:00.000Z",
        manifestVersion: 1,
        scopeKind: "project",
        scopeId: "project-1",
        scopeLabel: "Control Plus Zebra",
        sourceCount: 1,
        sessionCount: 2,
        projectCount: 1,
        rawArtifactCount: 0
      }
    });
    const reloaded = await new SourceRegistry(store).getSource(created.sourceId);

    expect(reloaded).toMatchObject({
      sourceId: created.sourceId,
      adapterId: "gemini-cli",
      sourceKind: "imported-archive",
      addedBy: "import",
      readOnly: true,
      archive: {
        scopeKind: "project",
        sessionCount: 2
      }
    });
    expect(isImportedArchiveSource(reloaded!)).toBe(true);
    expect(getSourceOperationFlags(reloaded!)).toEqual({
      configurable: false,
      validate: false,
      scan: false,
      watch: false
    });
  });

  it("derives imported archive semantics from source metadata instead of adapter identity", async () => {
    const { registry } = await createRegistryHarness();
    const imported = await registry.createSource({
      adapterId: "fake-test",
      rootPath: "/tmp/imported-through-fake.awb-archive.json",
      sourceKind: "imported-archive",
      addedBy: "import",
      readOnly: true
    });
    const local = await registry.createSource({
      adapterId: "fake-test",
      rootPath: "/tmp/local-fixture.json"
    });

    expect(isImportedArchiveSource(imported)).toBe(true);
    expect(getSourceOperationFlags(imported)).toEqual({
      configurable: false,
      validate: false,
      scan: false,
      watch: false
    });

    expect(isImportedArchiveSource(local)).toBe(false);
    expect(getSourceOperationFlags(local)).toEqual({
      configurable: true,
      validate: true,
      scan: true,
      watch: true
    });
  });
});
