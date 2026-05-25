import { afterEach, describe, expect, it } from "vitest";

import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import {
  cleanupTempDirs,
  createScannedRuntime
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
    expect(rawArtifactIndexLoadCount).toBe(1);
    expect(sourceListCount).toBe(3);
  }, 15000);

  it("keeps project rollups visible when archive availability cannot be read", async () => {
    const runtime = await createScannedRuntime(tempDirs);

    runtime.rawArtifactIndex = {
      load: async () => {
        throw new Error("raw artifact index unavailable");
      }
    } as unknown as typeof runtime.rawArtifactIndex;

    const triageService = createTriageViewModelService({ runtime });
    const projects = await triageService.listProjects();

    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((project) => !project.archiveExport.rawArtifactsAvailable)).toBe(true);
    expect(projects[0]?.archiveExport.rawArtifactsReason).toBe(
      "Archive export availability could not be resolved for this scope."
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
