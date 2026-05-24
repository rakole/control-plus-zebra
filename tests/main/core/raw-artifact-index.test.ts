import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RAW_ARTIFACT_SCHEMA_VERSION,
  RawArtifactIndex,
  compareRawArtifactIndexEntries,
  createRawArtifactIndexEntries,
  type RawArtifactIndexEntry
} from "../../../src/main/core/ingestion/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (tempDir) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(tempDir, { recursive: true, force: true })
      );
    })
  );
});

function buildIndexEntry(overrides: Partial<RawArtifactIndexEntry> = {}): RawArtifactIndexEntry {
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
    inode: "7",
    parseStrategy: "json",
    parserVersion: "0.1.0",
    adapterVersion: "0.1.0",
    schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION,
    diagnosticsHash: "diag-a",
    ...overrides
  };
}

describe("createRawArtifactIndexEntries", () => {
  it("preserves spec-shaped fields and legacy compatibility fields", () => {
    const [entry] = createRawArtifactIndexEntries({
      adapterVersion: "0.2.0",
      parserVersion: "0.3.0",
      diagnosticsHash: "diag-b",
      schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION,
      artifacts: [
        {
          id: "artifact-1",
          adapterId: "fake-test",
          sourceId: "source-1",
          path: "/tmp/fixture.json",
          nativeRef: "artifacts/native-1",
          nativeId: "legacy-native-1",
          artifactKind: "metadata",
          artifactType: "fake-metadata",
          sizeBytes: 42,
          mtime: "2026-05-24T00:00:00.000Z",
          inode: "123",
          parseStrategy: "json",
          mediaType: "application/json"
        }
      ]
    });

    expect(entry).toEqual(
      expect.objectContaining({
        adapterId: "fake-test",
        sourceId: "source-1",
        nativeRef: "artifacts/native-1",
        nativeId: "legacy-native-1",
        path: "/tmp/fixture.json",
        artifactKind: "metadata",
        artifactType: "fake-metadata",
        sizeBytes: 42,
        byteLength: 42,
        mtime: "2026-05-24T00:00:00.000Z",
        mtimeMs: 1_779_580_800_000,
        inode: "123",
        parseStrategy: "json",
        adapterVersion: "0.2.0",
        parserVersion: "0.3.0",
        schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION,
        diagnosticsHash: "diag-b"
      })
    );
  });
});

describe("compareRawArtifactIndexEntries", () => {
  it("classifies added, removed, changed, and unchanged artifacts", () => {
    const previous = [
      buildIndexEntry(),
      buildIndexEntry({
        id: "artifact-2",
        nativeRef: "artifacts/native-2",
        nativeId: "native-2",
        path: "/tmp/old-only.json"
      }),
      buildIndexEntry({
        id: "artifact-3",
        nativeRef: "artifacts/native-3",
        nativeId: "native-3",
        path: "/tmp/stable.json"
      })
    ];
    const next = [
      buildIndexEntry({
        id: "artifact-1",
        nativeRef: "artifacts/native-1",
        nativeId: "native-1",
        path: "/tmp/fixture-renamed.json",
        mtime: "2026-05-24T00:00:05.000Z",
        mtimeMs: 1_716_508_805_000
      }),
      buildIndexEntry({
        id: "artifact-3",
        nativeRef: "artifacts/native-3",
        nativeId: "native-3",
        path: "/tmp/stable.json"
      }),
      buildIndexEntry({
        id: "artifact-4",
        nativeRef: "artifacts/native-4",
        nativeId: "native-4",
        path: "/tmp/new-only.json"
      })
    ];

    const comparison = compareRawArtifactIndexEntries(previous, next);

    expect(comparison.added.map((entry) => entry.id)).toEqual(["artifact-4"]);
    expect(comparison.removed.map((entry) => entry.id)).toEqual(["artifact-2"]);
    expect(comparison.unchanged.map((entry) => entry.next.id)).toEqual(["artifact-3"]);
    expect(comparison.changed).toHaveLength(1);
    expect(comparison.changed[0]?.previous.id).toBe("artifact-1");
    expect(comparison.changed[0]?.changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(["path", "mtime", "mtimeMs"])
    );
  });
});

describe("RawArtifactIndex.load", () => {
  it("upgrades legacy v1 entries into the current shape", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-raw-artifact-index-"));
    tempDirs.push(tempDir);

    const filePath = path.join(tempDir, "raw-artifact-index.json");
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: "artifact-1",
              adapterId: "fake-test",
              sourceId: "source-1",
              nativeId: "native-1",
              path: "/tmp/fixture.json",
              artifactType: "legacy-session-log",
              mediaType: "application/json",
              byteLength: 42,
              mtimeMs: 1_716_508_800_000,
              inode: 7,
              parserVersion: "0.1.0",
              adapterVersion: "0.1.0",
              schemaVersion: "1",
              diagnosticsHash: "diag-a"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const index = new RawArtifactIndex(filePath);
    const [entry] = await index.load();

    expect(entry).toEqual(
      expect.objectContaining({
        id: "artifact-1",
        nativeId: "native-1",
        path: "/tmp/fixture.json",
        artifactKind: "unknown",
        artifactType: "legacy-session-log",
        sizeBytes: 42,
        byteLength: 42,
        mtime: "2024-05-24T00:00:00.000Z",
        mtimeMs: 1_716_508_800_000,
        inode: 7,
        parseStrategy: "json"
      })
    );
  });
});
