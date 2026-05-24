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
    expect(overview.usageSummary.models.displayValue).toBe("Unknown");
    expect(overview.usageSummary.tokenCount.displayValue).toBe("Unknown");
    expect(overview.harnessFilters.map((filter) => filter.label)).toEqual(
      expect.arrayContaining(["Fake Test Harness", "Gemini CLI"])
    );
    await expect(triageService.getOverview({ adapterId: "gemini-cli" })).resolves.toMatchObject({
      usageSummary: {
        models: {
          displayValue: "Unknown",
          reason: "Model names are not available for every selected session."
        },
        tokenCount: {
          status: "unknown",
          displayValue: "Unknown",
          reason: "Token counts are not available for every selected session."
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
  });

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
  });
});
