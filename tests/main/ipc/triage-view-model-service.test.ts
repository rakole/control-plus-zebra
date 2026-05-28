import { afterEach, describe, expect, it } from "vitest";

import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { createConfidenceScore } from "../../../src/main/core/model/confidence.js";
import {
  cleanupTempDirs,
  createHydrationDegradedRuntimeFromSeed,
  createScannedRuntime,
  createTempRuntime,
  loadGeminiArtifactFixtureFromStore
} from "./triage-test-runtime.js";

describe("triage view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("returns truthful overview and project rollups across fake and Gemini data", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime });
    const overview = await triageService.getOverview();
    const projects = await triageService.listProjects();
    const gitBackedProject = projects.find(
      (project) => project.projectDisplayName === "control-plus-zebra"
    );
    const degradedProject = projects.find((project) => project.gitStatus.label === "Unknown");
    const rawExportProject = projects.find((project) => project.archiveExport.rawArtifactsAvailable);

    expect(overview.metrics.totalSessions.numericValue).toBeGreaterThan(0);
    expect(overview.usageSummary.models.status).toBe("value");
    expect(overview.usageSummary.models.displayValue).toContain("gemini-3-flash-preview");
    expect(overview.usageSummary.models.reason).toContain("selected sessions");
    expect(overview.usageSummary.tokenCount.status).toBe("value");
    expect(overview.usageSummary.tokenCount.numericValue).toBeGreaterThan(0);
    expect(overview.usageSummary.tokenCount.reason).toContain("selected sessions");
    expect(overview.harnessFilters.map((filter) => filter.label)).toEqual(
      expect.arrayContaining(["Fake Test Harness", "Gemini CLI"])
    );
    await expect(triageService.getOverview({ adapterId: "gemini-cli" })).resolves.toMatchObject({
      usageSummary: {
        models: {
          status: "value",
          displayValue: "gemini-3-flash-preview"
        },
        tokenCount: {
          status: "value",
          numericValue: expect.any(Number)
        }
      }
    });
    expect(projects.length).toBeGreaterThan(0);
    expect(gitBackedProject).toEqual(
      expect.objectContaining({
        gitStatus: expect.objectContaining({ label: "Available" }),
        githubStatus: expect.objectContaining({ label: "No Matching PR" }),
        branch: expect.objectContaining({ displayValue: "main" }),
        dirtyState: expect.objectContaining({ label: "Dirty" }),
        remoteUrl: expect.objectContaining({
          displayValue: "https://github.com/example/control-plus-zebra.git"
        })
      })
    );
    expect(rawExportProject?.archiveExport).toEqual(
      expect.objectContaining({
        rawArtifactsAvailable: true,
        rawArtifactCount: expect.any(Number)
      })
    );
    expect(degradedProject?.gitStatus.label).toBe("Unknown");
    expect(gitBackedProject?.pullRequest.displayValue).toBe("No Matching PR");
    expect(JSON.stringify(projects)).not.toContain("rawEvents");
  }, 15000);

  it("returns exactly 30 heatmap buckets and honors the adapter filter", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const fakeSource = await runtime.sourceRegistry.createSource({
      adapterId: "fake-test",
      displayName: "Fake Heatmap Source",
      rootPath: `${runtime.appDataDir}/fake-heatmap-source`
    });
    const geminiSource = await runtime.sourceRegistry.createSource({
      adapterId: "gemini-cli",
      displayName: "Gemini Heatmap Source",
      rootPath: `${runtime.appDataDir}/gemini-heatmap-source`
    });

    await seedHeatmapSource(runtime, fakeSource.sourceId, "fake-test", [
      { sessionId: "fake-start", lastUpdatedAt: "2026-04-29T08:00:00.000Z", runAuditStatus: "clean" },
      {
        sessionId: "fake-end",
        lastUpdatedAt: "2026-05-28T09:30:00.000Z",
        runAuditStatus: "needs-review"
      },
      {
        sessionId: "fake-outside-range",
        lastUpdatedAt: "2026-04-28T09:30:00.000Z",
        runAuditStatus: "clean"
      }
    ]);
    await seedHeatmapSource(runtime, geminiSource.sourceId, "gemini-cli", [
      {
        sessionId: "gemini-end",
        lastUpdatedAt: "2026-05-28T10:00:00.000Z",
        runAuditStatus: "needs-review"
      }
    ]);

    const triageService = createTriageViewModelService({
      runtime,
      now: () => new Date("2026-05-28T12:00:00.000Z")
    });
    const heatmap = await triageService.getOverviewActivityHeatmap({
      adapterId: "fake-test"
    });

    expect(heatmap.coverageState).toEqual({
      label: "Available",
      tone: "info"
    });
    expect(heatmap.buckets).toHaveLength(30);
    expect(heatmap.buckets[0]).toEqual({
      day: "2026-04-29",
      sessionCount: 1,
      needsAttentionCount: 0
    });
    expect(heatmap.buckets.at(-1)).toEqual({
      day: "2026-05-28",
      sessionCount: 1,
      needsAttentionCount: 1
    });
    expect(heatmap.buckets.find((bucket) => bucket.day === "2026-05-27")).toEqual({
      day: "2026-05-27",
      sessionCount: 0,
      needsAttentionCount: 0
    });
    expect(
      heatmap.buckets.reduce((total, bucket) => total + bucket.sessionCount, 0)
    ).toBe(2);
    expect(
      heatmap.buckets.reduce((total, bucket) => total + bucket.needsAttentionCount, 0)
    ).toBe(1);
  }, 15000);

  it("loads archive availability once for Projects route rollups", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const originalCacheStore = runtime.cacheStore;
    const originalRawArtifactIndex = runtime.rawArtifactIndex;
    const originalSourceRegistry = runtime.sourceRegistry;
    let latestRecordLoadCount = 0;
    let rawArtifactIndexLoadCount = 0;
    let sourceListCount = 0;

    runtime.cacheStore = {
      listLatestRecords: async () => {
        latestRecordLoadCount += 1;
        return originalCacheStore.listLatestRecords();
      }
    } as unknown as typeof runtime.cacheStore;
    runtime.rawArtifactIndex = {
      load: async () => {
        rawArtifactIndexLoadCount += 1;
        return originalRawArtifactIndex.load();
      }
    } as unknown as typeof runtime.rawArtifactIndex;
    runtime.sourceRegistry = {
      listSources: async () => {
        sourceListCount += 1;
        return originalSourceRegistry.listSources();
      }
    } as unknown as typeof runtime.sourceRegistry;

    const triageService = createTriageViewModelService({ runtime });
    const projects = await triageService.listProjects();

    expect(projects.length).toBeGreaterThan(1);
    expect(latestRecordLoadCount).toBe(1);
    expect(rawArtifactIndexLoadCount).toBe(0);
    expect(sourceListCount).toBe(3);
  }, 15000);

  it("keeps unrelated project rollups truthful when one source preflight fails", async () => {
    const runtime = await createScannedRuntime(tempDirs);
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
    const baselineProjects = await createTriageViewModelService({ runtime }).listProjects();
    const baselineHealthyProject = baselineProjects.find(
      (project) => project.projectId === healthyPair?.projectId
    );
    const originalGetArchivePreflight = entityStore.getArchivePreflight;

    expect(failingPair).toBeDefined();
    expect(healthyPair).toBeDefined();
    expect(baselineHealthyProject).toBeDefined();
    if (!failingPair || !healthyPair || !baselineHealthyProject) {
      throw new Error("Expected store-backed projects from at least two sources.");
    }

    entityStore.getArchivePreflight = async (scope) => {
      if (scope.sourceId === failingPair.sourceId) {
        throw new Error("archive preflight unavailable");
      }

      return originalGetArchivePreflight?.call(entityStore, scope);
    };

    const triageService = createTriageViewModelService({ runtime });
    const projects = await triageService.listProjects();
    const healthyProject = projects.find(
      (project) => project.projectId === healthyPair.projectId
    );
    const degradedProjects = projects.filter(
      (project) =>
        project.archiveExport.rawArtifactsReason ===
        "Archive export availability could not be resolved for this scope."
    );

    expect(projects.length).toBeGreaterThan(0);
    expect(healthyProject?.archiveExport).toEqual(baselineHealthyProject.archiveExport);
    expect(degradedProjects.length).toBeGreaterThan(0);
  }, 15000);

  it("uses store-backed archive availability truth for v3-imported sources on Projects", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const geminiFixture = await loadGeminiArtifactFixtureFromStore(exportRuntime);
    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = `${exportRuntime.appDataDir}/exports/imported-v3-project-truth.awb-archive.json`;

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: geminiFixture.sessionId }
    });

    const importRuntime = await createScannedRuntime(tempDirs);
    const initialHydrationState = await importRuntime.getEntityStoreHydrationState();
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });

    const imported = await importer.importArchive({ archivePath });
    const importedProjectId = (
      await importRuntime.entityStore.listProjectRollups({
        sourceId: imported.sourceId
      })
    ).find((rollup): rollup is typeof rollup & { projectId: string } => Boolean(rollup.projectId))
      ?.projectId;

    const triageService = createTriageViewModelService({ runtime: importRuntime });
    const projects = await triageService.listProjects();
    const importedProject = projects.find((project) => project.projectId === importedProjectId);

    expect(initialHydrationState.sourceStates.length).toBeGreaterThan(0);
    expect(
      (await importRuntime.getEntityStoreHydrationState()).sourceStates.some(
        (state) => state.sourceId === imported.sourceId
      )
    ).toBe(false);
    expect(importedProjectId).toBeDefined();
    expect(projects.length).toBeGreaterThan(0);
    expect(importedProject?.archiveExport).toEqual(
      expect.objectContaining({
        rawArtifactsAvailable: true,
        rawArtifactCount: expect.any(Number)
      })
    );
  }, 15000);

  it("keeps session summaries explicit about verification and audit truth", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const sessionService = createSessionViewModelService({ runtime });
    const sessions = await sessionService.listSessions();

    expect(sessions.length).toBeGreaterThan(0);
    expect(
      sessions.some((session) =>
        ["Passed", "Unknown", "Unsupported", "Failed"].includes(
          session.verificationState.label
        )
      )
    ).toBe(true);
    expect(
      sessions.some((session) =>
        ["Needs Review", "Active", "Cancelled", "Failed Verification"].includes(
          session.runAuditState.label
        )
      )
    ).toBe(true);
    expect(JSON.stringify(sessions)).not.toContain("artifactPath");
  }, 15000);

  it("keeps failed-source sessions and projects visible through cache fallback after restart", async () => {
    const seedRuntime = await createScannedRuntime(tempDirs);
    const baselineOverview = await createTriageViewModelService({ runtime: seedRuntime }).getOverview();
    const baselineProjects = await createTriageViewModelService({ runtime: seedRuntime }).listProjects();
    const failingSourceId = (await seedRuntime.sourceRegistry.listSources()).find(
      (source) => source.adapterId === "fake-test"
    )?.sourceId;

    expect(failingSourceId).toBeDefined();
    if (!failingSourceId) {
      throw new Error("Expected a fake-test source to degrade.");
    }

    const runtime = await createHydrationDegradedRuntimeFromSeed(
      tempDirs,
      seedRuntime,
      failingSourceId
    );
    const triageService = createTriageViewModelService({ runtime });
    const sessionService = createSessionViewModelService({ runtime });
    const overview = await triageService.getOverview();
    const projects = await triageService.listProjects();
    const sessions = await sessionService.listSessions();
    const degradedSession = sessions.find((session) => session.sourceId === failingSourceId);

    expect(overview.metrics.totalSessions.numericValue).toBe(
      baselineOverview.metrics.totalSessions.numericValue
    );
    expect(projects).toHaveLength(baselineProjects.length);
    expect(degradedSession).toBeDefined();
    await expect(
      sessionService.getSessionById({ sessionId: degradedSession?.sessionId ?? "missing-session" })
    ).resolves.toMatchObject({
      sessionId: degradedSession?.sessionId
    });
    expect(
      projects.some((project) =>
        (project.archiveExport.rawArtifactsReason ?? "").includes("entity-store hydration failed")
      )
    ).toBe(true);
  }, 15000);

  it("re-derives session verification and audit truth instead of trusting stale cache sections", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const sessionService = createSessionViewModelService({ runtime });
    const sessions = await sessionService.listSessions();
    const target = sessions.find(
      (session) =>
        session.verificationState.label !== "Unknown" ||
        !session.attentionReasons.includes("Capability Missing")
    );

    expect(target).toBeDefined();
    if (!target) {
      throw new Error("Expected at least one scanned session with non-stale truth.");
    }

    const expectedPreview = await sessionService.getSessionById({
      sessionId: target.sessionId
    });

    expect(expectedPreview).toBeDefined();
    if (!expectedPreview) {
      throw new Error("Expected a preview for the selected session.");
    }

    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) =>
      candidate.normalized.sessions.some((session) => session.id === target.sessionId)
    );

    expect(record).toBeDefined();
    if (!record) {
      throw new Error("Expected a cache record for the selected session source.");
    }

    record.verificationResults = {
      sessions: upsertBySessionId(record.verificationResults?.sessions ?? [], target.sessionId, {
        sessionId: target.sessionId,
        verification: {
          status: "unknown",
          confidence: {
            level: "low",
            normalizedLevel: "inferred"
          },
          commandIds: [],
          intentResults: [],
          reasonCodes: ["no-qualifying-commands"]
        }
      })
    };
    record.runAudits = {
      sessions: upsertBySessionId(record.runAudits?.sessions ?? [], target.sessionId, {
        sessionId: target.sessionId,
        audit: {
          status: "needs-review",
          attentionReasons: ["capability-missing"],
          confidence: {
            level: "medium",
            normalizedLevel: "observed"
          },
          completionClaim: "claimed",
          supportingCommandIds: [],
          supportingToolCallIds: [],
          supportingMessageIds: []
        }
      })
    };

    await runtime.cacheStore.save(records);

    const reloadedPreview = await sessionService.getSessionById({
      sessionId: target.sessionId
    });

    expect(reloadedPreview).toEqual(expectedPreview);
  }, 15000);
});

