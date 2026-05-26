import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { createOutputArtifactViewModelService } from "../../../src/main/app/output-artifact-view-model-service.js";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import { syncAllLatestCacheRecordsToEntityStore } from "../../../src/main/app/workbench-entity-store-sync.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import type { OutputArtifact } from "../../../src/main/core/model/entities.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/raw-artifact-index.js";

import {
  cleanupTempDirs,
  createHydrationDegradedRuntimeFromSeed,
  createScannedRuntime,
  ensureLatestSourceCacheRecordForTests,
  loadGeminiArtifactFixtureFromStore
} from "./triage-test-runtime.js";

describe("output artifact view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it(
    "loads preview and full artifact text from cache plus raw index after runtime restart",
    async () => {
      const runtime = await createScannedRuntime(tempDirs);
      const fixture = await loadGeminiArtifactFixture(runtime);
      const previewService = createOutputArtifactViewModelService({ runtime });

      const preview = await previewService.getPreview({
        sessionId: fixture.sessionId,
        outputArtifactId: fixture.plainTextArtifact.id
      });

      expect(preview).toMatchObject({
        status: "preview-ready",
        outputArtifactId: fixture.plainTextArtifact.id,
        contentKind: "plain-text"
      });
      if (preview.status !== "preview-ready") {
        throw new Error("Expected a preview-ready output artifact.");
      }
      expect(preview.text).toContain("Contract types");

      const restartedRuntime = createWorkbenchRuntime({
        appDataDir: runtime.appDataDir,
        projectDir: process.cwd()
      });
      const restartedService = createOutputArtifactViewModelService({
        runtime: restartedRuntime
      });
      const loaded = await restartedService.loadArtifact({
        sessionId: fixture.sessionId,
        outputArtifactId: fixture.jsonArtifact.id
      });

      expect(loaded).toMatchObject({
        status: "loaded",
        outputArtifactId: fixture.jsonArtifact.id,
        contentKind: "json-output-wrapper",
        mediaType: "application/json"
      });
      if (loaded.status !== "loaded") {
        throw new Error("Expected a loaded output artifact.");
      }
      expect(loaded.text).toBe("Updated contract types and capability fields.");
    },
    15_000
  );

  it("returns unavailable when the durable raw artifact index entry is gone", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);
    await deleteRawArtifactMetadata(runtime, fixture.sourceId, fixture.plainTextEntry.id);

    const service = createOutputArtifactViewModelService({ runtime });
    const loaded = await service.loadArtifact({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "unavailable",
      outputArtifactId: fixture.plainTextArtifact.id
    });
  });

  it("returns unavailable instead of missing when the source is stuck in cache fallback", async () => {
    const seedRuntime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixtureFromStore(seedRuntime);
    const runtime = await createHydrationDegradedRuntimeFromSeed(
      tempDirs,
      seedRuntime,
      fixture.sourceId
    );
    const service = createOutputArtifactViewModelService({ runtime });
    const loaded = await service.loadArtifact({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "unavailable",
      outputArtifactId: fixture.plainTextArtifact.id,
      reason: expect.stringContaining("entity-store hydration failed")
    });
  });

  it("redacts obvious secrets before returning preview text", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);
    await updateOutputArtifact(runtime, fixture.sourceId, fixture.plainTextArtifact.id, (artifact) => ({
      ...artifact,
      preview: "api_key=sk_live_123456\naccessToken: ghp_abcdef"
    }));

    const service = createOutputArtifactViewModelService({ runtime });
    const preview = await service.getPreview({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(preview).toMatchObject({
      status: "preview-ready",
      outputArtifactId: fixture.plainTextArtifact.id
    });
    if (preview.status !== "preview-ready") {
      throw new Error("Expected a preview-ready output artifact.");
    }
    expect(preview.text).toContain("api_key=[REDACTED]");
    expect(preview.text).toContain("accessToken: [REDACTED]");
    expect(preview.text).not.toContain("sk_live_123456");
    expect(preview.text).not.toContain("ghp_abcdef");
  });

  it("returns missing when the indexed artifact file no longer exists", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);

    await rm(fixture.plainTextEntry.path ?? "", { force: true });

    const service = createOutputArtifactViewModelService({ runtime });
    const loaded = await service.loadArtifact({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "missing",
      outputArtifactId: fixture.plainTextArtifact.id
    });
  });

  it("returns unreadable when an indexed artifact escapes the allowed source root", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);
    const outsidePath = path.join(runtime.appDataDir, "outside-artifact.txt");

    await writeFile(outsidePath, "outside root", "utf8");
    await updateRawArtifactMetadata(
      runtime,
      fixture.sourceId,
      fixture.plainTextEntry.id,
      (entry) => ({
        ...entry,
        path: outsidePath
      })
    );

    const service = createOutputArtifactViewModelService({ runtime });
    const loaded = await service.loadArtifact({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "unreadable",
      outputArtifactId: fixture.plainTextArtifact.id
    });
    if (loaded.status !== "unreadable") {
      throw new Error("Expected an unreadable output artifact.");
    }
    expect(loaded.reason).toContain("allowed source root");
  });

  it("returns unsupported for non-text output artifacts", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);
    await updateOutputArtifact(runtime, fixture.sourceId, fixture.plainTextArtifact.id, (artifact) => {
      const { preview: _preview, ...rest } = artifact;

      return {
        ...rest,
        contentKind: "binary" as const,
        mediaType: "image/png"
      };
    });

    const service = createOutputArtifactViewModelService({ runtime });
    const preview = await service.getPreview({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(preview).toMatchObject({
      status: "unsupported",
      outputArtifactId: fixture.plainTextArtifact.id,
      contentKind: "binary",
      mediaType: "image/png"
    });
  });

  it("uses raw-artifact metadata as a same-session fallback for legacy compatibility shapes", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);

    await updateSessionRollup(runtime, fixture.sourceId, fixture.sessionId, (session) => ({
      ...session,
      outputArtifactIds: (session.outputArtifactIds ?? []).filter(
        (artifactId) => artifactId !== fixture.plainTextArtifact.id
      )
    }));
    await updateOutputArtifactRecord(
      runtime,
      fixture.sourceId,
      fixture.plainTextArtifact.id,
      {
        sessionId: null,
        sourceEventId: null,
        mutateArtifact: (artifact) => {
          const { sessionId: _sessionId, ...rest } = artifact;

          return rest;
        }
      }
    );

    const service = createOutputArtifactViewModelService({ runtime });
    const loaded = await service.loadArtifact({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "loaded",
      outputArtifactId: fixture.plainTextArtifact.id,
      contentKind: "plain-text"
    });
  });

  it("still rejects artifacts when raw-artifact metadata proves different-session ownership", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);

    await updateSessionRollup(runtime, fixture.sourceId, fixture.sessionId, (session) => ({
      ...session,
      outputArtifactIds: (session.outputArtifactIds ?? []).filter(
        (artifactId) => artifactId !== fixture.plainTextArtifact.id
      )
    }));
    await updateOutputArtifactRecord(
      runtime,
      fixture.sourceId,
      fixture.plainTextArtifact.id,
      {
        sessionId: null,
        sourceEventId: null,
        mutateArtifact: (artifact) => {
          const { sessionId: _sessionId, ...rest } = artifact;

          return rest;
        }
      }
    );
    await updateRawArtifactMetadataRecord(runtime, fixture.sourceId, fixture.plainTextEntry.id, (record) => ({
      ...record,
      sessionId: "session_cross_session_guard"
    }));

    const service = createOutputArtifactViewModelService({ runtime });
    const loaded = await service.loadArtifact({
      sessionId: fixture.sessionId,
      outputArtifactId: fixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "missing",
      outputArtifactId: fixture.plainTextArtifact.id
    });
  });

  it("loads imported output artifacts after restart without the original source root", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const exportFixture = await loadGeminiArtifactFixture(exportRuntime);
    await ensureLatestSourceCacheRecordForTests(exportRuntime, exportFixture.sourceId);

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "imported-output-artifacts.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: exportFixture.sessionId }
    });

    const importRuntime = createWorkbenchRuntime({
      appDataDir: `${exportRuntime.appDataDir}-imported`,
      projectDir: process.cwd()
    });

    tempDirs.push(importRuntime.appDataDir);

    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const imported = await importer.importArchive({ archivePath });
    await syncAllLatestCacheRecordsToEntityStore(importRuntime);
    const importedFixture = await loadGeminiArtifactFixture(importRuntime, {
      sourceId: imported.sourceId
    });

    await rm(path.join(exportRuntime.appDataDir, "gemini-root"), {
      force: true,
      recursive: true
    });

    const restartedRuntime = createWorkbenchRuntime({
      appDataDir: importRuntime.appDataDir,
      projectDir: process.cwd()
    });
    const restartedService = createOutputArtifactViewModelService({
      runtime: restartedRuntime
    });
    const loaded = await restartedService.loadArtifact({
      sessionId: importedFixture.sessionId,
      outputArtifactId: importedFixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "loaded",
      outputArtifactId: importedFixture.plainTextArtifact.id,
      contentKind: "plain-text"
    });
    if (loaded.status !== "loaded") {
      throw new Error("Expected a loaded imported output artifact.");
    }
    expect(loaded.text).toContain("Contract types");
  });

  it("loads imported v3 output artifacts after restart without the original source root", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const exportFixture = await loadGeminiArtifactFixture(exportRuntime);
    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "imported-output-artifacts-v3.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: exportFixture.sessionId }
    });

    const importRuntime = createWorkbenchRuntime({
      appDataDir: `${exportRuntime.appDataDir}-imported-v3`,
      projectDir: process.cwd()
    });

    tempDirs.push(importRuntime.appDataDir);

    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const imported = await importer.importArchive({ archivePath });
    const importedFixture = await loadGeminiArtifactFixture(importRuntime, {
      sourceId: imported.sourceId
    });

    await rm(path.join(exportRuntime.appDataDir, "gemini-root"), {
      force: true,
      recursive: true
    });

    const restartedRuntime = createWorkbenchRuntime({
      appDataDir: importRuntime.appDataDir,
      projectDir: process.cwd()
    });
    const restartedService = createOutputArtifactViewModelService({
      runtime: restartedRuntime
    });
    const loaded = await restartedService.loadArtifact({
      sessionId: importedFixture.sessionId,
      outputArtifactId: importedFixture.plainTextArtifact.id
    });

    expect(loaded).toMatchObject({
      status: "loaded",
      outputArtifactId: importedFixture.plainTextArtifact.id,
      contentKind: "plain-text"
    });
    if (loaded.status !== "loaded") {
      throw new Error("Expected a loaded imported v3 output artifact.");
    }
    expect(loaded.text).toContain("Contract types");
  });
});

