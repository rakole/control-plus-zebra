import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createOutputArtifactViewModelService } from "../../../src/main/app/output-artifact-view-model-service.js";
import { loadTriageData } from "../../../src/main/app/triage-view-model-service.js";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import type { OutputArtifact } from "../../../src/main/core/model/entities.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/raw-artifact-index.js";

import {
  cleanupTempDirs,
  createScannedRuntime
} from "./triage-test-runtime.js";

describe("output artifact view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("loads preview and full artifact text from cache plus raw index after runtime restart", async () => {
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
  });

  it("returns unavailable when the durable raw artifact index entry is gone", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);
    const entries = await runtime.rawArtifactIndex.load();

    const matchingEntryIds = new Set(
      findRawArtifactEntries(entries, fixture.plainTextArtifact, fixture.sourceId).map(
        (entry) => entry.id
      )
    );

    await runtime.rawArtifactIndex.save(
      entries.filter((entry) => !matchingEntryIds.has(entry.id))
    );

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

  it("redacts obvious secrets before returning preview text", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const fixture = await loadGeminiArtifactFixture(runtime);
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.sourceId === fixture.sourceId);

    if (!record) {
      throw new Error("Expected a cached record for the Gemini source.");
    }

    record.normalized.outputArtifacts = record.normalized.outputArtifacts.map((artifact) =>
      artifact.id === fixture.plainTextArtifact.id
        ? {
            ...artifact,
            preview: "api_key=sk_live_123456\naccessToken: ghp_abcdef"
          }
        : artifact
    );
    await runtime.cacheStore.save(records);

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
    const entries = await runtime.rawArtifactIndex.load();

    await writeFile(outsidePath, "outside root", "utf8");
    const matchingEntryIds = new Set(
      findRawArtifactEntries(entries, fixture.plainTextArtifact, fixture.sourceId).map(
        (entry) => entry.id
      )
    );

    await runtime.rawArtifactIndex.save(
      entries.map((entry) =>
        matchingEntryIds.has(entry.id)
          ? {
              ...entry,
              path: outsidePath
            }
          : entry
      )
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
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.sourceId === fixture.sourceId);

    if (!record) {
      throw new Error("Expected a cached record for the Gemini source.");
    }

    record.normalized.outputArtifacts = record.normalized.outputArtifacts.map((artifact) =>
      artifact.id === fixture.plainTextArtifact.id
        ? (() => {
            const { preview: _preview, ...rest } = artifact;

            return {
              ...rest,
              contentKind: "binary" as const,
              mediaType: "image/png"
            };
          })()
        : artifact
    );
    await runtime.cacheStore.save(records);

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

  it("loads imported output artifacts after restart without the original source root", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const exportFixture = await loadGeminiArtifactFixture(exportRuntime);

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
});

async function loadGeminiArtifactFixture(
  runtime: WorkbenchRuntime,
  options: { sourceId?: string } = {}
): Promise<{
  sessionId: string;
  sourceId: string;
  plainTextArtifact: OutputArtifact;
  jsonArtifact: OutputArtifact;
  plainTextEntry: RawArtifactIndexEntry;
}> {
  const data = await loadTriageData(runtime);
  const session = [...data.sessionsById.values()].find(
    (candidate) =>
      candidate.adapterId === "gemini-cli" &&
      (options.sourceId ? candidate.sourceId === options.sourceId : true) &&
      (candidate.outputArtifactIds?.length ?? 0) > 0
  );

  if (!session) {
    throw new Error("Expected a Gemini fixture session with output artifacts.");
  }

  const outputArtifacts = data.outputArtifactsBySessionId.get(session.id) ?? [];
  const plainTextArtifact = outputArtifacts.find((artifact) => artifact.contentKind === "plain-text");
  const jsonArtifact = outputArtifacts.find(
    (artifact) => artifact.contentKind === "json-output-wrapper"
  );

  if (!plainTextArtifact || !jsonArtifact) {
    throw new Error("Expected both plain-text and JSON output artifacts.");
  }

  const entries = await runtime.rawArtifactIndex.load();
  const plainTextEntry = findRawArtifactEntries(
    entries,
    plainTextArtifact,
    session.sourceId
  )[0];

  if (!plainTextEntry) {
    throw new Error("Expected a durable raw artifact index entry for the plain-text sidecar.");
  }

  return {
    sessionId: session.id,
    sourceId: session.sourceId,
    plainTextArtifact,
    jsonArtifact,
    plainTextEntry
  };
}

function findRawArtifactEntries(
  entries: RawArtifactIndexEntry[],
  artifact: OutputArtifact,
  sourceId: string
): RawArtifactIndexEntry[] {
  const pointerId = artifact.source?.rawArtifactId ?? artifact.source?.artifactId;
  const artifactRef = artifact.nativeRef ?? artifact.nativeId ?? artifact.path;

  return entries.filter((entry) => {
    if (entry.sourceId !== sourceId || entry.artifactKind !== "output-artifact") {
      return false;
    }

    if (pointerId && entry.id === pointerId) {
      return true;
    }

    return Boolean(
      artifactRef &&
        (entry.nativeRef === artifactRef ||
          entry.nativeId === artifactRef ||
          (artifact.path && entry.path?.endsWith(path.normalize(artifact.path))))
    );
  });
}
