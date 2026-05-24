import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import {
  cleanupTempDirs,
  createScannedRuntime,
  createTempRuntime
} from "../ipc/triage-test-runtime.js";

describe("ArchiveImporter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("imports archives as persistent read-only sources and hydrates archived sessions without the original root", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = (await triageService.listProjects()).find(
      (project) => project.projectName === "control-plus-zebra"
    )?.projectId;

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "import-me.awb-archive.json");

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      cacheStore: importRuntime.cacheStore,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const sessionService = createSessionViewModelService({ runtime: importRuntime });
    const sessions = await sessionService.listSessions();

    expect(importedSource).toMatchObject({
      sourceId: result.sourceId,
      adapterId: "archive-reader",
      sourceKind: "imported-archive",
      addedBy: "import",
      readOnly: true,
      rootPath: archivePath,
      validation: { status: "unsupported" },
      scan: { status: "unsupported" },
      cache: { status: "cached" }
    });
    expect(importedSource?.archive).toMatchObject({
      archivePath,
      manifestVersion: 1,
      scopeKind: "project",
      scopeId: projectId
    });
    expect((await importRuntime.cacheStore.listLatestRecords()).map((record) => record.sourceId)).toEqual([
      result.sourceId
    ]);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.sourceId).toBe(result.sourceId);
    expect(sessions[0]?.adapterDisplayName).toBe("Fake Test Harness");
  });
});