function upsertBySessionId<TItem extends { sessionId: string }>(
  items: TItem[],
  sessionId: string,
  replacement: TItem
): TItem[] {
  const index = items.findIndex((item) => item.sessionId === sessionId);

  if (index === -1) {
    return [...items, replacement];
  }

  return items.map((item, itemIndex) => (itemIndex === index ? replacement : item));
}

async function seedHeatmapSource(
  runtime: Awaited<ReturnType<typeof createTempRuntime>>,
  sourceId: string,
  adapterId: string,
  sessions: Array<{
    lastUpdatedAt: string;
    runAuditStatus:
      | "active"
      | "cancelled"
      | "verification-failed"
      | "incomplete"
      | "needs-review"
      | "clean"
      | "unknown";
    sessionId: string;
  }>
): Promise<void> {
  const run = await runtime.entityStore.beginIngestRun({
    adapterId,
    sourceId,
    ingestRunId: `run-${sourceId}`,
    startedAt: sessions[0]?.lastUpdatedAt ?? "2026-05-28T00:00:00.000Z"
  });

  await runtime.entityStore.writeBatch({
    ingestRunId: run.ingestRunId,
    adapterId,
    sourceId,
    sessions: sessions.map(({ sessionId, lastUpdatedAt, runAuditStatus }) => ({
      id: sessionId,
      adapterId,
      sourceId,
      startedAt: lastUpdatedAt,
      lastUpdatedAt,
      runAudit: {
        status: runAuditStatus,
        attentionReasons: [],
        confidence: createConfidenceScore("confirmed"),
        completionClaim: "unknown",
        supportingCommandIds: [],
        supportingMessageIds: [],
        supportingToolCallIds: []
      },
      confidence: createConfidenceScore("confirmed")
    })),
    runAuditSnapshots: sessions.map(({ sessionId, runAuditStatus }) => ({
      sessionId,
      audit: {
        status: runAuditStatus,
        attentionReasons: [],
        confidence: createConfidenceScore("confirmed"),
        completionClaim: "unknown",
        supportingCommandIds: [],
        supportingMessageIds: [],
        supportingToolCallIds: []
      }
    })),
    sessionRollups: sessions.map(({ sessionId, lastUpdatedAt, runAuditStatus }) => ({
      sourceId,
      sessionId,
      latestActivityAt: lastUpdatedAt,
      runAudit: {
        status: runAuditStatus,
        attentionReasons: [],
        confidence: createConfidenceScore("confirmed"),
        completionClaim: "unknown",
        supportingCommandIds: [],
        supportingMessageIds: [],
        supportingToolCallIds: []
      }
    }))
  });
  await runtime.entityStore.publishIngestRun({
    ingestRunId: run.ingestRunId,
    sourceId,
    publishedAt: sessions.at(-1)?.lastUpdatedAt ?? "2026-05-28T00:00:00.000Z"
  });
}
