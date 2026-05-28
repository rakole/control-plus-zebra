import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactBlobStore,
  NormalizedCacheRecordEntityImporter,
  SQLiteWorkbenchEntityStore
} from "../../../src/main/core/store/index.js";
import type { NormalizedCacheRecord } from "../../../src/main/core/cache/file-backed-cache-store.js";
import { CONFIRMED_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import { createLargeSourceFixture } from "../../fixtures/large-source-fixture.js";
import { runWorkbenchEntityStoreContractSuite } from "./workbench-entity-store.contract-suite.js";

runWorkbenchEntityStoreContractSuite("SQLiteWorkbenchEntityStore contract", () => {
  const tempRoot = path.join(os.tmpdir(), `awb-sqlite-contract-${randomUUID()}`);
  const store = new SQLiteWorkbenchEntityStore({
    artifactBlobRootDir: path.join(tempRoot, "blobs"),
    databasePath: path.join(tempRoot, "workbench.sqlite")
  });

  return {
    store,
    close: () => store.close()
  };
});

describe("SQLiteWorkbenchEntityStore", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("creates and reopens the database with the migrated user_version", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-sqlite-store-"));
    tempDirs.push(tempDir);

    const databasePath = path.join(tempDir, "workbench.sqlite");
    const store = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath
    });

    store.close();

    const firstDb = new DatabaseSync(databasePath);
    const firstVersionRow = firstDb.prepare("PRAGMA user_version").get() as { user_version: number };

    expect(firstVersionRow.user_version).toBe(SQLiteWorkbenchEntityStore.SCHEMA_VERSION);
    firstDb.close();

    const reopened = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath
    });
    reopened.close();

    const secondDb = new DatabaseSync(databasePath);
    const secondVersionRow = secondDb.prepare("PRAGMA user_version").get() as { user_version: number };

    expect(secondVersionRow.user_version).toBe(SQLiteWorkbenchEntityStore.SCHEMA_VERSION);
    secondDb.close();
  });

  it("lists session summaries without hydrating timeline payload rows", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-sqlite-summary-"));
    tempDirs.push(tempDir);

    const store = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath: path.join(tempDir, "workbench.sqlite")
    });
    const sourceId = "source-query";
    const run = await store.beginIngestRun({
      adapterId: "fake-test",
      sourceId,
      ingestRunId: "run-query",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await store.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: "fake-test",
      sourceId,
      sessions: [{
        id: "session-query",
        adapterId: "fake-test",
        sourceId,
        startedAt: "2026-05-25T09:01:00.000Z",
        lastUpdatedAt: "2026-05-25T09:01:00.000Z",
        confidence: CONFIRMED_CONFIDENCE
      }],
      events: [{
        id: "event-query",
        adapterId: "fake-test",
        sourceId,
        sessionId: "session-query",
        kind: "message",
        orderKey: "0001",
        timestamp: "2026-05-25T09:01:00.000Z",
        confidence: CONFIRMED_CONFIDENCE
      }]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });
    store.close();

    const db = new DatabaseSync(path.join(tempDir, "workbench.sqlite"));
    db.prepare("UPDATE timeline_events SET payload_json = ? WHERE event_id = ?").run("{not valid json", "event-query");
    db.close();

    const reopened = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath: path.join(tempDir, "workbench.sqlite")
    });

    await expect(reopened.listSessionsPage({ sourceId, limit: 10 })).resolves.toMatchObject({
      items: [{ session: { id: "session-query" } }]
    });
    await expect(
      reopened.getSessionTimelinePage({ sourceId, sessionId: "session-query", limit: 10 })
    ).rejects.toThrow();

    reopened.close();
  });

  it("lists overview activity buckets without hydrating sessions or timeline payload rows", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-sqlite-heatmap-"));
    tempDirs.push(tempDir);

    const databasePath = path.join(tempDir, "workbench.sqlite");
    const store = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath
    });
    const sourceId = "source-heatmap";
    const run = await store.beginIngestRun({
      adapterId: "fake-test",
      sourceId,
      ingestRunId: "run-heatmap",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await store.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: "fake-test",
      sourceId,
      sessions: [
        {
          id: "session-heatmap-clean",
          adapterId: "fake-test",
          sourceId,
          startedAt: "2026-05-25T09:01:00.000Z",
          lastUpdatedAt: "2026-05-25T09:01:00.000Z",
          confidence: CONFIRMED_CONFIDENCE
        },
        {
          id: "session-heatmap-needs-review",
          adapterId: "fake-test",
          sourceId,
          startedAt: "2026-05-25T10:01:00.000Z",
          lastUpdatedAt: "2026-05-25T10:01:00.000Z",
          confidence: CONFIRMED_CONFIDENCE
        }
      ],
      events: [
        {
          id: "event-heatmap-clean",
          adapterId: "fake-test",
          sourceId,
          sessionId: "session-heatmap-clean",
          kind: "message",
          orderKey: "0001",
          timestamp: "2026-05-25T09:01:00.000Z",
          confidence: CONFIRMED_CONFIDENCE
        },
        {
          id: "event-heatmap-needs-review",
          adapterId: "fake-test",
          sourceId,
          sessionId: "session-heatmap-needs-review",
          kind: "message",
          orderKey: "0002",
          timestamp: "2026-05-25T10:01:00.000Z",
          confidence: CONFIRMED_CONFIDENCE
        }
      ],
      sessionRollups: [
        {
          sourceId,
          sessionId: "session-heatmap-clean",
          latestActivityAt: "2026-05-25T09:01:00.000Z",
          runAudit: {
            status: "clean",
            attentionReasons: [],
            confidence: CONFIRMED_CONFIDENCE,
            completionClaim: "unknown",
            supportingCommandIds: [],
            supportingMessageIds: [],
            supportingToolCallIds: []
          }
        },
        {
          sourceId,
          sessionId: "session-heatmap-needs-review",
          latestActivityAt: "2026-05-25T10:01:00.000Z",
          runAudit: {
            status: "needs-review",
            attentionReasons: [],
            confidence: CONFIRMED_CONFIDENCE,
            completionClaim: "unknown",
            supportingCommandIds: [],
            supportingMessageIds: [],
            supportingToolCallIds: []
          }
        }
      ]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId,
      publishedAt: "2026-05-25T11:00:00.000Z"
    });
    store.close();

    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE sessions SET payload_json = ? WHERE session_id = ?").run(
      "{not valid json",
      "session-heatmap-clean"
    );
    db.prepare("UPDATE timeline_events SET payload_json = ? WHERE event_id = ?").run(
      "{not valid json",
      "event-heatmap-clean"
    );
    db.close();

    const reopened = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath
    });

    await expect(
      reopened.listOverviewActivityBuckets({
        sourceId,
        startDay: "2026-05-25",
        endDay: "2026-05-25"
      })
    ).resolves.toEqual([
      {
        day: "2026-05-25",
        sessionCount: 2,
        needsAttentionCount: 1
      }
    ]);
    await expect(reopened.listSessionsPage({ sourceId, limit: 10 })).rejects.toThrow();
    await expect(
      reopened.getSessionTimelinePage({ sourceId, sessionId: "session-heatmap-clean", limit: 10 })
    ).rejects.toThrow();

    reopened.close();
  });

  it("stores blob previews with filesystem references and rejects oversized content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-blob-store-"));
    tempDirs.push(tempDir);

    const blobStore = new ArtifactBlobStore({
      rootDir: path.join(tempDir, "artifact-blobs"),
      maxContentBytes: 128,
      maxPreviewBytes: 12
    });
    const blob = await blobStore.writeTextBlob({
      blobId: "blob-1",
      text: "preview text with more than twelve bytes"
    });

    expect(blob.previewText.length).toBeGreaterThan(0);
    expect(blob.previewText.length).toBeLessThan("preview text with more than twelve bytes".length);
    expect(blob.relativePath).toContain("blob-1");
    expect(await blobStore.readTextBlob(blob.relativePath)).toBe(
      "preview text with more than twelve bytes"
    );
    expect(blobStore.resolveAbsolutePath(blob.relativePath)).toBe(
      path.join(path.join(tempDir, "artifact-blobs"), blob.relativePath)
    );
    expect(() => blobStore.resolveAbsolutePath("../escape.txt")).toThrow(
      "escapes the configured root directory"
    );

    await expect(
      blobStore.writeTextBlob({
        blobId: "blob-2",
        text: "1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890"
      })
    ).rejects.toThrow("bounded ingestion limit");
  });

  it("returns archive preflight section counts without hydrating payload rows", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-sqlite-preflight-"));
    tempDirs.push(tempDir);

    const databasePath = path.join(tempDir, "workbench.sqlite");
    const store = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath
    });
    const sourceId = "source-preflight";
    const run = await store.beginIngestRun({
      adapterId: "fake-test",
      sourceId,
      ingestRunId: "run-preflight",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await store.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: "fake-test",
      sourceId,
      sessions: [{
        id: "session-preflight",
        adapterId: "fake-test",
        sourceId,
        startedAt: "2026-05-25T09:01:00.000Z",
        lastUpdatedAt: "2026-05-25T09:01:00.000Z",
        confidence: CONFIRMED_CONFIDENCE
      }],
      events: [{
        id: "event-preflight",
        adapterId: "fake-test",
        sourceId,
        sessionId: "session-preflight",
        kind: "message",
        orderKey: "0001",
        timestamp: "2026-05-25T09:01:00.000Z",
        confidence: CONFIRMED_CONFIDENCE
      }],
      rawArtifacts: [{
        artifactId: "artifact-preflight",
        sourceId,
        status: "available",
        sessionId: "session-preflight"
      }],
      sessionRollups: [{
        sourceId,
        sessionId: "session-preflight",
        diagnosticCount: 0,
        rawArtifactCount: 1
      }]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });
    store.close();

    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE sessions SET payload_json = ? WHERE session_id = ?").run("{not valid json", "session-preflight");
    db.prepare("UPDATE timeline_events SET payload_json = ? WHERE event_id = ?").run("{not valid json", "event-preflight");
    db.close();

    const reopened = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath
    });

    await expect(reopened.getArchivePreflight({ sourceId })).resolves.toMatchObject({
      adapterId: "fake-test",
      ingestRunId: "run-preflight",
      sourceId,
      sourceRecordCount: 1,
      totalEntityCount: 5,
      sectionEntityCounts: expect.objectContaining({
        sources: 1,
        sessions: 1,
        "timeline-events": 1,
        "session-rollups": 1,
        "raw-artifact-entries": 1
      })
    });

    reopened.close();
  });

  it("persists blob metadata in sqlite and allows raw artifact metadata to reference it", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-sqlite-blob-ref-"));
    tempDirs.push(tempDir);

    const store = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath: path.join(tempDir, "workbench.sqlite")
    });
    const blob = await store.writeArtifactBlob({
      blobId: "artifact-blob-ref",
      extension: "jsonl",
      text: "{\"event\":\"chunk\"}\n",
      createdAt: "2026-05-25T09:00:00.000Z"
    });
    const sourceId = "source-blob-ref";
    const run = await store.beginIngestRun({
      adapterId: "fake-test",
      sourceId,
      ingestRunId: "run-blob-ref",
      startedAt: "2026-05-25T09:01:00.000Z"
    });

    await store.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: "fake-test",
      sourceId,
      rawArtifacts: [{
        artifactId: "artifact-1",
        sourceId,
        status: "available",
        blob
      }]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });

    await expect(store.getArtifactBlob("artifact-blob-ref")).resolves.toEqual(blob);
    await expect(
      store.getRawArtifactMetadata({
        sourceId,
        artifactId: "artifact-1"
      })
    ).resolves.toMatchObject({
      artifactId: "artifact-1",
      blob: expect.objectContaining({
        blobId: "artifact-blob-ref",
        relativePath: blob.relativePath,
        createdAt: "2026-05-25T09:00:00.000Z"
      })
    });

    store.close();
  });

  it("imports normalized cache records in bounded batches without touching startup paths", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-cache-import-"));
    tempDirs.push(tempDir);

    const fixture = createLargeSourceFixture({
      sourceCount: 1,
      sessionsPerSource: 2,
      messagesPerSession: 1,
      toolCallsPerSession: 1,
      shellCommandsPerSession: 1,
      outputArtifactsPerSession: 1,
      diagnosticsPerSession: 1
    });
    const record = {
      ...fixture.records[0],
      rawArtifactIndex: {
        version: 1,
        entries: fixture.rawArtifactEntries
      }
    } as NormalizedCacheRecord;

    const store = new SQLiteWorkbenchEntityStore({
      artifactBlobRootDir: path.join(tempDir, "blobs"),
      databasePath: path.join(tempDir, "workbench.sqlite")
    });
    const importer = new NormalizedCacheRecordEntityImporter({
      maxBatchSize: 1,
      store
    });

    await importer.importRecord(record, {
      ingestRunId: "import-run",
      publishAt: "2026-05-25T09:05:00.000Z"
    });

    const sessionsPage = await store.listSessionsPage({
      sourceId: record.sourceId,
      limit: 10
    });
    const sessionRollup = await store.getSessionRollup({
      sourceId: record.sourceId,
      sessionId: record.normalized.sessions[0]!.id
    });
    const rawArtifact = await store.getRawArtifactMetadata({
      sourceId: record.sourceId,
      artifactId: fixture.rawArtifactEntries[0]!.id
    });

    expect(sessionsPage.items).toHaveLength(record.normalized.sessions.length);
    expect(sessionRollup?.sessionId).toBe(record.normalized.sessions[0]!.id);
    expect(rawArtifact?.artifactId).toBe(fixture.rawArtifactEntries[0]!.id);

    store.close();
  });
});
