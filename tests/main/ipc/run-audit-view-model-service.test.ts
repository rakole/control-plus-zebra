import { afterEach, describe, expect, it } from "vitest";

import { createRunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import {
  cleanupTempDirs,
  createScannedRuntime
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
});