async function loadGeminiArtifactFixture(
  runtime: WorkbenchRuntime,
  options: { sourceId?: string } = {}
) {
  return loadGeminiArtifactFixtureFromStore(runtime, options);
}

async function deleteRawArtifactMetadata(
  runtime: WorkbenchRuntime,
  sourceId: string,
  artifactId: string
): Promise<void> {
  const ingestRunId = await requireCurrentIngestRunId(runtime, sourceId);
  const db = new DatabaseSync(path.join(runtime.appDataDir, "workbench.sqlite"));

  db.prepare(
    "DELETE FROM raw_artifact_entries WHERE ingest_run_id = ? AND source_id = ? AND artifact_id = ?"
  ).run(ingestRunId, sourceId, artifactId);
  db.close();
}

async function updateRawArtifactMetadata(
  runtime: WorkbenchRuntime,
  sourceId: string,
  artifactId: string,
  mutate: (entry: RawArtifactIndexEntry) => RawArtifactIndexEntry
): Promise<void> {
  const ingestRunId = await requireCurrentIngestRunId(runtime, sourceId);
  const db = new DatabaseSync(path.join(runtime.appDataDir, "workbench.sqlite"));
  const row = db.prepare(
    "SELECT payload_json FROM raw_artifact_entries WHERE ingest_run_id = ? AND source_id = ? AND artifact_id = ?"
  ).get(ingestRunId, sourceId, artifactId) as { payload_json: string } | undefined;

  if (!row) {
    db.close();
    throw new Error(`Expected raw artifact metadata for '${artifactId}'.`);
  }

  const payload = JSON.parse(row.payload_json) as {
    artifactId: string;
    sourceId: string;
    status: string;
    entry?: RawArtifactIndexEntry;
  };

  if (!payload.entry) {
    db.close();
    throw new Error(`Expected raw artifact entry payload for '${artifactId}'.`);
  }

  payload.entry = mutate(payload.entry);
  db.prepare(
    "UPDATE raw_artifact_entries SET payload_json = ? WHERE ingest_run_id = ? AND source_id = ? AND artifact_id = ?"
  ).run(JSON.stringify(payload), ingestRunId, sourceId, artifactId);
  db.close();
}

