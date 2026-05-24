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

  it("groups audit evidence into product-facing sections with phase 7 placeholders", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const records = await runtime.cacheStore.listLatestRecords();
    const sessionId = records[0]?.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit?.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Claim vs Evidence", "Git / GitHub", "Capability Gaps"])
    );
    expect(
      runAudit?.sections
        .find((section) => section.title === "Git / GitHub")
        ?.items.some((item) => item.value === "Unknown")
    ).toBe(true);
  });
});
