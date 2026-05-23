import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";

const forbiddenKeys = new Set([
  "rawEvents",
  "artifactPath",
  "verificationStatus",
  "runAuditStatus",
  "attentionReasons"
]);

const fakeFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);
const geminiFixtureRoot = path.resolve("src/main/adapters/gemini-cli/fixtures/sample-root");

describe("session view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("maps scanned source cache data into sanitized session summaries", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createSessionViewModelService({ runtime });
    const sessions = await service.listSessions();

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.adapterDisplayName).toBe("Fake Test Harness");
    expect(sessions.flatMap((session) => session.capabilityBadges.map((badge) => badge.state)))
      .toEqual(expect.arrayContaining(["Unsupported", "Unknown"]));
    expect(findForbiddenKeys(sessions)).toEqual([]);
  });

  it("returns sanitized previews without raw files or audit conclusions", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createSessionViewModelService({ runtime });
    const [summary] = await service.listSessions();

    expect(summary).toBeDefined();
    if (!summary) {
      throw new Error("Expected scanned fake source to produce a session summary.");
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

  it("returns an honest empty state when no configured or scanned sources exist", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const service = createSessionViewModelService({ runtime });

    await expect(service.listSessions()).resolves.toEqual([]);
    await expect(service.getSessionById({ sessionId: "missing-session" })).resolves.toBeNull();
  });

  it("renders Gemini-backed sessions through the existing sanitized session service", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const geminiRoot = path.join(runtime.appDataDir, "gemini-root");

    await cp(geminiFixtureRoot, geminiRoot, { recursive: true });

    const source = await runtime.sourceRegistry.createSource({
      adapterId: "gemini-cli",
      displayName: "Gemini Fixture Root",
      rootPath: geminiRoot
    });
    const validated = await runtime.scanner.validateSource(source.sourceId);

    await runtime.scanner.scanSource(validated.source.sourceId);

    const service = createSessionViewModelService({ runtime });
    const sessions = await service.listSessions();
    const geminiSession = sessions.find((session) => session.adapterId === "gemini-cli");

    expect(geminiSession).toBeDefined();
    expect(geminiSession?.adapterDisplayName).toBe("Gemini CLI");
    expect(geminiSession?.evidenceSummary.toolCalls).toBeGreaterThan(0);
    expect(findForbiddenKeys(geminiSession)).toEqual([]);

    if (!geminiSession) {
      throw new Error("Expected a Gemini-backed session summary.");
    }

    const preview = await service.getSessionById({ sessionId: geminiSession.sessionId });

    expect(preview).toEqual(
      expect.objectContaining({
        adapterDisplayName: "Gemini CLI",
        evidenceSummary: expect.objectContaining({
          messages: expect.any(Number),
          toolCalls: expect.any(Number),
          diagnostics: expect.any(Number)
        })
      })
    );
    expect(findForbiddenKeys(preview)).toEqual([]);
  });
});

async function createScannedRuntime(tempDirs: string[]) {
  const runtime = await createTempRuntime(tempDirs);
  const source = await runtime.sourceRegistry.createSource({
    adapterId: "fake-test",
    displayName: "Fixture Source",
    rootPath: fakeFixturePath
  });
  const validated = await runtime.scanner.validateSource(source.sourceId);

  await runtime.scanner.scanSource(validated.source.sourceId);
  return runtime;
}

async function createTempRuntime(tempDirs: string[]) {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-session-service-"));

  tempDirs.push(appDataDir);
  return createWorkbenchRuntime({
    appDataDir,
    projectDir: process.cwd()
  });
}

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
