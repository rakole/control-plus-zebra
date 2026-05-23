import { describe, expect, it } from "vitest";

import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";

const forbiddenKeys = new Set([
  "rawEvents",
  "artifactPath",
  "verificationStatus",
  "runAuditStatus",
  "attentionReasons"
]);

describe("session view model service", () => {
  it("maps fake adapter output into sanitized session summaries", async () => {
    const service = createSessionViewModelService();
    const sessions = await service.listSessions();

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.adapterDisplayName).toBe("Fake Test Harness");
    expect(sessions.flatMap((session) => session.capabilityBadges.map((badge) => badge.state)))
      .toEqual(expect.arrayContaining(["Unsupported", "Unknown"]));
    expect(findForbiddenKeys(sessions)).toEqual([]);
  });

  it("returns sanitized previews without raw files or audit conclusions", async () => {
    const service = createSessionViewModelService();
    const [summary] = await service.listSessions();

    expect(summary).toBeDefined();
    if (!summary) {
      throw new Error("Expected fake fixture to produce a session summary.");
    }

    const preview = await service.getSessionById({ sessionId: summary.sessionId });

    expect(preview).toEqual(
      expect.objectContaining({
        sessionId: summary.sessionId,
        adapterDisplayName: "Fake Test Harness",
        evidenceSummary: expect.objectContaining({
          messages: 2,
          toolCalls: 1,
          shellCommands: 1,
          outputArtifacts: 1,
          fileMutations: 1,
          diagnostics: 1
        })
      })
    );
    expect(findForbiddenKeys(preview)).toEqual([]);
    expect(JSON.stringify(preview)).not.toContain("artifacts/implementation-note.txt");
  });
});

function findForbiddenKeys(value: unknown): string[] {
  const matches: string[] = [];

  visit(value);
  return matches;

  function visit(candidate: unknown): void {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }

    if (!candidate || typeof candidate !== "object") {
      return;
    }

    for (const [key, nested] of Object.entries(candidate)) {
      if (forbiddenKeys.has(key)) {
        matches.push(key);
      }

      visit(nested);
    }
  }
}
