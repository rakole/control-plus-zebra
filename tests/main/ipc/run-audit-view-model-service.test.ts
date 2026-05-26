import { afterEach, describe, expect, it } from "vitest";

import { createRunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import {
  cleanupTempDirs,
  createHydrationDegradedRuntimeFromSeed,
  createScannedRuntime,
  createTempRuntime,
  loadGeminiArtifactFixtureFromStore
} from "./triage-test-runtime.js";

describe("run audit view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("groups audit evidence into product-facing sections with shared git truth and explicit gaps", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const records = await runtime.cacheStore.listLatestRecords();
    const sessionId = records
      .find((record) => record.adapterId === "fake-test")
      ?.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: sessionId,
        rawArtifactsAvailable: false
      })
    );
    expect(runAudit?.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Claim vs Evidence", "Git / GitHub", "Capability Gaps"])
    );
    expect(runAudit?.sections.find((section) => section.title === "Git / GitHub")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Git Snapshot", value: "Available" }),
        expect.objectContaining({ label: "GitHub Snapshot", value: "No Matching PR" }),
        expect.objectContaining({ label: "Branch", value: "main" }),
        expect.objectContaining({
          label: "Remote URL",
          value: "https://github.com/example/control-plus-zebra.git"
        }),
        expect.objectContaining({ label: "Pull Request", value: "No Matching PR" })
      ])
    );
  });

  it("uses store-backed archive availability truth for v3-imported sessions on Run Audit", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const geminiFixture = await loadGeminiArtifactFixtureFromStore(exportRuntime);
    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = `${exportRuntime.appDataDir}/exports/imported-v3-run-audit-truth.awb-archive.json`;

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: geminiFixture.sessionId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const importResult = await importer.importArchive({ archivePath });
    const importedSessionPage = await importRuntime.entityStore.listSessionsPage({
      sourceId: importResult.sourceId,
      limit: 20
    });
    const importedSessionId = importedSessionPage.items[0]?.session.id;
    const service = createRunAuditViewModelService({ runtime: importRuntime });

    expect(importedSessionId).toBeDefined();
    if (!importedSessionId) {
      throw new Error("Expected at least one imported session for run-audit availability.");
    }

    const runAudit = await service.getRunAudit({
      sessionId: importedSessionId
    });

    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: importedSessionId,
        rawArtifactsAvailable: true,
        rawArtifactCount: expect.any(Number)
      })
    );
  }, 15000);

  it("returns explicit unavailable archive truth when Run Audit archive availability lookup fails", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const sessionId = (await runtime.cacheStore.listLatestRecords())
      .find((record) => record.adapterId === "fake-test")
      ?.normalized.sessions[0]?.id;
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getArchivePreflight?: typeof runtime.entityStore.getArchivePreflight;
    };
    const originalGetArchivePreflight = entityStore.getArchivePreflight;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session for run-audit archive fallback.");
    }

    entityStore.getArchivePreflight = async () => {
      throw new Error("archive preflight unavailable");
    };

    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit).not.toBeNull();
    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: sessionId,
        rawArtifactsAvailable: false,
        rawArtifactCount: 0,
        rawArtifactsReason:
          "Archive export availability could not be resolved for this scope."
      })
    );

    entityStore.getArchivePreflight = originalGetArchivePreflight;
  }, 15_000);

  it("keeps run audit visible for cache-fallback sessions with explicit degraded archive truth", async () => {
    const seedRuntime = await createScannedRuntime(tempDirs);
    const sessionId = (await seedRuntime.cacheStore.listLatestRecords())
      .find((record) => record.adapterId === "fake-test")
      ?.normalized.sessions[0]?.id;
    const failingSourceId = (await seedRuntime.sourceRegistry.listSources()).find(
      (source) => source.adapterId === "fake-test"
    )?.sourceId;

    expect(sessionId).toBeDefined();
    expect(failingSourceId).toBeDefined();
    if (!sessionId || !failingSourceId) {
      throw new Error("Expected a fake-test source to degrade.");
    }

    const runtime = await createHydrationDegradedRuntimeFromSeed(
      tempDirs,
      seedRuntime,
      failingSourceId
    );
    const service = createRunAuditViewModelService({ runtime });
    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit).not.toBeNull();
    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: sessionId,
        rawArtifactsAvailable: false,
        rawArtifactsReason: expect.stringContaining("entity-store hydration failed")
      })
    );
  }, 15000);
});
