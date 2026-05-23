import { copyFile, cp, mkdtemp, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileBackedCacheStore } from "../../../src/main/core/cache/index.js";
import { RawArtifactIndex, Scanner } from "../../../src/main/core/ingestion/index.js";
import {
  createBundledAdapterRegistry,
  FileBackedSourceRegistryStore,
  SourceRegistry
} from "../../../src/main/core/registry/index.js";
import { WatchOrchestrator } from "../../../src/main/core/watcher/index.js";

const sourceFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);
const geminiFixtureRoot = path.resolve("src/main/adapters/gemini-cli/fixtures/sample-root");

async function createScannerHarness() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-scanner-"));
  const fixturePath = path.join(tempDir, "fixture.json");

  await copyFile(sourceFixturePath, fixturePath);

  const sourceRegistry = new SourceRegistry(
    new FileBackedSourceRegistryStore(path.join(tempDir, "sources.json"))
  );
  const rawArtifactIndex = new RawArtifactIndex(path.join(tempDir, "raw-artifact-index.json"));
  const cacheStore = new FileBackedCacheStore(path.join(tempDir, "normalized-cache.json"));
  const watchOrchestrator = new WatchOrchestrator();
  const scanner = new Scanner({
    adapterRegistry: createBundledAdapterRegistry(),
    cacheStore,
    projectDir: process.cwd(),
    rawArtifactIndex,
    sourceRegistry,
    watchOrchestrator
  });

  return {
    cacheStore,
    fixturePath,
    rawArtifactIndex,
    scanner,
    sourceRegistry,
    tempDir
  };
}

describe("Scanner cache integration", () => {
  it("validates, scans, caches, and persists honest source summaries", async () => {
    const { cacheStore, fixturePath, scanner, sourceRegistry } = await createScannerHarness();
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });

    const validated = await scanner.validateSource(source.sourceId);
    const scanned = await scanner.scanSource(validated.source.sourceId);
    const persisted = await sourceRegistry.getSource(validated.source.sourceId);
    const cachedRecord = await cacheStore.getLatestSourceRecord(validated.source.sourceId);

    expect(scanned.cachedRecord?.cacheKey).toBeTruthy();
    expect(persisted?.scan.status).toBe("scanned-with-diagnostics");
    expect(persisted?.cache.status).toBe("cached");
    expect(persisted?.watch.status).toBe("unsupported");
    expect(cachedRecord?.normalized.sessions.length).toBeGreaterThan(0);
  });

  it("marks cached source state stale when indexed artifact inputs change", async () => {
    const { fixturePath, scanner, sourceRegistry } = await createScannerHarness();
    const source = await sourceRegistry.createSource({
      adapterId: "fake-test",
      rootPath: fixturePath
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const currentStat = await stat(fixturePath);
    const nextTime = new Date(currentStat.mtimeMs + 5_000);

    await utimes(fixturePath, nextTime, nextTime);
    await scanner.reconcileSource(validated.source.sourceId);

    const reconciled = await sourceRegistry.getSource(validated.source.sourceId);

    expect(reconciled?.cache.status).toBe("stale");
    expect(reconciled?.scan.status).toBe("stale");
  });

  it("caches Gemini sessions through the shared scanner pipeline alongside existing bundled adapters", async () => {
    const { cacheStore, scanner, sourceRegistry, tempDir } = await createScannerHarness();
    const copiedGeminiRoot = path.join(tempDir, "gemini-root");

    await cp(geminiFixtureRoot, copiedGeminiRoot, { recursive: true });

    const source = await sourceRegistry.createSource({
      adapterId: "gemini-cli",
      rootPath: copiedGeminiRoot
    });
    const validated = await scanner.validateSource(source.sourceId);

    await scanner.scanSource(validated.source.sourceId);

    const cachedRecords = await cacheStore.listLatestRecords();
    const geminiRecords = cachedRecords.filter((record) => record.adapterId === "gemini-cli");

    expect(geminiRecords.length).toBeGreaterThan(0);
    expect(geminiRecords.flatMap((record) => record.normalized.sessions).length).toBeGreaterThan(0);
    expect(
      geminiRecords.some((record) =>
        record.normalized.sessions.some((session) => session.lifecycleState === "completed")
      )
    ).toBe(true);
  });
});
