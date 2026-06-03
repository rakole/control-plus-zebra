import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createArchiveImportService } from "../../../src/main/app/archive-import-service.js";
import { loadTriageData } from "../../../src/main/app/triage-view-model-service.js";
import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { syncAllLatestCacheRecordsToEntityStore } from "../../../src/main/app/workbench-entity-store-sync.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import {
  ARCHIVE_V3_ENTITY_SECTION_NAMES,
  ARCHIVE_V3_MANIFEST_VERSION,
  ArchiveAggregateLimitError,
  ArchiveAggregateTracker,
  archiveVersionedLineSchema,
  createEmptyArchiveV3SectionEntityCounts,
  type ArchiveLine,
  type ArchiveV3Manifest
} from "../../../src/main/core/archive/archive-manifest.js";
import type { WorkbenchTimelineRecord } from "../../../src/main/core/store/workbench-entity-store.js";
import {
  createDiagnosticId,
  createFileMutationEvidenceId,
  createOutputArtifactId,
  createProjectId,
  createSourceId,
  createSessionEventId,
  createSessionId,
  createSessionMessageId,
  createShellCommandEvidenceId,
  createToolCallId
} from "../../../src/main/core/model/identifiers.js";
import {
  cleanupTempDirs,
  createScannedRuntime,
  createTempRuntime
} from "../ipc/triage-test-runtime.js";

type VersionedArchiveLine = ReturnType<typeof archiveVersionedLineSchema.parse>;
type ArchiveV3ManifestLine = Extract<VersionedArchiveLine, { kind: "manifest" }> & {
  manifest: ArchiveV3Manifest;
};

function isArchiveV3ManifestLine(line: VersionedArchiveLine): line is ArchiveV3ManifestLine {
  return line.kind === "manifest" && line.manifest.manifestVersion === ARCHIVE_V3_MANIFEST_VERSION;
}

