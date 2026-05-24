import { describe, expect, it } from "vitest";

import { createCacheKey } from "../../../src/main/core/cache/index.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/index.js";

function buildArtifactEntry(overrides: Partial<RawArtifactIndexEntry> = {}): RawArtifactIndexEntry {
  return {
    id: "artifact-1",
    adapterId: "fake-test",
    sourceId: "source-1",
    nativeRef: "artifacts/native-1",
    nativeId: "native-1",
    path: "/tmp/fixture.json",
    artifactKind: "session-log",
    artifactType: "fake-session-fixture",
    mediaType: "application/json",
    sizeBytes: 42,
    byteLength: 42,
    mtime: "2026-05-24T00:00:00.000Z",
    mtimeMs: 1_716_508_800_000,
    inode: 7,
    parseStrategy: "json",
    parserVersion: "0.1.0",
    adapterVersion: "0.1.0",
    schemaVersion: "2",
    diagnosticsHash: "diag-a",
    ...overrides
  };
}

function buildCacheKeyInput(overrides: Partial<Parameters<typeof createCacheKey>[0]> = {}) {
  return {
    adapterId: "fake-test",
    sourceId: "source-1",
    adapterVersion: "0.1.0",
    parserVersion: "0.1.0",
    schemaVersion: "1",
    diagnosticsHash: "diag-a",
    artifacts: [buildArtifactEntry()],
    ...overrides
  } satisfies Parameters<typeof createCacheKey>[0];
}

describe("createCacheKey", () => {
  it("is order independent for the same artifact set", () => {
    const first = buildArtifactEntry({ id: "artifact-1", nativeRef: "native-1", path: "/tmp/a.json" });
    const second = buildArtifactEntry({ id: "artifact-2", nativeRef: "native-2", path: "/tmp/b.json" });

    const ordered = createCacheKey(buildCacheKeyInput({ artifacts: [first, second] }));
    const reversed = createCacheKey(buildCacheKeyInput({ artifacts: [second, first] }));

    expect(reversed).toBe(ordered);
  });

  it("changes when cache-level adapter, source, version, schema, or diagnostics inputs change", () => {
    const base = createCacheKey(buildCacheKeyInput());

    const variants = [
      createCacheKey(buildCacheKeyInput({ adapterId: "other-test" })),
      createCacheKey(
        buildCacheKeyInput({
          sourceId: "source-2",
          artifacts: [buildArtifactEntry({ sourceId: "source-2" })]
        })
      ),
      createCacheKey(buildCacheKeyInput({ adapterVersion: "0.1.1" })),
      createCacheKey(buildCacheKeyInput({ parserVersion: "0.1.1" })),
      createCacheKey(buildCacheKeyInput({ schemaVersion: "2" })),
      createCacheKey(
        buildCacheKeyInput({
          diagnosticsHash: "diag-b",
          artifacts: [buildArtifactEntry({ diagnosticsHash: "diag-b" })]
        })
      )
    ];

    for (const variant of variants) {
      expect(variant).not.toBe(base);
    }
  });

  it("changes when artifact path and nativeRef identity inputs change", () => {
    const base = createCacheKey(buildCacheKeyInput());

    const pathVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [buildArtifactEntry({ path: "/tmp/renamed.json" })]
      })
    );
    const nativeRefVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [buildArtifactEntry({ nativeRef: "artifacts/native-2" })]
      })
    );
    const { nativeRef: _nativeRef, ...nativeIdOnlyArtifact } = buildArtifactEntry({
      nativeId: "native-2"
    });
    const nativeIdOnlyVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [nativeIdOnlyArtifact]
      })
    );

    expect(pathVariant).not.toBe(base);
    expect(nativeRefVariant).not.toBe(base);
    expect(nativeIdOnlyVariant).not.toBe(base);
  });

  it("changes when artifact kind or parse strategy changes", () => {
    const base = createCacheKey(buildCacheKeyInput());

    const artifactKindVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [buildArtifactEntry({ artifactKind: "metadata" })]
      })
    );
    const parseStrategyVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [buildArtifactEntry({ parseStrategy: "text" })]
      })
    );

    expect(artifactKindVariant).not.toBe(base);
    expect(parseStrategyVariant).not.toBe(base);
  });

  it("changes when artifact size or mtime inputs change", () => {
    const base = createCacheKey(buildCacheKeyInput());

    const sizeVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [buildArtifactEntry({ sizeBytes: 43, byteLength: 43 })]
      })
    );
    const mtimeVariant = createCacheKey(
      buildCacheKeyInput({
        artifacts: [
          buildArtifactEntry({
            mtime: "2026-05-24T00:00:05.000Z",
            mtimeMs: 1_716_508_805_000
          })
        ]
      })
    );

    expect(sizeVariant).not.toBe(base);
    expect(mtimeVariant).not.toBe(base);
  });

  it("resists collisions when artifact metadata matches but adapter or source differs", () => {
    const sourceOne = createCacheKey(buildCacheKeyInput());
    const sourceTwo = createCacheKey(
      buildCacheKeyInput({
        sourceId: "source-2",
        artifacts: [buildArtifactEntry({ sourceId: "source-2" })]
      })
    );
    const adapterTwo = createCacheKey(
      buildCacheKeyInput({
        adapterId: "archive-reader",
        artifacts: [buildArtifactEntry({ adapterId: "archive-reader" })]
      })
    );

    expect(sourceTwo).not.toBe(sourceOne);
    expect(adapterTwo).not.toBe(sourceOne);
    expect(adapterTwo).not.toBe(sourceTwo);
  });
});
