import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import {
  syncAllLatestCacheRecordsToEntityStore,
  syncLatestSourceCacheRecordToEntityStore
} from "../../../src/main/app/workbench-entity-store-sync.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";

const forbiddenKeys = new Set([
  "rawEvents",
  "artifactPath",
  "verificationStatus",
  "runAuditStatus"
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
    expect(
      sessions.flatMap((session) =>
        session.capabilityGroups.flatMap((group) =>
          group.capabilities.map((badge) => badge.state)
        )
      )
	    ).toEqual(expect.arrayContaining(["Unsupported"]));
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
          diagnostics: expect.any(Number)
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

  it("restores cache-backed sessions after restart without manual sync", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const source = await runtime.sourceRegistry.createSource({
      adapterId: "fake-test",
      displayName: "Fixture Source",
      rootPath: fakeFixturePath
    });
    const validated = await runtime.scanner.validateSource(source.sourceId);

    await runtime.scanner.scanSource(validated.source.sourceId);

    const restartedRuntime = createWorkbenchRuntime({
      appDataDir: runtime.appDataDir,
      projectDir: process.cwd()
    });
    const restartedService = createSessionViewModelService({
      runtime: restartedRuntime
    });
    const firstRestartSessions = await restartedService.listSessions();

    expect(firstRestartSessions.length).toBeGreaterThan(0);

    const secondRestartRuntime = createWorkbenchRuntime({
      appDataDir: runtime.appDataDir,
      projectDir: process.cwd()
    });
    const secondRestartService = createSessionViewModelService({
      runtime: secondRestartRuntime
    });
    const secondRestartSessions = await secondRestartService.listSessions();

    expect(secondRestartSessions).toHaveLength(firstRestartSessions.length);
    expect(
      secondRestartSessions.map((session) => session.sessionId).sort()
    ).toEqual(
      firstRestartSessions.map((session) => session.sessionId).sort()
    );
  });

  it("keeps newly scanned sources visible after hydration state is cached", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const initialHydrationState = await runtime.getEntityStoreHydrationState();
    const geminiRoot = path.join(runtime.appDataDir, "gemini-root-post-hydration");

    await cp(geminiFixtureRoot, geminiRoot, { recursive: true });

    const source = await runtime.sourceRegistry.createSource({
      adapterId: "gemini-cli",
      displayName: "Gemini Fixture Root",
      rootPath: geminiRoot
    });
    const validated = await runtime.scanner.validateSource(source.sourceId);

    await runtime.scanner.scanSource(validated.source.sourceId);
    await syncLatestSourceCacheRecordToEntityStore(runtime, validated.source.sourceId);

    expect(initialHydrationState.sourceStates.length).toBeGreaterThan(0);
    expect(
      (await runtime.getEntityStoreHydrationState()).sourceStates.some(
        (state) => state.sourceId === validated.source.sourceId
      )
    ).toBe(false);

    const service = createSessionViewModelService({ runtime });
    const sessions = await service.listSessions();
    const geminiSession = sessions.find(
      (session) => session.sourceId === validated.source.sourceId
    );
    const page = await service.listSessionsPage?.();

    expect(geminiSession).toBeDefined();
    expect(geminiSession?.adapterDisplayName).toBe("Gemini CLI");
    expect(page).toBeDefined();
    expect(
      page?.sessions.some((session) => session.sourceId === validated.source.sourceId)
    ).toBe(true);
    await expect(
      service.getSessionById({ sessionId: geminiSession?.sessionId ?? "missing-session" })
    ).resolves.toMatchObject({
      sessionId: geminiSession?.sessionId
    });
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
    await syncLatestSourceCacheRecordToEntityStore(runtime, validated.source.sourceId);

    const service = createSessionViewModelService({ runtime });
    const sessions = await service.listSessions();
    const geminiSession = sessions.find(
      (session) => session.nativeSessionId === "11111111-1111-4111-8111-111111111111"
    );

    expect(geminiSession).toBeDefined();
    expect(geminiSession?.adapterDisplayName).toBe("Gemini CLI");
    expect(geminiSession?.evidenceSummary.toolCalls).toBeGreaterThan(0);
    expect(geminiSession?.usageSummary.models.displayValue).toBe("gemini-3-flash-preview");
    expect(geminiSession?.usageSummary.tokenCount).toMatchObject({
      status: "value",
      numericValue: 552,
      displayValue: "552"
    });
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

  it("counts log-only Gemini sessions as message evidence instead of collapsing them to zero", async () => {
    const runtime = await createTempRuntime(tempDirs);
    const geminiRoot = path.join(runtime.appDataDir, "gemini-root");

    await cp(geminiFixtureRoot, geminiRoot, { recursive: true });

    const logsPath = path.join(geminiRoot, "alpha-project", "logs.json");
    const logs = JSON.parse(await readFile(logsPath, "utf8")) as Array<Record<string, unknown>>;

    logs.unshift(
      {
        sessionId: "99999999-9999-4999-8999-999999999999",
        messageId: 0,
        type: "user",
        message: "brew upgrade gemini-cli",
        timestamp: "2026-05-23T09:10:29.109Z"
      },
      {
        sessionId: "99999999-9999-4999-8999-999999999999",
        messageId: 1,
        type: "user",
        message: "/quit",
        timestamp: "2026-05-23T09:11:16.495Z"
      }
    );
    await writeFile(logsPath, `${JSON.stringify(logs, null, 2)}\n`, "utf8");

    const source = await runtime.sourceRegistry.createSource({
      adapterId: "gemini-cli",
      displayName: "Gemini Fixture Root",
      rootPath: geminiRoot
    });
    const validated = await runtime.scanner.validateSource(source.sourceId);

    await runtime.scanner.scanSource(validated.source.sourceId);
    await syncLatestSourceCacheRecordToEntityStore(runtime, validated.source.sourceId);

    const service = createSessionViewModelService({ runtime });
    const sessions = await service.listSessions();
    const logOnlySession = sessions.find(
      (session) => session.title === "brew upgrade gemini-cli"
    );

    expect(logOnlySession).toBeDefined();
    expect(logOnlySession?.evidenceSummary.messages).toBe(2);
    expect(logOnlySession?.evidenceSummary.toolCalls).toBe(0);
    expect(logOnlySession?.evidenceSummary.shellCommands).toBe(0);
    expect(logOnlySession?.evidenceSummary.diagnostics).toBe(0);
  });

  it("renders imported archive sessions without depending on the original local source root", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = (await triageService.listProjects()).find(
      (project) => project.projectDisplayName === "control-plus-zebra"
    )?.projectId;

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "sessions-import.awb-archive.json");

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      cacheStore: importRuntime.cacheStore,
      sourceRegistry: importRuntime.sourceRegistry
    });

    await importer.importArchive({ archivePath });
    await syncAllLatestCacheRecordsToEntityStore(importRuntime);

    const service = createSessionViewModelService({ runtime: importRuntime });
    const sessions = await service.listSessions();
    const importedSession = sessions[0];

    expect(importedSession).toBeDefined();
    expect(importedSession?.sourceId).toMatch(/^source_/u);
    expect(importedSession?.adapterDisplayName).toBe("Fake Test Harness");
    expect(importedSession?.projectDisplayName).toBeTruthy();
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
  await syncLatestSourceCacheRecordToEntityStore(runtime, validated.source.sourceId);
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