async function updateRawArtifactMetadataRecord(
  runtime: WorkbenchRuntime,
  sourceId: string,
  artifactId: string,
  mutate: (record: {
    artifactId: string;
    entry?: RawArtifactIndexEntry;
    outputArtifactId?: string;
    reason?: string;
    sessionId?: string;
    sourceId: string;
    status: string;
  }) => {
    artifactId: string;
    entry?: RawArtifactIndexEntry;
    outputArtifactId?: string;
    reason?: string;
    sessionId?: string;
    sourceId: string;
    status: string;
  }
): Promise<void> {
  const ingestRunId = await requireCurrentIngestRunId(runtime, sourceId);
  const db = new DatabaseSync(path.join(runtime.appDataDir, "workbench.sqlite"));
  const row = db.prepare(
    "SELECT payload_json FROM raw_artifact_entries WHERE ingest_run_id = ? AND source_id = ? AND artifact_id = ?"
  ).get(ingestRunId, sourceId, artifactId) as { payload_json: string } | undefined;

  if (!row) {
    db.close();
    throw new Error(`Expected raw artifact metadata for '${artifactId}'.`);
  }

  const nextRecord = mutate(
    JSON.parse(row.payload_json) as {
      artifactId: string;
      entry?: RawArtifactIndexEntry;
      outputArtifactId?: string;
      reason?: string;
      sessionId?: string;
      sourceId: string;
      status: string;
    }
  );

  db.prepare(
    `UPDATE raw_artifact_entries
     SET session_id = ?, output_artifact_id = ?, status = ?, reason = ?, payload_json = ?
     WHERE ingest_run_id = ? AND source_id = ? AND artifact_id = ?`
  ).run(
    nextRecord.sessionId ?? null,
    nextRecord.outputArtifactId ?? null,
    nextRecord.status,
    nextRecord.reason ?? null,
    JSON.stringify(nextRecord),
    ingestRunId,
    sourceId,
    artifactId
  );
  db.close();
}