describe("ArchiveImporter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("does not parse archive payloads through the old whole-document JSON path", async () => {
    const importerSource = await readFile(
      path.resolve("src/main/core/archive/archive-importer.ts"),
      "utf8"
    );

    expect(importerSource).not.toContain("readTextFile(archivePath)");
    expect(importerSource).not.toContain("archiveDocumentSchema");
    expect(importerSource).not.toContain("JSON.parse(source)");
  });

  it("rejects oversized archive lines with a bounded import error instead of parsing the document", async () => {
    const importRuntime = await createTempRuntime(tempDirs);
    const archivePath = path.join(importRuntime.appDataDir, "too-large.awb-archive.json");
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });

    await writeFile(
      archivePath,
      `${JSON.stringify({
        kind: "raw-artifact-chunk",
        chunk: {
          artifactId: "oversized",
          chunkIndex: 0,
          content: "x".repeat(5 * 1024 * 1024)
        }
      })}\n`,
      "utf8"
    );

    await expect(importer.importArchive({ archivePath })).rejects.toMatchObject({
      code: "archive-import.line-too-large"
    });
  });

  it("freezes the future v3 aggregate-limit contract while keeping v2 lines explicitly compatible", () => {
    const tracker = new ArchiveAggregateTracker({
      maxSectionCount: 2,
      maxSectionEntityCount: 1,
      maxTotalEntityCount: 3,
      maxRawArtifactChunkCountPerArtifact: 2,
      maxRawArtifactBytes: 5,
      maxSourceDiagnosticCount: 1
    });
    const sectionEntityCounts = createEmptyArchiveV3SectionEntityCounts();

    sectionEntityCounts.sources = 1;

    const v2Line = archiveVersionedLineSchema.parse({
      kind: "manifest",
      manifest: {
        format: "agent-workbench-archive",
        manifestVersion: 2,
        exportedAt: "2026-05-25T09:00:00.000Z",
        scope: {
          kind: "project",
          id: "project-1",
          label: "Project 1"
        },
        includes: {
          normalizedData: true,
          diagnostics: true,
          rawArtifacts: false,
          privacyWarningAcknowledged: true
        },
        adapters: ["fake-test"],
        sourceIds: ["source-1"],
        sessionIds: ["session-1"],
        projectIds: ["project-1"],
        counts: {
          sources: 1,
          sessions: 1,
          projects: 1,
          cacheRecords: 1,
          sourceDiagnostics: 0,
          rawArtifacts: 0
        }
      }
    });
    const v3SectionLine = archiveVersionedLineSchema.parse({
      kind: "entity-section",
      manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
      section: {
        name: "sources",
        sequence: 0,
        entityCount: sectionEntityCounts.sources
      }
    });

    tracker.recordEntity("sources");

    expect(v2Line).toMatchObject({
      kind: "manifest",
      manifest: expect.objectContaining({
        manifestVersion: 2
      })
    });
    expect(v3SectionLine).toMatchObject({
      kind: "entity-section",
      section: expect.objectContaining({
        name: "sources"
      })
    });

    expect(() => tracker.recordEntity("sessions")).not.toThrow();
    expect(() => tracker.recordEntity("sessions")).toThrowError(
      expect.objectContaining({
        code: "archive.aggregate.section-entity-count-exceeded"
      } satisfies Partial<ArchiveAggregateLimitError>)
    );
    expect(() =>
      tracker.recordRawArtifactChunk({
        artifactId: "artifact-1",
        content: "1234"
      })
    ).not.toThrow();
    expect(() =>
      tracker.recordRawArtifactChunk({
        artifactId: "artifact-1",
        content: "23"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "archive.aggregate.raw-artifact-bytes-exceeded"
      } satisfies Partial<ArchiveAggregateLimitError>)
    );

    const sectionTracker = new ArchiveAggregateTracker({
      maxSectionCount: 1,
      maxSectionEntityCount: 2,
      maxTotalEntityCount: 4,
      maxRawArtifactChunkCountPerArtifact: 2,
      maxRawArtifactBytes: 10,
      maxSourceDiagnosticCount: 1
    });

    sectionTracker.recordSection("sources");
    expect(() => sectionTracker.recordSection("sessions")).toThrowError(
      expect.objectContaining({
        code: "archive.aggregate.section-count-exceeded"
      } satisfies Partial<ArchiveAggregateLimitError>)
    );

    const totalEntityTracker = new ArchiveAggregateTracker({
      maxSectionCount: 3,
      maxSectionEntityCount: 2,
      maxTotalEntityCount: 1,
      maxRawArtifactChunkCountPerArtifact: 2,
      maxRawArtifactBytes: 10,
      maxSourceDiagnosticCount: 1
    });

    totalEntityTracker.recordEntity("sources");
    expect(() => totalEntityTracker.recordEntity("sessions")).toThrowError(
      expect.objectContaining({
        code: "archive.aggregate.total-entity-count-exceeded"
      } satisfies Partial<ArchiveAggregateLimitError>)
    );

    const chunkTracker = new ArchiveAggregateTracker({
      maxSectionCount: 2,
      maxSectionEntityCount: 2,
      maxTotalEntityCount: 4,
      maxRawArtifactChunkCountPerArtifact: 1,
      maxRawArtifactBytes: 10,
      maxSourceDiagnosticCount: 1
    });

    expect(() =>
      chunkTracker.recordRawArtifactChunk({
        artifactId: "artifact-2",
        content: "1"
      })
    ).not.toThrow();
    expect(() =>
      chunkTracker.recordRawArtifactChunk({
        artifactId: "artifact-2",
        content: "2"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "archive.aggregate.raw-artifact-chunk-count-exceeded"
      } satisfies Partial<ArchiveAggregateLimitError>)
    );

    const diagnosticTracker = new ArchiveAggregateTracker({
      maxSectionCount: 2,
      maxSectionEntityCount: 2,
      maxTotalEntityCount: 4,
      maxRawArtifactChunkCountPerArtifact: 2,
      maxRawArtifactBytes: 10,
      maxSourceDiagnosticCount: 1
    });

    diagnosticTracker.recordSourceDiagnostic();
    expect(() => diagnosticTracker.recordSourceDiagnostic()).toThrowError(
      expect.objectContaining({
        code: "archive.aggregate.source-diagnostic-count-exceeded"
      } satisfies Partial<ArchiveAggregateLimitError>)
    );
  });

  it(
    "imports the live v3 exporter line format through the staged entity-store path",
    async () => {
      const exportRuntime = await createScannedRuntime(tempDirs);
      const triageData = await loadTriageData(exportRuntime);
      const sessionId = [...triageData.sessionsById.values()].find(
        (session) =>
          session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
      )?.id;

      expect(sessionId).toBeDefined();
      if (!sessionId) {
        throw new Error("Expected a Gemini session with output artifacts to export.");
      }

      const exporter = new ArchiveExporter({
        cacheStore: exportRuntime.cacheStore,
        entityStore: exportRuntime.entityStore,
        rawArtifactIndex: exportRuntime.rawArtifactIndex,
        sourceRegistry: exportRuntime.sourceRegistry
      });
      const archivePath = path.join(exportRuntime.appDataDir, "exports", "live-v3.awb-archive.json");

      await exporter.createArchive({
        destinationPath: archivePath,
        includeRawArtifacts: true,
        privacyWarningAcknowledged: true,
        scope: { kind: "session", sessionId }
      });

      const importRuntime = await createTempRuntime(tempDirs);
      const importer = new ArchiveImporter({
        appDataDir: importRuntime.appDataDir,
        cacheStore: importRuntime.cacheStore,
        entityStore: importRuntime.entityStore,
        rawArtifactIndex: importRuntime.rawArtifactIndex,
        sourceRegistry: importRuntime.sourceRegistry
      });
      const result = await importer.importArchive({ archivePath });
      const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
      const currentRun = await importRuntime.entityStore.getCurrentIngestRun({
        sourceId: result.sourceId
      });
      const sessions = await createSessionViewModelService({
        runtime: importRuntime
      }).listSessions();
      const rawArtifacts = await importRuntime.entityStore.listRawArtifactMetadata({
        sourceId: result.sourceId
      });
      const pathBackedArtifacts = rawArtifacts.filter(
        (artifact) => typeof artifact.entry?.path === "string"
      );

      expect(result.manifest.manifestVersion).toBe(ARCHIVE_V3_MANIFEST_VERSION);
      expect((await importRuntime.cacheStore.listLatestRecords())).toEqual([]);
      expect(importedSource?.rootPath).toContain(
        path.join(importRuntime.appDataDir, "imports", "archives")
      );
      expect(currentRun?.status).toBe("published");
      expect(sessions.some((session) => session.sourceId === result.sourceId)).toBe(true);
      expect(pathBackedArtifacts.length).toBeGreaterThan(0);
      expect(await readFile(pathBackedArtifacts[0]!.entry!.path!, "utf8")).not.toHaveLength(0);
    },
    15_000
  );

  it("imports v3 metadata without over-reporting raw artifacts when raw export is disabled", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageData = await loadTriageData(exportRuntime);
    const sessionId = [...triageData.sessionsById.values()].find(
      (session) =>
        session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
    )?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a Gemini session with output artifacts to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "live-v3-no-raw.awb-archive.json");

    const exportResult = await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const rawMetadata = await importRuntime.entityStore.listRawArtifactMetadata({
      sourceId: result.sourceId
    });

    expect(exportResult.manifest.includes.rawArtifacts).toBe(false);
    expect(exportResult.manifest.counts.rawArtifacts).toBe(0);
    expect(importedSource?.archive?.rawArtifactCount).toBe(0);
    expect(rawMetadata.length).toBeGreaterThan(0);
  }, 15_000);

  it("rejects v3 archives whose manifest aggregate limits are lower than the staged payload", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageData = await loadTriageData(exportRuntime);
    const sessionId = [...triageData.sessionsById.values()].find(
      (session) =>
        session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
    )?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a Gemini session with output artifacts to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "v3-aggregate-limit.awb-archive.json");

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId }
    });

    const archiveLines = (await readFile(archivePath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const manifestLine = archiveLines[0] as {
      kind: string;
      manifest: ArchiveV3Manifest;
    };

    manifestLine.manifest = {
      ...manifestLine.manifest,
      aggregateLimits: {
        ...manifestLine.manifest.aggregateLimits,
        maxTotalEntityCount: Math.max(1, manifestLine.manifest.counts.totalEntities - 1)
      }
    };

    await writeFile(
      archivePath,
      `${archiveLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      "utf8"
    );

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });

    await expect(importer.importArchive({ archivePath })).rejects.toMatchObject({
      code: "archive-import.invalid-archive",
      message: expect.stringContaining("entity aggregate limit")
    });
  });

  it(
    "rolls back source registration, staging runs, and materialized files when v3 publish fails",
    async () => {
      const fixedNow = () => new Date("2026-05-25T12:34:56.000Z");
      const exportRuntime = await createScannedRuntime(tempDirs);
      const triageData = await loadTriageData(exportRuntime);
      const sessionId = [...triageData.sessionsById.values()].find(
        (session) =>
          session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
      )?.id;

      expect(sessionId).toBeDefined();
      if (!sessionId) {
        throw new Error("Expected a Gemini session with output artifacts to export.");
      }

      const exporter = new ArchiveExporter({
        cacheStore: exportRuntime.cacheStore,
        entityStore: exportRuntime.entityStore,
        rawArtifactIndex: exportRuntime.rawArtifactIndex,
        sourceRegistry: exportRuntime.sourceRegistry
      });
      const archivePath = path.join(exportRuntime.appDataDir, "exports", "v3-publish-fail.awb-archive.json");

      await exporter.createArchive({
        destinationPath: archivePath,
        includeRawArtifacts: true,
        privacyWarningAcknowledged: true,
        scope: { kind: "session", sessionId }
      });

      const { archivedSources } = await readArchiveV3(archivePath);
      const archivedSource = archivedSources[0];

      expect(archivedSource).toBeDefined();
      if (!archivedSource) {
        throw new Error("Expected a v3 archived source payload.");
      }

      const importRuntime = await createTempRuntime(tempDirs);
      const entityStore = importRuntime.entityStore as typeof importRuntime.entityStore & {
        publishIngestRun: typeof importRuntime.entityStore.publishIngestRun;
      };
      const originalPublishIngestRun = entityStore.publishIngestRun.bind(importRuntime.entityStore);

      entityStore.publishIngestRun = async () => {
        throw new Error("forced v3 publish failure");
      };

      const importer = new ArchiveImporter({
        appDataDir: importRuntime.appDataDir,
        cacheStore: importRuntime.cacheStore,
        entityStore,
        now: fixedNow,
        rawArtifactIndex: importRuntime.rawArtifactIndex,
        sourceRegistry: importRuntime.sourceRegistry
      });
      const expectedSourceId = createSourceId(
        archivedSource.adapterId,
        `${archivePath}:${archivedSource.sourceId}`
      );

      await expect(importer.importArchive({ archivePath })).rejects.toThrow(
        "forced v3 publish failure"
      );
      entityStore.publishIngestRun =
        originalPublishIngestRun as typeof entityStore.publishIngestRun;
      expect(await importRuntime.sourceRegistry.getSource(expectedSourceId)).toBeUndefined();
      expect(
        await importRuntime.entityStore.getCurrentIngestRun({ sourceId: expectedSourceId })
      ).toBeUndefined();
      expect(
        await readDirectoryOrEmpty(path.join(importRuntime.appDataDir, "imports", "archives"))
      ).toEqual([]);
    },
    15_000
  );

  it(
    "syncs every imported v2 source into the entity store through the archive import service",
    async () => {
      const exportRuntime = await createScannedRuntime(tempDirs);
      const triageData = await loadTriageData(exportRuntime);
      const fakeSessionId = [...triageData.sessionsById.values()].find(
        (session) => session.adapterId === "fake-test"
      )?.id;
      const geminiSessionId = [...triageData.sessionsById.values()].find(
        (session) => session.adapterId === "gemini-cli"
      )?.id;

      expect(fakeSessionId).toBeDefined();
      expect(geminiSessionId).toBeDefined();
      if (!fakeSessionId || !geminiSessionId) {
        throw new Error("Expected one fake-test and one gemini-cli session to export.");
      }

      const exporter = new ArchiveExporter({
        cacheStore: exportRuntime.cacheStore,
        rawArtifactIndex: exportRuntime.rawArtifactIndex,
        sourceRegistry: exportRuntime.sourceRegistry
      });
      const fakeArchivePath = path.join(exportRuntime.appDataDir, "exports", "fake-v2.awb-archive.json");
      const geminiArchivePath = path.join(
        exportRuntime.appDataDir,
        "exports",
        "gemini-v2.awb-archive.json"
      );

      await exporter.createArchive({
        destinationPath: fakeArchivePath,
        includeRawArtifacts: false,
        privacyWarningAcknowledged: true,
        scope: { kind: "session", sessionId: fakeSessionId }
      });
      await exporter.createArchive({
        destinationPath: geminiArchivePath,
        includeRawArtifacts: false,
        privacyWarningAcknowledged: true,
        scope: { kind: "session", sessionId: geminiSessionId }
      });

      const combinedArchivePath = path.join(
        exportRuntime.appDataDir,
        "exports",
        "combined-v2.awb-archive.json"
      );

      await writeArchiveV2(
        combinedArchivePath,
        combineV2Archives(
          (await readArchiveV2(fakeArchivePath)).lines,
          (await readArchiveV2(geminiArchivePath)).lines
        )
      );

      const importRuntime = await createTempRuntime(tempDirs);
      const importService = createArchiveImportService({
        runtime: importRuntime,
        selectArchivePath: async () => combinedArchivePath
      });
      const result = await importService.openArchive({ archivePath: combinedArchivePath });
      const importedSources = (await importRuntime.sourceRegistry.listSources()).filter(
        (source) => source.sourceKind === "imported-archive"
      );

      expect(result).toMatchObject({
        status: "imported",
        manifestVersion: 2
      });
      expect(importedSources).toHaveLength(2);

      for (const importedSource of importedSources) {
        expect(
          await importRuntime.entityStore.getCurrentIngestRun({
            sourceId: importedSource.sourceId
          })
        ).toBeDefined();
        expect(
          (
            await importRuntime.entityStore.listSessionsPage({
              sourceId: importedSource.sourceId,
              limit: 20
            })
          ).items.length
        ).toBeGreaterThan(0);
      }
    },
    15_000
  );

  it(
    "rolls back already-published v3 source runs when a later publish fails",
    async () => {
      const exportRuntime = await createScannedRuntime(tempDirs);
      const triageData = await loadTriageData(exportRuntime);
      const geminiSessionId = [...triageData.sessionsById.values()].find(
        (session) => session.adapterId === "gemini-cli"
      )?.id;
      const fakeSessionId = [...triageData.sessionsById.values()].find(
        (session) => session.adapterId === "fake-test"
      )?.id;

      expect(geminiSessionId).toBeDefined();
      expect(fakeSessionId).toBeDefined();
      if (!geminiSessionId || !fakeSessionId) {
        throw new Error("Expected Gemini and fake-test sessions to export.");
      }

      const exporter = new ArchiveExporter({
        cacheStore: exportRuntime.cacheStore,
        entityStore: exportRuntime.entityStore,
        rawArtifactIndex: exportRuntime.rawArtifactIndex,
        sourceRegistry: exportRuntime.sourceRegistry
      });
      const geminiArchivePath = path.join(exportRuntime.appDataDir, "exports", "gemini-v3.awb-archive.json");
      const fakeArchivePath = path.join(exportRuntime.appDataDir, "exports", "fake-v3.awb-archive.json");

      await exporter.createArchive({
        destinationPath: geminiArchivePath,
        includeRawArtifacts: false,
        privacyWarningAcknowledged: true,
        scope: { kind: "session", sessionId: geminiSessionId }
      });
      await exporter.createArchive({
        destinationPath: fakeArchivePath,
        includeRawArtifacts: false,
        privacyWarningAcknowledged: true,
        scope: { kind: "session", sessionId: fakeSessionId }
      });

      const combinedArchivePath = path.join(
        exportRuntime.appDataDir,
        "exports",
        "combined-v3-publish-failure.awb-archive.json"
      );
      await writeFile(
        combinedArchivePath,
        `${combineV3Archives(
          await readArchiveV3Lines(geminiArchivePath),
          await readArchiveV3Lines(fakeArchivePath)
        )
          .map((line) => JSON.stringify(line))
          .join("\n")}\n`,
        "utf8"
      );

      const importRuntime = await createTempRuntime(tempDirs);
      const entityStore = importRuntime.entityStore as typeof importRuntime.entityStore & {
        publishIngestRun: typeof importRuntime.entityStore.publishIngestRun;
      };
      const originalPublishIngestRun = entityStore.publishIngestRun.bind(importRuntime.entityStore);
      let publishCount = 0;

      entityStore.publishIngestRun = async (input) => {
        publishCount += 1;

        if (publishCount === 2) {
          throw new Error("forced v3 partial publish failure");
        }

        return originalPublishIngestRun(input);
      };

      const importer = new ArchiveImporter({
        appDataDir: importRuntime.appDataDir,
        cacheStore: importRuntime.cacheStore,
        entityStore,
        rawArtifactIndex: importRuntime.rawArtifactIndex,
        sourceRegistry: importRuntime.sourceRegistry
      });
      const { archivedSources } = await readArchiveV3(combinedArchivePath);

      await expect(importer.importArchive({ archivePath: combinedArchivePath })).rejects.toThrow(
        "forced v3 partial publish failure"
      );
      entityStore.publishIngestRun =
        originalPublishIngestRun as typeof entityStore.publishIngestRun;

      expect(publishCount).toBe(2);

      for (const archivedSource of archivedSources) {
        const expectedSourceId = createSourceId(
          archivedSource.adapterId,
          `${combinedArchivePath}:${archivedSource.sourceId}`
        );

        expect(await importRuntime.sourceRegistry.getSource(expectedSourceId)).toBeUndefined();
        expect(
          await importRuntime.entityStore.getCurrentIngestRun({ sourceId: expectedSourceId })
        ).toBeUndefined();
      }
    },
    15_000
  );

  it(
    "imports archives as persistent read-only sources and hydrates archived sessions without the original root",
    async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

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
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const sessionService = createSessionViewModelService({ runtime: importRuntime });
    const sessions = await sessionService.listSessions();

    expect(importedSource).toMatchObject({
      sourceId: result.sourceId,
      adapterId: expect.not.stringMatching(/^archive-reader$/u),
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
      manifestVersion: 2,
      scopeKind: "project",
      scopeId: projectId
    });
    expect((await importRuntime.cacheStore.listLatestRecords()).map((record) => record.sourceId)).toEqual([
      result.sourceId
    ]);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.sourceId).toBe(result.sourceId);
    expect(sessions[0]?.adapterId).toBe(importedSource?.adapterId);
    expect(sessions[0]?.adapterDisplayName).toBeTruthy();
    },
    15_000
  );

  it("falls back to archived entity ids when Wave 2 compatibility data omits native ids", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "wave-2-compat.awb-archive.json");

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = await readArchiveV2(archivePath);
    const archivedSession = archive.cacheRecords
      .flatMap((record) => record.normalized.sessions)
      .find((session) => session.nativeId);

    expect(archivedSession).toBeDefined();
    if (!archivedSession) {
      throw new Error("Expected an archived session with stable identity fields.");
    }

    delete archivedSession.nativeId;
    await writeArchiveV2(archivePath, archive.lines);

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSessions = (await importRuntime.cacheStore.listLatestRecords()).flatMap(
      (record) => record.normalized.sessions
    );
    const expectedImportedSessionId = createSessionId({
      adapterId: archivedSession.adapterId,
      sourceId: result.sourceId,
      nativeId: archivedSession.id
    });

    expect(importedSessions.map((session) => session.id)).toContain(expectedImportedSessionId);
    expect(importedSessions.some((session) => session.id.includes("unknown-source"))).toBe(false);
    expect(importedSessions.some((session) => session.id.includes("unknown-native"))).toBe(false);
  }, 15_000);

  it("rebases linked entity references across imported archive graphs", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "rebased-graph.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = await readArchiveV2(archivePath);
    const normalized = archive.cacheRecords[0]?.normalized as
      | {
          projects: MutableArchivedEntity[];
          sessions: MutableArchivedEntity[];
          events: MutableArchivedEntity[];
          messages: MutableArchivedEntity[];
          toolCalls: MutableArchivedEntity[];
          shellCommands: MutableArchivedEntity[];
          outputArtifacts: MutableArchivedEntity[];
          fileMutations: MutableArchivedEntity[];
        }
      | undefined;

    expect(normalized).toBeDefined();
    if (!normalized) {
      throw new Error("Expected an exported normalized payload.");
    }

    const project = normalized.projects[0];
    const session = normalized.sessions[0];
    const event = normalized.events[0];
    const message = normalized.messages[0];
    const toolCall = normalized.toolCalls[0];
    const shellCommand = normalized.shellCommands[0];
    const outputArtifact = normalized.outputArtifacts[0];

    expect(project).toBeDefined();
    expect(session).toBeDefined();
    expect(event).toBeDefined();
    expect(message).toBeDefined();
    expect(toolCall).toBeDefined();
    expect(shellCommand).toBeDefined();
    expect(outputArtifact).toBeDefined();

    if (
      !project ||
      !session ||
      !event ||
      !message ||
      !toolCall ||
      !shellCommand ||
      !outputArtifact
    ) {
      throw new Error("Expected at least one archived entity of each linked type.");
    }

    const fileMutation =
      normalized.fileMutations[0] ??
      ({
        id: "archived-file-mutation-link-test",
        adapterId: String(session.adapterId),
        sourceId: String(session.sourceId),
        sessionId: String(session.id),
        path: "src/generated-importer-link-test.ts",
        mutationKind: "updated",
        source: { path: "src/generated-importer-link-test.ts" },
        confidence: "observed",
        diagnostics: []
      } satisfies MutableArchivedEntity);

    if (normalized.fileMutations.length === 0) {
      normalized.fileMutations.push(fileMutation);
    }

    project.sessionIds = [session.id];
    session.projectId = project.id;
    session.messageIds = [message.id];
    session.eventIds = [event.id];
    session.toolCallIds = [toolCall.id];
    session.fileMutationIds = [fileMutation.id];
    session.shellCommandIds = [shellCommand.id];
    session.outputArtifactIds = [outputArtifact.id];
    session.parsedShellCommands = [
      {
        shellCommandId: shellCommand.id,
        command: String(shellCommand.command ?? "npm run typecheck"),
        intent: "typecheck",
        result: "failed",
        outputSource: "combined",
        outputTextSource: "summary",
        exitCode: 1,
        exitCodeSource: "evidence",
        rawToolStatus: "failed",
        toolCallId: toolCall.id,
        artifactIds: [outputArtifact.id],
        failureMarkers: ["command failed"],
        confidence: {
          level: "high",
          normalizedLevel: "confirmed"
        }
      }
    ];
    session.verification = {
      state: "failed",
      commandsRun: 1,
      verificationCommandsRun: 1,
      buildRan: false,
      testsRan: false,
      typecheckRan: true,
      lintRan: false,
      failedCommandIds: [shellCommand.id],
      passedCommandIds: [shellCommand.id],
      summary: "Archive importer should rebase verification command refs.",
      confidence: "observed",
      diagnostics: []
    };
    session.runAudit = {
      sessionId: session.id,
      adapterId: String(session.adapterId),
      classification: "needs-review",
      agentClaimedCompleted: "unknown",
      finalAnswerPresent: true,
      requestCancelled: false,
      verificationCommandsRun: true,
      shellExitCodes: [1],
      failedTestsDetected: false,
      attentionReasons: ["parser-warning"],
      summary: "Archive importer should rebase run-audit session refs.",
      confidence: "observed",
      diagnostics: []
    };
    event.sessionId = session.id;
    message.sessionId = session.id;
    message.toolCallIds = [toolCall.id];
    message.eventIds = [event.id];
    toolCall.sessionId = session.id;
    toolCall.source = {
      adapterId: String(toolCall.adapterId),
      sourceId: String(toolCall.sourceId),
      eventId: String(event.id)
    };
    toolCall.outputArtifactIds = [outputArtifact.id];
    toolCall.fileMutationId = fileMutation.id;
    toolCall.shellCommandId = shellCommand.id;
    shellCommand.sessionId = session.id;
    shellCommand.toolCallId = toolCall.id;
    shellCommand.source = {
      adapterId: String(shellCommand.adapterId),
      sourceId: String(shellCommand.sourceId),
      eventId: String(event.id)
    };
    shellCommand.outputArtifactIds = [outputArtifact.id];
    outputArtifact.sessionId = session.id;
    const outputArtifactSource = outputArtifact.source as
      | { artifactId?: unknown }
      | undefined;
    outputArtifact.source = {
      adapterId: String(outputArtifact.adapterId),
      sourceId: String(outputArtifact.sourceId),
      artifactId:
        typeof outputArtifactSource?.artifactId === "string"
          ? String(outputArtifactSource.artifactId)
          : "archived-output-artifact-source",
      eventId: String(event.id)
    };
    outputArtifact.ref = {
      adapterId: String(outputArtifact.adapterId),
      sourceId: String(outputArtifact.sourceId),
      id: String(outputArtifact.id),
      sessionId: String(session.id),
      ...(outputArtifact.nativeRef
        ? { nativeRef: String(outputArtifact.nativeRef) }
        : {}),
      ...(outputArtifact.path ? { path: String(outputArtifact.path) } : {})
    };
    fileMutation.sessionId = session.id;
    fileMutation.toolCallId = toolCall.id;
    fileMutation.source = {
      adapterId: String(fileMutation.adapterId),
      sourceId: String(fileMutation.sourceId),
      eventId: String(event.id),
      path: String(fileMutation.path)
    };

    await writeArchiveV2(archivePath, archive.lines);

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedNormalized = (await importRuntime.cacheStore.listLatestRecords())[0]
      ?.normalized;

    expect(importedNormalized).toBeDefined();
    if (!importedNormalized) {
      throw new Error("Expected imported normalized payload.");
    }

    const expectedProjectId = buildExpectedImportedId("project", project, result.sourceId);
    const expectedSessionId = buildExpectedImportedId("session", session, result.sourceId);
    const expectedEventId = buildExpectedImportedId("event", event, result.sourceId);
    const expectedMessageId = buildExpectedImportedId("message", message, result.sourceId);
    const expectedToolCallId = buildExpectedImportedId(
      "toolCall",
      toolCall,
      result.sourceId
    );
    const expectedShellCommandId = buildExpectedImportedId(
      "shellCommand",
      shellCommand,
      result.sourceId
    );
    const expectedOutputArtifactId = buildExpectedImportedId(
      "outputArtifact",
      outputArtifact,
      result.sourceId
    );
    const expectedFileMutationId = buildExpectedImportedId(
      "fileMutation",
      fileMutation,
      result.sourceId
    );

    const importedProject = importedNormalized.projects.find(
      (item) => item.id === expectedProjectId
    );
    const importedSession = importedNormalized.sessions.find(
      (item) => item.id === expectedSessionId
    );
    const importedEvent = importedNormalized.events.find(
      (item) => item.id === expectedEventId
    );
    const importedMessage = importedNormalized.messages.find(
      (item) => item.id === expectedMessageId
    );
    const importedToolCall = importedNormalized.toolCalls.find(
      (item) => item.id === expectedToolCallId
    );
    const importedShellCommand = importedNormalized.shellCommands.find(
      (item) => item.id === expectedShellCommandId
    );
    const importedOutputArtifact = importedNormalized.outputArtifacts.find(
      (item) => item.id === expectedOutputArtifactId
    );
    const importedFileMutation = importedNormalized.fileMutations.find(
      (item) => item.id === expectedFileMutationId
    );

    expect(importedProject?.sessionIds).toEqual([expectedSessionId]);
    expect(importedSession).toMatchObject({
      projectId: expectedProjectId,
      messageIds: [expectedMessageId],
      eventIds: [expectedEventId],
      toolCallIds: [expectedToolCallId],
      fileMutationIds: [expectedFileMutationId],
      shellCommandIds: [expectedShellCommandId],
      outputArtifactIds: [expectedOutputArtifactId]
    });
    expect(importedSession?.verification).toMatchObject({
      failedCommandIds: [expectedShellCommandId],
      passedCommandIds: [expectedShellCommandId]
    });
    expect(importedSession?.parsedShellCommands?.[0]).toMatchObject({
      shellCommandId: expectedShellCommandId,
      toolCallId: expectedToolCallId,
      artifactIds: [expectedOutputArtifactId]
    });
    expect(importedSession?.runAudit).toMatchObject({
      sessionId: expectedSessionId
    });
    expect(importedEvent).toMatchObject({
      sessionId: expectedSessionId
    });
    expect(importedMessage).toMatchObject({
      sessionId: expectedSessionId,
      toolCallIds: [expectedToolCallId],
      eventIds: [expectedEventId]
    });
    expect(importedToolCall).toMatchObject({
      sessionId: expectedSessionId,
      outputArtifactIds: [expectedOutputArtifactId],
      fileMutationId: expectedFileMutationId,
      shellCommandId: expectedShellCommandId
    });
    expect(importedShellCommand).toMatchObject({
      sessionId: expectedSessionId,
      toolCallId: expectedToolCallId,
      outputArtifactIds: [expectedOutputArtifactId]
    });
    expect(importedOutputArtifact).toMatchObject({
      sessionId: expectedSessionId,
      ref: {
        sourceId: result.sourceId,
        id: expectedOutputArtifactId,
        sessionId: expectedSessionId
      }
    });
    expect(importedFileMutation).toMatchObject({
      sessionId: expectedSessionId,
      toolCallId: expectedToolCallId
    });

    await syncAllLatestCacheRecordsToEntityStore(importRuntime);

    const timelineRecords = await listTimelineRecordsForSession(
      importRuntime,
      result.sourceId,
      expectedSessionId
    );
    const linkedTimelineRecord = timelineRecords.find(
      (record) => record.event.id === expectedEventId
    );

    expect(linkedTimelineRecord?.toolCall?.id).toBe(expectedToolCallId);
    expect(linkedTimelineRecord?.shellCommand?.id).toBe(expectedShellCommandId);
    expect(linkedTimelineRecord?.fileMutation?.id).toBe(expectedFileMutationId);
    expect(linkedTimelineRecord?.outputArtifacts?.map((artifact) => artifact.id)).toContain(
      expectedOutputArtifactId
    );
  }, 15_000);

  it("rebases imported diagnostics onto imported source and entity ids", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "rebased-diagnostics.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = await readArchiveV2(archivePath);
    const normalized = archive.cacheRecords[0]?.normalized as
      | {
          sessions: MutableArchivedEntity[];
          toolCalls: MutableArchivedEntity[];
          diagnostics: MutableArchivedDiagnostic[];
        }
      | undefined;

    expect(normalized).toBeDefined();
    if (!normalized) {
      throw new Error("Expected an exported normalized payload.");
    }

    const session = normalized.sessions[0];
    const toolCall = normalized.toolCalls[0];

    expect(session).toBeDefined();
    expect(toolCall).toBeDefined();

    if (!session || !toolCall) {
      throw new Error("Expected archived session and tool call entities.");
    }

    const adapterId = String(session.adapterId);
    const archivedSourceId = String(session.sourceId);
    const topLevelDiagnosticId = "archived-top-level-diagnostic";
    const embeddedDiagnosticId = "archived-embedded-diagnostic";
    const sourceDiagnosticId = "archived-source-diagnostic";
    const diagnosticConfidence = {
      level: "medium",
      normalizedLevel: "observed"
    } as const;

    normalized.diagnostics.push({
      id: topLevelDiagnosticId,
      code: "archive.import.top-level",
      message: "Top-level imported diagnostics should rebase related ids.",
      severity: "warning",
      scope: "session",
      adapterId,
      sourceId: archivedSourceId,
      relatedEntityIds: [String(session.id), String(toolCall.id)],
      confidence: diagnosticConfidence
    });
    session.diagnostics = [
      ...((session.diagnostics as MutableArchivedDiagnostic[] | undefined) ?? []),
      {
        id: embeddedDiagnosticId,
        code: "archive.import.embedded",
        message: "Embedded diagnostics should rebase related ids.",
        severity: "warning",
        scope: "session",
        adapterId,
        sourceId: archivedSourceId,
        relatedEntityIds: [String(toolCall.id)],
        confidence: diagnosticConfidence
      }
    ];
    archive.lines.push({
      kind: "source-diagnostic",
      diagnostic: {
        id: sourceDiagnosticId,
        code: "archive.import.source",
        message: "Source diagnostics should rebase imported ids.",
        severity: "warning",
        scope: "source",
        adapterId,
        sourceId: archivedSourceId,
        relatedEntityIds: [String(session.id), String(toolCall.id)],
        confidence: diagnosticConfidence
      }
    } satisfies ArchiveLine);

    await writeArchiveV2(archivePath, archive.lines);

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedRecord = (await importRuntime.cacheStore.listLatestRecords()).find(
      (record) => record.sourceId === result.sourceId
    );
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const expectedSessionId = buildExpectedImportedId("session", session, result.sourceId);
    const expectedToolCallId = buildExpectedImportedId(
      "toolCall",
      toolCall,
      result.sourceId
    );
    const expectedTopLevelDiagnosticId = createDiagnosticId({
      adapterId,
      sourceId: result.sourceId,
      nativeId: topLevelDiagnosticId
    });
    const expectedEmbeddedDiagnosticId = createDiagnosticId({
      adapterId,
      sourceId: result.sourceId,
      nativeId: embeddedDiagnosticId
    });
    const expectedSourceDiagnosticId = createDiagnosticId({
      adapterId,
      sourceId: result.sourceId,
      nativeId: sourceDiagnosticId
    });

    expect(importedRecord?.normalized.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expectedTopLevelDiagnosticId,
          sourceId: result.sourceId,
          relatedEntityIds: [expectedSessionId, expectedToolCallId]
        })
      ])
    );
    expect(
      importedRecord?.normalized.sessions.find(
        (item) => item.id === expectedSessionId
      )?.diagnostics
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expectedEmbeddedDiagnosticId,
          sourceId: result.sourceId,
          relatedEntityIds: [expectedToolCallId]
        })
      ])
    );
    expect(importedSource?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expectedSourceDiagnosticId,
          sourceId: result.sourceId,
          relatedEntityIds: [expectedSessionId, expectedToolCallId]
        })
      ])
    );
    expect(importedSource?.cache.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expectedSourceDiagnosticId,
          sourceId: result.sourceId,
          relatedEntityIds: [expectedSessionId, expectedToolCallId]
        })
      ])
    );
  });

  it("materializes archived raw artifacts into an import-owned root and rebases durable index paths", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageData = await loadTriageData(exportRuntime);
    const sessionId = [...triageData.sessionsById.values()].find(
      (session) =>
        session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
    )?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a Gemini session with output artifacts to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "materialized-raw-artifacts.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const importedEntries = await importRuntime.rawArtifactIndex.listSourceEntries(result.sourceId);
    const cachedRecord = (await importRuntime.cacheStore.listLatestRecords()).find(
      (record) => record.sourceId === result.sourceId
    );
    const pathBackedEntries = importedEntries.filter(
      (entry) => typeof entry.path === "string"
    );
    const materializedEntry =
      importedEntries.find(
        (entry) => entry.artifactKind === "output-artifact" && entry.path
      ) ?? pathBackedEntries[0];

    expect(importedSource).toBeDefined();
    expect(importedSource?.archive?.archivePath).toBe(archivePath);
    expect(importedSource?.rootPath).not.toBe(archivePath);
    expect(importedSource?.rootPath).toContain(
      path.join(importRuntime.appDataDir, "imports", "archives")
    );
    expect(importedEntries.length).toBeGreaterThan(0);
    expect(pathBackedEntries.length).toBeGreaterThan(0);
    expect(materializedEntry?.path).toBeDefined();
    expect(materializedEntry?.path).toContain(importedSource?.rootPath ?? "");
    expect(materializedEntry?.path?.startsWith(exportRuntime.appDataDir)).toBe(false);
    expect(await readFile(materializedEntry?.path ?? "", "utf8")).not.toHaveLength(0);
    expect((await stat(materializedEntry?.path ?? "")).isFile()).toBe(true);
    expect(cachedRecord?.rawArtifactIndex?.entries.some((entry) => entry.path)).toBe(true);
    expect(
      cachedRecord?.rawArtifactIndex?.entries
        .filter((entry) => entry.path)
        .every((entry) => entry.path?.startsWith(importedSource?.rootPath ?? ""))
    ).toBe(true);
    expect(JSON.stringify(cachedRecord?.normalized)).not.toContain(
      path.join(exportRuntime.appDataDir, "gemini-root")
    );
  });

  it("removes the previous materialized root when the same v3 archive is imported again", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageData = await loadTriageData(exportRuntime);
    const sessionId = [...triageData.sessionsById.values()].find(
      (session) =>
        session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
    )?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a Gemini session with output artifacts to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "repeat-import-materialized-root.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const firstImporter = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const firstImport = await firstImporter.importArchive({ archivePath });
    const firstRootPath = firstImport.sourceRecord.rootPath;

    expect(firstRootPath).toContain(path.join(importRuntime.appDataDir, "imports", "archives"));
    expect((await stat(firstRootPath)).isDirectory()).toBe(true);

    const secondImporter = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      now: () => new Date("2026-05-25T12:05:00.000Z"),
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const secondImport = await secondImporter.importArchive({ archivePath });
    const secondRootPath = secondImport.sourceRecord.rootPath;

    expect(secondRootPath).not.toBe(firstRootPath);
    await expect(stat(firstRootPath)).rejects.toThrow();
    expect((await stat(secondRootPath)).isDirectory()).toBe(true);
  });
});

type MutableArchivedEntity = {
  id: string;
  adapterId?: string;
  nativeId?: string;
  sourceId?: string;
  [key: string]: unknown;
};

type MutableArchivedDiagnostic = {
  id: string;
  adapterId: string;
  sourceId?: string;
  relatedEntityIds?: string[];
  [key: string]: unknown;
};

async function getExportProjectId(
  triageService: ReturnType<typeof createTriageViewModelService>
): Promise<string | undefined> {
  const projects = await triageService.listProjects();

  return (
    projects.find(
      (project) =>
        project.projectName === "control-plus-zebra" ||
        project.projectDisplayName === "control-plus-zebra"
    ) ?? projects[0]
  )?.projectId;
}

async function listTimelineRecordsForSession(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string,
  sessionId: string
): Promise<WorkbenchTimelineRecord[]> {
  const records: WorkbenchTimelineRecord[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await runtime.entityStore.getSessionTimelinePage({
      sourceId,
      sessionId,
      ...(cursor ? { cursor } : {}),
      limit: 100
    });

    records.push(...page.items);

    if (!page.pageInfo.nextCursor) {
      return records;
    }

    cursor = page.pageInfo.nextCursor;
  }
}

function buildExpectedImportedId(
  entityKind:
    | "project"
    | "session"
    | "event"
    | "message"
    | "toolCall"
    | "shellCommand"
    | "outputArtifact"
    | "fileMutation",
  entity: {
    adapterId?: string;
    id: string;
    nativeId?: string;
    sourceId?: string;
  },
  importedSourceId: string
): string {
  const adapterId = entity.adapterId ?? "unknown-adapter";
  const archivedId = entity.id;
  const nativeId =
    entity.sourceId && entity.nativeId
      ? `${entity.sourceId}:${entity.nativeId}`
      : archivedId;

  switch (entityKind) {
    case "project":
      return createProjectId({ adapterId, sourceId: importedSourceId, nativeId });
    case "session":
      return createSessionId({ adapterId, sourceId: importedSourceId, nativeId });
    case "event":
      return createSessionEventId({ adapterId, sourceId: importedSourceId, nativeId });
    case "message":
      return createSessionMessageId({ adapterId, sourceId: importedSourceId, nativeId });
    case "toolCall":
      return createToolCallId({ adapterId, sourceId: importedSourceId, nativeId });
    case "shellCommand":
      return createShellCommandEvidenceId({
        adapterId,
        sourceId: importedSourceId,
        nativeId
      });
    case "outputArtifact":
      return createOutputArtifactId({
        adapterId,
        sourceId: importedSourceId,
        nativeId
      });
    case "fileMutation":
      return createFileMutationEvidenceId({
        adapterId,
        sourceId: importedSourceId,
        nativeId
      });
  }
}

async function readArchiveV2(archivePath: string): Promise<{
  cacheRecords: Array<Extract<ArchiveLine, { kind: "cache-record" }>["record"]>;
  lines: ArchiveLine[];
}> {
  const lines = (await readFile(archivePath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ArchiveLine);

  return {
    lines,
    cacheRecords: lines.flatMap((line) => line.kind === "cache-record" ? [line.record] : [])
  };
}

async function writeArchiveV2(archivePath: string, lines: ArchiveLine[]): Promise<void> {
  await writeFile(
    archivePath,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8"
  );
}

async function readArchiveV3(archivePath: string): Promise<{
  archivedSources: Array<{ adapterId: string; sourceId: string }>;
}> {
  const lines = await readArchiveV3Lines(archivePath);

  return {
    archivedSources: lines.flatMap((line) =>
      line.kind === "entity" && line.section === "sources"
        ? [
            {
              adapterId: String((line.payload as { adapterId: unknown }).adapterId),
              sourceId: String((line.payload as { sourceId: unknown }).sourceId)
            }
          ]
        : []
    )
  };
}

async function readArchiveV3Lines(archivePath: string): Promise<VersionedArchiveLine[]> {
  return (await readFile(archivePath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => archiveVersionedLineSchema.parse(JSON.parse(line)));
}

function combineV3Archives(
  left: VersionedArchiveLine[],
  right: VersionedArchiveLine[]
): VersionedArchiveLine[] {
  const leftManifestLine = left.find(isArchiveV3ManifestLine);
  const rightManifestLine = right.find(isArchiveV3ManifestLine);

  if (!leftManifestLine || !rightManifestLine) {
    throw new Error("Expected both v3 archives to include a manifest.");
  }

  const entitySections = createEmptyArchiveV3SectionEntityCounts();
  const combinedEntitiesBySection = new Map(
    ARCHIVE_V3_ENTITY_SECTION_NAMES.map((sectionName) => [
      sectionName,
      [...left, ...right].filter(
        (line): line is Extract<VersionedArchiveLine, { kind: "entity" }> =>
          line.kind === "entity" && line.section === sectionName
      )
    ] as const)
  );
  const combinedRawArtifactChunks = [...left, ...right].filter(
    (line): line is Extract<VersionedArchiveLine, { kind: "raw-artifact-chunk" }> =>
      line.kind === "raw-artifact-chunk"
  );

  for (const sectionName of ARCHIVE_V3_ENTITY_SECTION_NAMES) {
    entitySections[sectionName] = combinedEntitiesBySection.get(sectionName)?.length ?? 0;
  }

  const manifest: ArchiveV3Manifest = {
    ...leftManifestLine.manifest,
    adapters: unique([
      ...leftManifestLine.manifest.adapters,
      ...rightManifestLine.manifest.adapters
    ]).sort((leftAdapter, rightAdapter) => leftAdapter.localeCompare(rightAdapter)),
    sourceIds: unique([
      ...leftManifestLine.manifest.sourceIds,
      ...rightManifestLine.manifest.sourceIds
    ]).sort((leftSourceId, rightSourceId) => leftSourceId.localeCompare(rightSourceId)),
    sessionIds: unique([
      ...leftManifestLine.manifest.sessionIds,
      ...rightManifestLine.manifest.sessionIds
    ]).sort((leftSessionId, rightSessionId) => leftSessionId.localeCompare(rightSessionId)),
    projectIds: unique([
      ...leftManifestLine.manifest.projectIds,
      ...rightManifestLine.manifest.projectIds
    ]).sort((leftProjectId, rightProjectId) => leftProjectId.localeCompare(rightProjectId)),
    counts: {
      sources: entitySections.sources,
      sessions: entitySections.sessions,
      projects: entitySections.projects,
      sourceDiagnostics:
        leftManifestLine.manifest.counts.sourceDiagnostics +
        rightManifestLine.manifest.counts.sourceDiagnostics,
      rawArtifacts:
        leftManifestLine.manifest.counts.rawArtifacts +
        rightManifestLine.manifest.counts.rawArtifacts,
      totalEntities: Object.values(entitySections).reduce((total, count) => total + count, 0)
    },
    sectionEntityCounts: entitySections
  };
  const combined: VersionedArchiveLine[] = [
    {
      kind: "manifest",
      manifest
    }
  ];
  let sequence = 0;

  for (const sectionName of ARCHIVE_V3_ENTITY_SECTION_NAMES) {
    const entities = combinedEntitiesBySection.get(sectionName) ?? [];

    if (entities.length === 0) {
      continue;
    }

    combined.push({
      kind: "entity-section",
      manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
      section: {
        name: sectionName,
        sequence,
        entityCount: entities.length
      }
    });
    combined.push(...entities);

    if (sectionName === "raw-artifact-entries") {
      combined.push(...combinedRawArtifactChunks);
    }

    sequence += 1;
  }

  return combined;
}

function combineV2Archives(left: ArchiveLine[], right: ArchiveLine[]): ArchiveLine[] {
  const leftManifest = left.find((line) => line.kind === "manifest");
  const rightManifest = right.find((line) => line.kind === "manifest");

  if (!leftManifest || !rightManifest) {
    throw new Error("Expected both v2 archives to include a manifest.");
  }

  const sourceLines = [...left, ...right].filter((line) => line.kind === "source");
  const cacheRecordLines = [...left, ...right].filter((line) => line.kind === "cache-record");
  const sourceDiagnosticLines = [...left, ...right].filter(
    (line) => line.kind === "source-diagnostic"
  );
  const rawArtifactLines = [...left, ...right].filter((line) => line.kind === "raw-artifact");
  const rawArtifactChunkLines = [...left, ...right].filter(
    (line) => line.kind === "raw-artifact-chunk"
  );

  return [
    {
      kind: "manifest",
      manifest: {
        ...leftManifest.manifest,
        adapters: unique([
          ...leftManifest.manifest.adapters,
          ...rightManifest.manifest.adapters
        ]).sort((leftAdapter, rightAdapter) => leftAdapter.localeCompare(rightAdapter)),
        sourceIds: unique([
          ...leftManifest.manifest.sourceIds,
          ...rightManifest.manifest.sourceIds
        ]),
        sessionIds: unique([
          ...leftManifest.manifest.sessionIds,
          ...rightManifest.manifest.sessionIds
        ]),
        projectIds: unique([
          ...leftManifest.manifest.projectIds,
          ...rightManifest.manifest.projectIds
        ]),
        counts: {
          sources: sourceLines.length,
          sessions:
            leftManifest.manifest.counts.sessions + rightManifest.manifest.counts.sessions,
          projects:
            leftManifest.manifest.counts.projects + rightManifest.manifest.counts.projects,
          cacheRecords: cacheRecordLines.length,
          sourceDiagnostics: sourceDiagnosticLines.length,
          rawArtifacts: rawArtifactLines.length
        }
      }
    },
    ...sourceLines,
    ...cacheRecordLines,
    ...sourceDiagnosticLines,
    ...rawArtifactLines,
    ...rawArtifactChunkLines
  ];
}

async function readDirectoryOrEmpty(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
