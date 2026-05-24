import { afterEach, describe, expect, it } from "vitest";

import { createSessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import {
  cleanupTempDirs,
  createScannedRuntime
} from "./triage-test-runtime.js";

describe("session detail view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("returns a sanitized mixed timeline for a scanned session", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createSessionDetailViewModelService({ runtime });
    const sessions = await runtime.cacheStore.listLatestRecords();
    const sessionId = sessions[0]?.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const detail = await service.getSessionDetail({ sessionId });

    expect(detail?.timeline.length).toBeGreaterThan(0);
    expect(detail?.timeline.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["message", "shell-command"])
    );
    expect(JSON.stringify(detail)).not.toContain("artifacts/implementation-note.txt");
  });
});
