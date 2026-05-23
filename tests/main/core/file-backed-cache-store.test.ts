import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileBackedCacheStore } from "../../../src/main/core/cache/index.js";
import { exerciseAdapter } from "../../contract/run-adapter-contract.js";
import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";

const fixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);

describe("FileBackedCacheStore", () => {
  it("writes and reloads normalized cache records", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-"));
    const store = new FileBackedCacheStore(path.join(tempDir, "normalized-cache.json"));
    const exercised = await exerciseAdapter(fakeTestAdapter, fixturePath);
    const record = {
      cacheKey: "cache-proof",
      adapterId: exercised.normalized.adapterId,
      sourceId: exercised.normalized.sourceId,
      artifactFingerprint: "fingerprint-proof",
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      normalized: exercised.normalized
    };

    await store.writeRecord(record);

    const loaded = await store.getLatestSourceRecord(record.sourceId);

    expect(loaded).toEqual(record);
  });

  it("does not treat malformed cache files as a successful load", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-bad-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);

    await writeFile(filePath, "{\"version\":1,\"records\":[{\"bad\":true}]}\n", "utf8");

    await expect(store.load()).rejects.toThrow();
  });
});
