import { describe, expect, it } from "vitest";

import { createCacheKey } from "../../../src/main/core/cache/index.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/index.js";

function buildArtifactEntry(overrides: Partial<RawArtifactIndexEntry> = {}): RawArtifactIndexEntry {
  return {
    id: "artifact-1",
    adapterId: "fake-test",
    sourceId: "source-1",
    nativeId: "native-1",
    path: "/tmp/fixture.json",
    artifactType: "fake-session-fixture",
    mediaType: "application/json",
    byteLength: 42,
    mtimeMs: 100,
    inode: 7,
    parserVersion: "0.1.0",
    adapterVersion: "0.1.0",
    schemaVersion: "1",
    diagnosticsHash: "diag-a",
    ...overrides
  };
}

describe("createCacheKey", () => {
  it("changes when adapter, source, artifact metadata, version, or diagnostics inputs change", () => {
    const base = createCacheKey({
      adapterId: "fake-test",
      sourceId: "source-1",
      adapterVersion: "0.1.0",
      parserVersion: "0.1.0",
      schemaVersion: "1",
      diagnosticsHash: "diag-a",
      artifacts: [buildArtifactEntry()]
    });

    const variants = [
      createCacheKey({
        adapterId: "other-test",
        sourceId: "source-1",
        adapterVersion: "0.1.0",
        parserVersion: "0.1.0",
        schemaVersion: "1",
        diagnosticsHash: "diag-a",
        artifacts: [buildArtifactEntry()]
      }),
      createCacheKey({
        adapterId: "fake-test",
        sourceId: "source-2",
        adapterVersion: "0.1.0",
        parserVersion: "0.1.0",
        schemaVersion: "1",
        diagnosticsHash: "diag-a",
        artifacts: [buildArtifactEntry({ sourceId: "source-2" })]
      }),
      createCacheKey({
        adapterId: "fake-test",
        sourceId: "source-1",
        adapterVersion: "0.1.1",
        parserVersion: "0.1.0",
        schemaVersion: "1",
        diagnosticsHash: "diag-a",
        artifacts: [buildArtifactEntry()]
      }),
      createCacheKey({
        adapterId: "fake-test",
        sourceId: "source-1",
        adapterVersion: "0.1.0",
        parserVersion: "0.1.1",
        schemaVersion: "1",
        diagnosticsHash: "diag-a",
        artifacts: [buildArtifactEntry()]
      }),
      createCacheKey({
        adapterId: "fake-test",
        sourceId: "source-1",
        adapterVersion: "0.1.0",
        parserVersion: "0.1.0",
        schemaVersion: "2",
        diagnosticsHash: "diag-a",
        artifacts: [buildArtifactEntry({ schemaVersion: "2" })]
      }),
      createCacheKey({
        adapterId: "fake-test",
        sourceId: "source-1",
        adapterVersion: "0.1.0",
        parserVersion: "0.1.0",
        schemaVersion: "1",
        diagnosticsHash: "diag-b",
        artifacts: [buildArtifactEntry({ diagnosticsHash: "diag-b" })]
      }),
      createCacheKey({
        adapterId: "fake-test",
        sourceId: "source-1",
        adapterVersion: "0.1.0",
        parserVersion: "0.1.0",
        schemaVersion: "1",
        diagnosticsHash: "diag-a",
        artifacts: [buildArtifactEntry({ byteLength: 43 })]
      })
    ];

    for (const variant of variants) {
      expect(variant).not.toBe(base);
    }
  });
});
