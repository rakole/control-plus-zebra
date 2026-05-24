import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import {
  cleanupTempDirs,
  createScannedRuntime
} from "../ipc/triage-test-runtime.js";

describe("ArchiveExporter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("writes normalized-only project archives by default and records manifest metadata", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const triageService = createTriageViewModelService({ runtime });
    const projectId = (await triageService.listProjects()).find(
      (project) => project.projectName === "control-plus-zebra"
    )?.projectId;

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project.");
    }

    const destinationPath = path.join(runtime.appDataDir, "exports", "normalized.awb-archive.json");
    const result = await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });
    const archive = JSON.parse(await readFile(destinationPath, "utf8")) as {
      manifest: {
        counts: { cacheRecords: number };
        includes: { rawArtifacts: boolean };
        scope: { kind: string };
      };
      payload: { rawArtifacts?: unknown[]; cacheRecords: unknown[]; sources: unknown[] };
    };

    expect(result.manifest.format).toBe("agent-workbench-archive");
    expect(result.manifest.includes.rawArtifacts).toBe(false);
    expect(archive.manifest.scope.kind).toBe("project");
    expect(archive.manifest.counts.cacheRecords).toBeGreaterThan(0);
    expect(archive.payload.sources.length).toBeGreaterThan(0);
    expect(archive.payload.cacheRecords.length).toBeGreaterThan(0);
    expect(
      archive.payload.cacheRecords.every(
        (record) => typeof record === "object" && record !== null && !("derived" in record)
      )
    ).toBe(true);
    expect(archive.payload.rawArtifacts).toBeUndefined();
  });

  it("includes only indexed raw artifacts when raw export is explicitly enabled", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const geminiSessionId = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "gemini-cli"
    )?.normalized.sessions[0]?.id;

    expect(geminiSessionId).toBeDefined();
    if (!geminiSessionId) {
      throw new Error("Expected a Gemini fixture session.");
    }

    const strayPath = path.join(runtime.appDataDir, "gemini-root", "not-indexed-secret.txt");
    await writeFile(strayPath, "secret", "utf8");

    const availability = await exporter.getScopeAvailability({
      kind: "session",
      sessionId: geminiSessionId
    });

    expect(availability.rawArtifactsAvailable).toBe(true);
    expect(availability.rawArtifactCount).toBeGreaterThan(0);

    const destinationPath = path.join(runtime.appDataDir, "exports", "raw.awb-archive.json");
    const result = await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: geminiSessionId }
    });
    const archive = JSON.parse(await readFile(destinationPath, "utf8")) as {
      manifest: {
        counts: { rawArtifacts: number };
        includes: { privacyWarningAcknowledged: boolean; rawArtifacts: boolean };
      };
      payload: { rawArtifacts?: Array<{ originalPath?: string; content: string }> };
    };

    expect(result.rawArtifactCount).toBeGreaterThan(0);
    expect(archive.manifest.includes.rawArtifacts).toBe(true);
    expect(archive.manifest.includes.privacyWarningAcknowledged).toBe(true);
    expect(archive.manifest.counts.rawArtifacts).toBe(result.rawArtifactCount);
    expect(archive.payload.rawArtifacts?.length).toBe(result.rawArtifactCount);
    expect(archive.payload.rawArtifacts?.every((artifact) => artifact.content.length > 0)).toBe(
      true
    );
    expect(
      archive.payload.rawArtifacts?.some((artifact) => artifact.originalPath?.endsWith("not-indexed-secret.txt"))
    ).toBe(false);
  });
});