async function updateOutputArtifact(
  runtime: WorkbenchRuntime,
  sourceId: string,
  outputArtifactId: string,
  mutate: (artifact: OutputArtifact) => OutputArtifact
): Promise<void> {
  const ingestRunId = await requireCurrentIngestRunId(runtime, sourceId);
  const db = new DatabaseSync(path.join(runtime.appDataDir, "workbench.sqlite"));
  const row = db.prepare(
    "SELECT payload_json FROM output_artifacts WHERE ingest_run_id = ? AND source_id = ? AND output_artifact_id = ?"
  ).get(ingestRunId, sourceId, outputArtifactId) as { payload_json: string } | undefined;

  if (!row) {
    db.close();
    throw new Error(`Expected output artifact '${outputArtifactId}'.`);
  }

  const artifact = mutate(JSON.parse(row.payload_json) as OutputArtifact);
  db.prepare(
    "UPDATE output_artifacts SET payload_json = ? WHERE ingest_run_id = ? AND source_id = ? AND output_artifact_id = ?"
  ).run(JSON.stringify(artifact), ingestRunId, sourceId, outputArtifactId);
  db.close();
}

async function updateOutputArtifactRecord(
  runtime: WorkbenchRuntime,
  sourceId: string,
  outputArtifactId: string,
  options: {
    mutateArtifact: (artifact: OutputArtifact) => OutputArtifact;
    sessionId?: string | null;
    sourceEventId?: string | null;
  }
): Promise<void> {
  const ingestRunId = await requireCurrentIngestRunId(runtime, sourceId);
  const db = new DatabaseSync(path.join(runtime.appDataDir, "workbench.sqlite"));
  const row = db.prepare(
    "SELECT payload_json FROM output_artifacts WHERE ingest_run_id = ? AND source_id = ? AND output_artifact_id = ?"
  ).get(ingestRunId, sourceId, outputArtifactId) as { payload_json: string } | undefined;

  if (!row) {
    db.close();
    throw new Error(`Expected output artifact '${outputArtifactId}'.`);
  }

  const artifact = options.mutateArtifact(JSON.parse(row.payload_json) as OutputArtifact);
  db.prepare(
    `UPDATE output_artifacts
     SET session_id = ?, source_event_id = ?, payload_json = ?
     WHERE ingest_run_id = ? AND source_id = ? AND output_artifact_id = ?`
  ).run(
    options.sessionId ?? null,
    options.sourceEventId ?? null,
    JSON.stringify(artifact),
    ingestRunId,
    sourceId,
    outputArtifactId
  );
  db.close();
}

