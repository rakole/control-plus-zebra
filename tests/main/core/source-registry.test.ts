import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDiagnostic } from "../../../src/main/core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import {
  SourceRegistry,
  FileBackedSourceRegistryStore
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
    expect(persisted.version).toBe(1);
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
});
