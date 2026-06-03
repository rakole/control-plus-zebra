import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import {
  ArchiveExportError,
  ArchiveExporter
} from "../../../src/main/core/archive/archive-exporter.js";
import {
  ARCHIVE_V3_MANIFEST_VERSION,
  archiveManifestSchema,
  archiveV3LineSchema,
  archiveV3ManifestSchema,
  archiveVersionedLineSchema,
  createEmptyArchiveV3SectionEntityCounts,
  type ArchiveLine
} from "../../../src/main/core/archive/archive-manifest.js";
import {
  cleanupTempDirs,
  createScannedRuntime,
  loadGeminiArtifactFixtureFromStore
} from "../ipc/triage-test-runtime.js";

describe("ArchiveExporter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("freezes the future v3 manifest-first NDJSON contract while current exports stay on v2", () => {
    const sectionEntityCounts = createEmptyArchiveV3SectionEntityCounts();

    sectionEntityCounts.sources = 1;
    sectionEntityCounts.sessions = 2;
    sectionEntityCounts["timeline-events"] = 4;

    const manifest = archiveV3ManifestSchema.parse({
      format: "agent-workbench-archive",
      manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
      exportedAt: "2026-05-25T09:00:00.000Z",
      scope: {
        kind: "project",
        id: "project-1",
        label: "Project 1"
      },
      includes: {
        normalizedData: true,
        diagnostics: true,
        rawArtifacts: true,
        privacyWarningAcknowledged: true
      },
      adapters: ["fake-test"],
      sourceIds: ["source-1"],
      sessionIds: ["session-1", "session-2"],
      projectIds: ["project-1"],
      counts: {
        sources: 1,
        sessions: 2,
        projects: 1,
        sourceDiagnostics: 1,
        rawArtifacts: 1,
        totalEntities: 10
      },
      sectionEntityCounts,
      aggregateLimits: {
        maxSectionCount: 18,
        maxSectionEntityCount: 1_000,
        maxTotalEntityCount: 10_000,
        maxRawArtifactChunkCountPerArtifact: 16,
        maxRawArtifactBytes: 4 * 1024 * 1024,
        maxSourceDiagnosticCount: 1_000
      }
    });
    const manifestLine = archiveVersionedLineSchema.parse({
      kind: "manifest",
      manifest
    });
    const sectionLine = archiveV3LineSchema.parse({
      kind: "entity-section",
      manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
      section: {
        name: "sessions",
        sequence: 2,
        entityCount: 2
      }
    });
    const entityLine = archiveVersionedLineSchema.parse({
      kind: "entity",
      manifestVersion: ARCHIVE_V3_MANIFEST_VERSION,
      section: "sessions",
      entityId: "session-1",
      payload: {
        id: "session-1",
        lastUpdatedAt: "2026-05-25T09:01:00.000Z"
      }
    });

    expect(manifestLine).toMatchObject({
      kind: "manifest",
      manifest: expect.objectContaining({
        manifestVersion: 3,
        sectionEntityCounts: expect.objectContaining({
          sessions: 2
        })
      })
    });
    expect(sectionLine).toMatchObject({
      kind: "entity-section",
      section: expect.objectContaining({
        name: "sessions",
        entityCount: 2
      })
    });
    expect(entityLine).toMatchObject({
      kind: "entity",
      section: "sessions",
      entityId: "session-1"
    });
    expect(
      archiveManifestSchema.safeParse({
        ...manifest,
        manifestVersion: ARCHIVE_V3_MANIFEST_VERSION
      }).success
    ).toBe(false);
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
    const archive = await readArchiveV2(destinationPath);

    expect(result.manifest.format).toBe("agent-workbench-archive");
    expect(result.manifest.includes.rawArtifacts).toBe(false);
    expect(archive.manifest?.scope.kind).toBe("project");
    expect(archive.manifest?.counts.cacheRecords).toBeGreaterThan(0);
    expect(archive.sources.length).toBeGreaterThan(0);
    expect(archive.cacheRecords.length).toBeGreaterThan(0);
    expect(
      archive.cacheRecords.every(
        (record) => typeof record === "object" && record !== null && !("derived" in record)
      )
    ).toBe(true);
    expect(archive.rawArtifacts).toEqual([]);
  });

  it("writes a v2 manifest and strips exporter-local provenance from normalized-only archives", async () => {
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

    const destinationPath = path.join(runtime.appDataDir, "exports", "entity-stream.awb-archive.json");

    await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const lines = await readArchiveLines(destinationPath);
    const archive = await readArchiveV2(destinationPath);
    const archivedRootPath = `archived-sources/${archive.sources[0]?.sourceId ?? ""}`;
    const serializedArchive = await readFile(destinationPath, "utf8");

    expect(lines[0]).toMatchObject({
      kind: "manifest",
      manifest: expect.objectContaining({
        manifestVersion: 2
      })
    });
    expect(lines.some((line) => line.kind === "cache-record")).toBe(true);
    expect(lines.some((line) => line.kind === "entity-section")).toBe(false);
    expect(lines.some((line) => line.kind === "entity")).toBe(false);
    expect(archive.sources[0]).toMatchObject({
      rootPath: archivedRootPath,
      validation: expect.objectContaining({
        normalizedPath: archivedRootPath
      })
    });
    expect(
      archive.cacheRecords.every((record) =>
        record.normalized.projects.every(
          (project) => project.rootPath === undefined && project.primaryRootPath === undefined
        )
      )
    ).toBe(true);
    expect(
      archive.cacheRecords.every((record) =>
        record.normalized.outputArtifacts.every((artifact) => artifact.path === undefined)
      )
    ).toBe(true);
    expect(
      archive.cacheRecords.every((record) =>
        (record.rawArtifactIndex?.entries ?? []).every((entry) => entry.path === undefined)
      )
    ).toBe(true);
    expect(serializedArchive).not.toContain(path.join(runtime.appDataDir, "gemini-root"));
  });

  it("writes a manifest-first v3 archive from store-backed entities without legacy cache hydration", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime });
    const projectId = (await triageService.listProjects()).find(
      (project) => project.projectName === "control-plus-zebra"
    )?.projectId;
    const exporter = createStoreBackedV3Exporter(runtime);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project.");
    }

    const destinationPath = path.join(runtime.appDataDir, "exports", "store-backed-v3.awb-archive.json");
    const result = await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });
    const lines = await readVersionedArchiveLines(destinationPath);
    const sourceEntity = lines.find(
      (line) => line.kind === "entity" && line.section === "sources"
    );
    const rawArtifactEntryEntity = lines.find(
      (line) => line.kind === "entity" && line.section === "raw-artifact-entries"
    );
    const sectionSequences = lines
      .flatMap((line) => (line.kind === "entity-section" ? [line.section.sequence] : []));

    expect(result.manifest).toMatchObject({
      manifestVersion: 3,
      includes: expect.objectContaining({
        rawArtifacts: false,
        privacyWarningAcknowledged: true
      }),
      counts: expect.objectContaining({
        rawArtifacts: 0
      })
    });
    expect(result.rawArtifactCount).toBe(0);
    expect(lines[0]).toMatchObject({
      kind: "manifest",
      manifest: expect.objectContaining({
        manifestVersion: 3
      })
    });
    expect(lines.some((line) => line.kind === "cache-record")).toBe(false);
    expect(lines.some((line) => line.kind === "source")).toBe(false);
    expect(lines.some((line) => line.kind === "entity-section")).toBe(true);
    expect(lines.some((line) => line.kind === "entity" && line.section === "sessions")).toBe(true);
    expect(sectionSequences).toEqual([...sectionSequences].sort((left, right) => left - right));
    if (sourceEntity?.kind === "entity") {
      expect(sourceEntity.payload).toMatchObject({
        rootPath: expect.stringMatching(/^archived-sources\//u),
        validation: expect.objectContaining({
          normalizedPath: expect.stringMatching(/^archived-sources\//u)
        })
      });
    }
    if (rawArtifactEntryEntity?.kind === "entity") {
      expect(rawArtifactEntryEntity.payload).not.toHaveProperty("blob");
      expect(rawArtifactEntryEntity.payload).not.toMatchObject({
        entry: expect.objectContaining({
          path: expect.any(String)
        })
      });
    }
  });

  it("includes only indexed raw artifacts when raw export is explicitly enabled", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const geminiRecord = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "gemini-cli"
    );
    const geminiSession = geminiRecord?.normalized.sessions[0];
    const geminiSessionId = geminiSession?.id;

    expect(geminiSessionId).toBeDefined();
    expect(geminiSession?.nativeId).toBeDefined();
    if (!geminiSessionId || !geminiSession?.nativeId) {
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
    const archive = await readArchiveV2(destinationPath);
    const rawArtifacts = archive.rawArtifacts;
    const sessionScopedArtifacts = rawArtifacts.filter(
      (artifact) =>
        artifact.artifactKind === "session-log" || artifact.artifactKind === "output-artifact"
    );

    expect(result.rawArtifactCount).toBeGreaterThan(0);
    expect(archive.manifest?.includes.rawArtifacts).toBe(true);
    expect(archive.manifest?.includes.privacyWarningAcknowledged).toBe(true);
    expect(archive.manifest?.counts.rawArtifacts).toBe(result.rawArtifactCount);
    expect(rawArtifacts.length).toBe(result.rawArtifactCount);
    expect(rawArtifacts.every((artifact) => artifact.content.length > 0)).toBe(true);
    expect(rawArtifacts.every((artifact) => artifact.parseStrategy.length > 0)).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "project-root-map")).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "history")).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "session-log")).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "output-artifact")).toBe(true);
    expect(
      sessionScopedArtifacts.every((artifact) =>
        [artifact.nativeRef, artifact.nativeId].some((value) =>
          value?.includes(geminiSession.nativeId ?? "")
        )
      )
    ).toBe(true);
    expect(rawArtifacts.every((artifact) => artifact.originalPath === undefined)).toBe(true);
    expect(archive.sources).toEqual([
      expect.objectContaining({
        sourceId: geminiRecord?.sourceId,
        rootPath: `archived-sources/${geminiRecord?.sourceId ?? ""}`,
        validation: expect.objectContaining({
          normalizedPath: `archived-sources/${geminiRecord?.sourceId ?? ""}`
        })
      })
    ]);
  }, 15_000);

  it("writes v3 raw artifact chunks from store-backed metadata and strips entry paths", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = createStoreBackedV3Exporter(runtime);
    const geminiFixture = await loadGeminiArtifactFixtureFromStore(runtime);
    const destinationPath = path.join(runtime.appDataDir, "exports", "store-backed-v3-raw.awb-archive.json");
    const result = await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: geminiFixture.sessionId }
    });
    const lines = await readVersionedArchiveLines(destinationPath);
    const rawArtifactEntities = lines.filter(
      (line) => line.kind === "entity" && line.section === "raw-artifact-entries"
    );
    const rawArtifactChunks = lines.filter(
      (line) => line.kind === "raw-artifact-chunk"
    );

    expect(result.manifest).toMatchObject({
      manifestVersion: 3,
      includes: expect.objectContaining({
        rawArtifacts: true,
        privacyWarningAcknowledged: true
      })
    });
    expect(result.rawArtifactCount).toBeGreaterThan(0);
    expect(rawArtifactEntities.length).toBeGreaterThan(0);
    expect(rawArtifactChunks.length).toBeGreaterThan(0);
    expect(
      rawArtifactEntities.every((line) => line.kind === "entity" && !("blob" in line.payload))
    ).toBe(true);
    expect(
      rawArtifactEntities.every(
        (line) =>
          line.kind === "entity" &&
          !(
            "entry" in line.payload &&
            typeof line.payload.entry === "object" &&
            line.payload.entry !== null &&
            "path" in line.payload.entry
          )
      )
    ).toBe(true);
  });

  it("uses store rollups instead of full export planning for batched availability", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const sourceRecords = await runtime.sourceRegistry.listSources();
    const projectIds = [
      ...new Set(
        (
          await Promise.all(
            sourceRecords.map((sourceRecord) =>
              runtime.entityStore.listProjectRollups({ sourceId: sourceRecord.sourceId })
            )
          )
        ).flatMap((projectRollups) =>
          projectRollups.flatMap((projectRollup) =>
            projectRollup.projectId ? [projectRollup.projectId] : []
          )
        )
      )
    ];
    const targetProjectId = projectIds[0];
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getArchivePreflight?: typeof runtime.entityStore.getArchivePreflight;
      getOverviewRollup?: typeof runtime.entityStore.getOverviewRollup;
      getSessionRollup?: typeof runtime.entityStore.getSessionRollup;
      getSessionRunAuditSnapshot?: typeof runtime.entityStore.getSessionRunAuditSnapshot;
      getSessionVerificationSnapshot?: typeof runtime.entityStore.getSessionVerificationSnapshot;
      listDiagnostics?: typeof runtime.entityStore.listDiagnostics;
      listProjectRollups?: typeof runtime.entityStore.listProjectRollups;
      listRawArtifactMetadata?: typeof runtime.entityStore.listRawArtifactMetadata;
      listSessionsPage?: typeof runtime.entityStore.listSessionsPage;
    };
    const originalGetArchivePreflight = entityStore.getArchivePreflight;
    const originalListProjectRollups = entityStore.listProjectRollups;
    const originalListSessionsPage = entityStore.listSessionsPage;
    const originalGetSessionRollup = entityStore.getSessionRollup;
    const originalListDiagnostics = entityStore.listDiagnostics;
    const originalListRawArtifactMetadata = entityStore.listRawArtifactMetadata;
    const originalGetOverviewRollup = entityStore.getOverviewRollup;
    const originalGetSessionVerificationSnapshot = entityStore.getSessionVerificationSnapshot;
    const originalGetSessionRunAuditSnapshot = entityStore.getSessionRunAuditSnapshot;
    let preflightCount = 0;
    let projectRollupCount = 0;
    let sessionPageCount = 0;
    let sessionRollupCount = 0;
    let diagnosticsCount = 0;
    let rawArtifactMetadataCount = 0;
    let overviewRollupCount = 0;
    let verificationSnapshotCount = 0;
    let runAuditSnapshotCount = 0;

    expect(targetProjectId).toBeDefined();
    if (!targetProjectId) {
      throw new Error("Expected at least one store-backed project rollup.");
    }

    entityStore.getArchivePreflight = async (scope) => {
      preflightCount += 1;
      return originalGetArchivePreflight?.call(entityStore, scope);
    };
    entityStore.listProjectRollups = async (scope) => {
      projectRollupCount += 1;
      return originalListProjectRollups!.call(entityStore, scope);
    };
    entityStore.listSessionsPage = async (query) => {
      sessionPageCount += 1;
      return originalListSessionsPage!.call(entityStore, query);
    };
    entityStore.getSessionRollup = async (scope) => {
      sessionRollupCount += 1;
      return originalGetSessionRollup!.call(entityStore, scope);
    };
    entityStore.listDiagnostics = async (query) => {
      diagnosticsCount += 1;
      return originalListDiagnostics!.call(entityStore, query);
    };
    entityStore.listRawArtifactMetadata = async (scope) => {
      rawArtifactMetadataCount += 1;
      return originalListRawArtifactMetadata!.call(entityStore, scope);
    };
    entityStore.getOverviewRollup = async (scope) => {
      overviewRollupCount += 1;
      return originalGetOverviewRollup!.call(entityStore, scope);
    };
    entityStore.getSessionVerificationSnapshot = async (scope) => {
      verificationSnapshotCount += 1;
      return originalGetSessionVerificationSnapshot!.call(entityStore, scope);
    };
    entityStore.getSessionRunAuditSnapshot = async (scope) => {
      runAuditSnapshotCount += 1;
      return originalGetSessionRunAuditSnapshot!.call(entityStore, scope);
    };

    const exporter = createStoreBackedV3Exporter(runtime);
    const availabilities = await exporter.getScopeAvailabilities([
      { kind: "project", projectId: targetProjectId },
      { kind: "project", projectId: targetProjectId }
    ]);

    expect(availabilities).toHaveLength(2);
    expect(preflightCount).toBe(sourceRecords.length);
    expect(projectRollupCount).toBe(sourceRecords.length);
    expect(sessionPageCount).toBe(0);
    expect(sessionRollupCount).toBe(0);
    expect(diagnosticsCount).toBe(0);
    expect(rawArtifactMetadataCount).toBe(sourceRecords.length);
    expect(overviewRollupCount).toBe(0);
    expect(verificationSnapshotCount).toBe(0);
    expect(runAuditSnapshotCount).toBe(0);
  }, 15_000);

  it("keeps store-backed project batch availability aligned with strict export truth when rollups overclaim non-exportable raw artifacts", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = createStoreBackedV3Exporter(runtime);
    const sourceRecords = await runtime.sourceRegistry.listSources();
    const projectCandidates = (
      await Promise.all(
        sourceRecords.map(async (sourceRecord) =>
          (
            await runtime.entityStore.listProjectRollups({
              sourceId: sourceRecord.sourceId
            })
          )
            .filter(
              (
                projectRollup
              ): projectRollup is typeof projectRollup & { projectId: string } =>
                Boolean(projectRollup.projectId) &&
                Boolean(projectRollup.sessionIds.length) &&
                (projectRollup.rawArtifactCount ?? 0) > 0
            )
            .map((projectRollup) => ({
              projectId: projectRollup.projectId,
              sessionIds: projectRollup.sessionIds,
              sourceId: sourceRecord.sourceId
            }))
        )
      )
    ).flat();
    const projectSourceCounts = new Map<string, number>();

    for (const candidate of projectCandidates) {
      projectSourceCounts.set(
        candidate.projectId,
        (projectSourceCounts.get(candidate.projectId) ?? 0) + 1
      );
    }

    const targetProject = projectCandidates.find(
      (candidate) => projectSourceCounts.get(candidate.projectId) === 1
    );
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      listRawArtifactMetadata?: typeof runtime.entityStore.listRawArtifactMetadata;
    };
    const originalListRawArtifactMetadata = entityStore.listRawArtifactMetadata;

    expect(targetProject).toBeDefined();
    if (!targetProject || !originalListRawArtifactMetadata) {
      throw new Error("Expected a uniquely sourced store-backed project with raw artifacts.");
    }

    const baselineAvailability = await exporter.getScopeAvailability({
      kind: "project",
      projectId: targetProject.projectId
    });

    expect(baselineAvailability.rawArtifactsAvailable).toBe(true);

    entityStore.listRawArtifactMetadata = async (scope) => {
      const metadata = await originalListRawArtifactMetadata.call(entityStore, scope);

      if (scope.sourceId !== targetProject.sourceId) {
        return metadata;
      }

      return metadata.map((record) => {
        if (
          record.status !== "available" ||
          !record.entry?.path
        ) {
          return record;
        }

        const { path: _path, ...entryWithoutPath } = record.entry;

        return {
          ...record,
          entry: entryWithoutPath
        };
      });
    };

    const strictAvailability = await exporter.getScopeAvailability({
      kind: "project",
      projectId: targetProject.projectId
    });
    const [batchedAvailability] = await exporter.getScopeAvailabilities(
      [{ kind: "project", projectId: targetProject.projectId }],
      {
        projectSourceCoverageByProjectId: new Map([
          [targetProject.projectId, [targetProject.sourceId]]
        ])
      }
    );

    expect(strictAvailability).toEqual(
      expect.objectContaining({
        scopeKind: "project",
        scopeId: targetProject.projectId,
        rawArtifactsAvailable: false,
        rawArtifactCount: 0,
        rawArtifactsReason:
          "No indexed raw artifacts are available for this archive scope."
      })
    );
    expect(batchedAvailability).toEqual(strictAvailability);
  }, 15_000);

  it("keeps store-backed project batch availability aligned with strict export truth when a source preflight fails", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = createStoreBackedV3Exporter(runtime);
    const sourceRecords = await runtime.sourceRegistry.listSources();
    const targetProjectId = (
      await Promise.all(
        sourceRecords.map(async (sourceRecord) =>
          (await runtime.entityStore.listProjectRollups({ sourceId: sourceRecord.sourceId }))
            .filter(
              (projectRollup) =>
                Boolean(projectRollup.projectId) &&
                (projectRollup.rawArtifactCount ?? 0) > 0
            )
            .map((projectRollup) => projectRollup.projectId)
        )
      )
    )
      .flat()
      .find((projectId): projectId is string => Boolean(projectId));
    const failingSourceId = sourceRecords[0]?.sourceId;
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getArchivePreflight?: typeof runtime.entityStore.getArchivePreflight;
    };
    const originalGetArchivePreflight = entityStore.getArchivePreflight;

    expect(targetProjectId).toBeDefined();
    expect(failingSourceId).toBeDefined();
    if (!targetProjectId || !failingSourceId) {
      throw new Error("Expected a store-backed project and source for archive availability.");
    }

    const baselineAvailability = await exporter.getScopeAvailability({
      kind: "project",
      projectId: targetProjectId
    });

    expect(baselineAvailability.rawArtifactsAvailable).toBe(true);

    entityStore.getArchivePreflight = async (scope) => {
      if (scope.sourceId === failingSourceId) {
        throw new Error("archive preflight unavailable");
      }

      return originalGetArchivePreflight?.call(entityStore, scope);
    };

    await expect(
      exporter.getScopeAvailability({
        kind: "project",
        projectId: targetProjectId
      })
    ).rejects.toThrow("archive preflight unavailable");

    const [batchedAvailability] = await exporter.getScopeAvailabilities([
      { kind: "project", projectId: targetProjectId }
    ]);

    expect(batchedAvailability).toEqual(
      expect.objectContaining({
        scopeKind: "project",
        scopeId: targetProjectId,
        rawArtifactsAvailable: false,
        rawArtifactCount: 0,
        rawArtifactsReason:
          "Archive export availability could not be resolved for this scope."
      })
    );
  }, 15_000);

  it("keeps unrelated store-backed project batch availability truthful when caller coverage excludes the failing source", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = createStoreBackedV3Exporter(runtime);
    const sourceRecords = await runtime.sourceRegistry.listSources();
    const projectPairs = (
      await Promise.all(
        sourceRecords.map(async (sourceRecord) =>
          (
            await runtime.entityStore.listProjectRollups({
              sourceId: sourceRecord.sourceId
            })
          )
            .filter(
              (
                projectRollup
              ): projectRollup is typeof projectRollup & { projectId: string } =>
                Boolean(projectRollup.projectId)
            )
            .map((projectRollup) => ({
              projectId: projectRollup.projectId,
              sourceId: sourceRecord.sourceId
            }))
        )
      )
    ).flat();
    const failingPair = projectPairs[0];
    const healthyPair = projectPairs.find(
      (projectPair) => projectPair.sourceId !== failingPair?.sourceId
    );
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getArchivePreflight?: typeof runtime.entityStore.getArchivePreflight;
    };
    const originalGetArchivePreflight = entityStore.getArchivePreflight;

    expect(failingPair).toBeDefined();
    expect(healthyPair).toBeDefined();
    if (!failingPair || !healthyPair) {
      throw new Error("Expected store-backed projects from at least two sources.");
    }

    const baselineHealthyAvailability = await exporter.getScopeAvailability({
      kind: "project",
      projectId: healthyPair.projectId
    });

    entityStore.getArchivePreflight = async (scope) => {
      if (scope.sourceId === failingPair.sourceId) {
        throw new Error("archive preflight unavailable");
      }

      return originalGetArchivePreflight?.call(entityStore, scope);
    };

    const [healthyAvailability, failingAvailability] =
      await exporter.getScopeAvailabilities(
        [
          { kind: "project", projectId: healthyPair.projectId },
          { kind: "project", projectId: failingPair.projectId }
        ],
        {
          projectSourceCoverageByProjectId: new Map([
            [healthyPair.projectId, [healthyPair.sourceId]],
            [failingPair.projectId, [failingPair.sourceId]]
          ])
        }
      );

    expect(healthyAvailability).toEqual(baselineHealthyAvailability);
    expect(failingAvailability).toEqual(
      expect.objectContaining({
        scopeKind: "project",
        scopeId: failingPair.projectId,
        rawArtifactsAvailable: false,
        rawArtifactCount: 0,
        rawArtifactsReason:
          "Archive export availability could not be resolved for this scope."
      })
    );
  }, 15_000);

  it("keeps store-backed session batch availability aligned with strict export truth when rollups undercount", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = createStoreBackedV3Exporter(runtime);
    const geminiFixture = await loadGeminiArtifactFixtureFromStore(runtime);
    const scope = { kind: "session" as const, sessionId: geminiFixture.sessionId };
    const strictAvailability = await exporter.getScopeAvailability(scope);
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getSessionRollup?: typeof runtime.entityStore.getSessionRollup;
    };
    const originalGetSessionRollup = entityStore.getSessionRollup;

    expect(strictAvailability.rawArtifactCount).toBeGreaterThan(0);

    entityStore.getSessionRollup = async (query) => {
      const sessionRollup = await originalGetSessionRollup!.call(entityStore, query);

      if (!sessionRollup || query.sessionId !== geminiFixture.sessionId) {
        return sessionRollup;
      }

      return {
        ...sessionRollup,
        rawArtifactCount: Math.max(0, (sessionRollup.rawArtifactCount ?? 0) - 1)
      };
    };

    const strictAvailabilityWithUndercountedRollup = await exporter.getScopeAvailability(scope);
    const [batchedAvailability] = await exporter.getScopeAvailabilities([scope]);

    expect(strictAvailabilityWithUndercountedRollup).toEqual(strictAvailability);
    expect(batchedAvailability).toEqual(strictAvailability);
  }, 15_000);

  it("keeps unrelated store-backed session availability when one session rollup query fails", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const sourceRecords = await runtime.sourceRegistry.listSources();
    const sessionsBySource = (
      await Promise.all(
        sourceRecords.map(async (sourceRecord) => ({
          session: (
            await runtime.entityStore.listSessionsPage({
              limit: 1,
              sourceId: sourceRecord.sourceId
            })
          ).items[0]?.session,
          sourceId: sourceRecord.sourceId
        }))
      )
    ).filter(
      (
        candidate
      ): candidate is {
        session: NonNullable<
          Awaited<ReturnType<typeof runtime.entityStore.listSessionsPage>>["items"][number]
        >["session"];
        sourceId: string;
      } => Boolean(candidate.session)
    );
    const healthySession = sessionsBySource[0]?.session;
    const failingSession = sessionsBySource.find(
      (candidate) => candidate.sourceId !== healthySession?.sourceId
    )?.session;

    expect(healthySession).toBeDefined();
    expect(failingSession).toBeDefined();
    if (!healthySession || !failingSession) {
      throw new Error("Expected at least two sources with store-backed sessions.");
    }

    const baselineExporter = createStoreBackedV3Exporter(runtime);
    const baselineHealthyAvailability = await baselineExporter.getScopeAvailability({
      kind: "session",
      sessionId: healthySession.id
    });
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getSessionRollup?: typeof runtime.entityStore.getSessionRollup;
    };
    const originalGetSessionRollup = entityStore.getSessionRollup;

    entityStore.getSessionRollup = async (scope) => {
      if (
        scope.sourceId === failingSession.sourceId &&
        scope.sessionId === failingSession.id
      ) {
        throw new Error("session rollup unavailable");
      }

      return originalGetSessionRollup!.call(entityStore, scope);
    };

    const exporter = createStoreBackedV3Exporter(runtime);
    const [healthyAvailability, failingAvailability] =
      await exporter.getScopeAvailabilities([
        { kind: "session", sessionId: healthySession.id },
        { kind: "session", sessionId: failingSession.id }
      ]);

    expect(healthyAvailability).toEqual(baselineHealthyAvailability);
    expect(failingAvailability).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: failingSession.id,
        rawArtifactsAvailable: false,
        rawArtifactCount: 0,
        rawArtifactsReason:
          "Archive export availability could not be resolved for this scope."
      })
    );
  }, 15_000);

  it("rejects raw artifact export until the privacy warning is acknowledged", async () => {
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

    await expect(
      exporter.createArchive({
        destinationPath: path.join(
          runtime.appDataDir,
          "exports",
          "raw-warning-required.awb-archive.json"
        ),
        includeRawArtifacts: true,
        privacyWarningAcknowledged: false,
        scope: { kind: "session", sessionId: geminiSessionId }
      })
    ).rejects.toMatchObject({
      code: "archive-export.warning-not-acknowledged"
    } satisfies Partial<ArchiveExportError>);
  });

  it("does not use unbounded Promise.all for raw artifact export", async () => {
    const exporterSource = await readFile(
      path.resolve("src/main/core/archive/archive-exporter.ts"),
      "utf8"
    );

    expect(exporterSource).not.toContain("return Promise.all(");
  });

  it("streams v3 raw artifact content instead of buffering whole files before chunking", async () => {
    const exporterSource = await readFile(
      path.resolve("src/main/core/archive/archive-exporter.ts"),
      "utf8"
    );
    const writeArchiveV3Source = exporterSource.slice(
      exporterSource.indexOf("async function writeArchiveV3("),
      exporterSource.indexOf("async function writeTimelineSection(")
    );

    expect(writeArchiveV3Source).toContain("readIndexedTextArtifactChunks(");
    expect(writeArchiveV3Source).not.toContain("offset < content.length");
    expect(writeArchiveV3Source).not.toContain("content.slice(");
  });

  it("does not include unreferenced same-source raw artifacts in project archives", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const geminiRecord = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "gemini-cli"
    );
    const projectId = geminiRecord?.normalized.projects[0]?.id;
    const existingEntries = await runtime.rawArtifactIndex.load();
    const templateEntry = existingEntries.find(
      (entry) => entry.sourceId === geminiRecord?.sourceId && entry.path
    );

    expect(projectId).toBeDefined();
    expect(geminiRecord).toBeDefined();
    expect(templateEntry).toBeDefined();
    if (!projectId || !geminiRecord || !templateEntry) {
      throw new Error("Expected a Gemini project with indexed raw artifacts.");
    }

    const unrelatedPath = path.join(
      runtime.appDataDir,
      "gemini-root",
      "chats",
      "session-unrelated.jsonl"
    );

    await mkdir(path.dirname(unrelatedPath), { recursive: true });
    await writeFile(unrelatedPath, "{\"type\":\"message\",\"text\":\"leak\"}\n", "utf8");
    await runtime.rawArtifactIndex.save([
      ...existingEntries,
      {
        ...templateEntry,
        id: "raw-artifact-unreferenced-same-source",
        nativeRef: "chats/session-unrelated.jsonl",
        nativeId: "chats/session-unrelated.jsonl",
        path: unrelatedPath,
        artifactKind: "session-log",
        artifactType: "gemini-chat",
        mediaType: "application/x-ndjson"
      }
    ]);

    const destinationPath = path.join(
      runtime.appDataDir,
      "exports",
      "project-raw-scoped.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = await readArchiveV2(destinationPath);

    expect(
      archive.rawArtifacts.some(
        (artifact) =>
          artifact.nativeRef === "chats/session-unrelated.jsonl"
      )
    ).toBe(false);
    expect(archive.rawArtifacts.every((artifact) => artifact.originalPath === undefined)).toBe(true);
  });
});