async function updateSessionRollup(
  runtime: WorkbenchRuntime,
  sourceId: string,
  sessionId: string,
  mutate: (session: {
    [key: string]: unknown;
    outputArtifactIds?: string[];
  }) => {
    [key: string]: unknown;
    outputArtifactIds?: string[];
  }
): Promise<void> {
  const ingestRunId = await requireCurrentIngestRunId(runtime, sourceId);
  const db = new DatabaseSync(path.join(runtime.appDataDir, "workbench.sqlite"));
  const row = db.prepare(
    "SELECT payload_json FROM session_rollups WHERE ingest_run_id = ? AND source_id = ? AND session_id = ?"
  ).get(ingestRunId, sourceId, sessionId) as { payload_json: string } | undefined;

  if (!row) {
    db.close();
    throw new Error(`Expected session rollup '${sessionId}'.`);
  }

  const payload = JSON.parse(row.payload_json) as {
    session: {
      [key: string]: unknown;
      outputArtifactIds?: string[];
    };
  };

  payload.session = mutate(payload.session);
  db.prepare(
    "UPDATE session_rollups SET payload_json = ? WHERE ingest_run_id = ? AND source_id = ? AND session_id = ?"
  ).run(JSON.stringify(payload), ingestRunId, sourceId, sessionId);
  db.close();
}

async function requireCurrentIngestRunId(
  runtime: WorkbenchRuntime,
  sourceId: string
): Promise<string> {
  const currentRun = await runtime.entityStore.getCurrentIngestRun({ sourceId });

  if (!currentRun) {
    throw new Error(`Expected a current ingest run for '${sourceId}'.`);
  }

  return currentRun.ingestRunId;
}