function createStoreBackedV3Exporter(
  runtime: Awaited<ReturnType<typeof createScannedRuntime>>
) {
  return new ArchiveExporter({
    cacheStore: {
      async listLatestRecords() {
        throw new Error("v3 export should not hydrate cache records");
      }
    } as unknown as Awaited<ReturnType<typeof createScannedRuntime>>["cacheStore"],
    entityStore: runtime.entityStore,
    rawArtifactIndex: {
      async load() {
        throw new Error("v3 export should not load the legacy raw artifact index");
      }
    } as unknown as Awaited<ReturnType<typeof createScannedRuntime>>["rawArtifactIndex"],
    sourceRegistry: runtime.sourceRegistry
  });
}

async function readArchiveV2(archivePath: string) {
  const lines = (await readArchiveLines(archivePath)) as ArchiveLine[];
  const chunksByArtifactId = new Map<string, Array<{ chunkIndex: number; content: string }>>();

  for (const line of lines) {
    if (line.kind === "raw-artifact-chunk") {
      const chunks = chunksByArtifactId.get(line.chunk.artifactId) ?? [];
      chunks.push({
        chunkIndex: line.chunk.chunkIndex,
        content: line.chunk.content
      });
      chunksByArtifactId.set(line.chunk.artifactId, chunks);
    }
  }

  return {
    manifest: lines.find((line): line is Extract<ArchiveLine, { kind: "manifest" }> => line.kind === "manifest")?.manifest,
    sources: lines.flatMap((line) => line.kind === "source" ? [line.source] : []),
    cacheRecords: lines.flatMap((line) => line.kind === "cache-record" ? [line.record] : []),
    rawArtifacts: lines.flatMap((line) =>
      line.kind === "raw-artifact"
        ? [
            {
              ...line.artifact,
              content: (chunksByArtifactId.get(line.artifact.artifactId) ?? [])
                .sort((left, right) => left.chunkIndex - right.chunkIndex)
                .map((chunk) => chunk.content)
                .join("")
            }
          ]
        : []
    )
  };
}

async function readVersionedArchiveLines(archivePath: string) {
  return (await readArchiveLines(archivePath)).map((line) =>
    archiveVersionedLineSchema.parse(line)
  );
}

async function readArchiveLines(archivePath: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(archivePath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
