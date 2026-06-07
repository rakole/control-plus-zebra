import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (
    globalThis as typeof globalThis & {
      __AW_FEATURE_GITHUB_UI__?: boolean;
    }
  ).__AW_FEATURE_GITHUB_UI__ = false;
});

import { createRunAuditViewModelService } from "../../../src/main/app/run-audit-view-model-service.js";
import { syncLatestSourceCacheRecordToEntityStore } from "../../../src/main/app/workbench-entity-store-sync.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import { buildDiagnostic } from "../../../src/main/core/diagnostics/diagnostic.js";
import { MEDIUM_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import {
  cleanupTempDirs,
  createHydrationDegradedRuntimeFromSeed,
  createScannedRuntime,
  createTempRuntime,
  loadGeminiArtifactFixtureFromStore,
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
    const sessionId = records.find((record) => record.adapterId === "fake-test")
      ?.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: sessionId,
        rawArtifactsAvailable: false,
      }),
    );
    expect(runAudit?.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Claim vs Evidence", "Capability Gaps"]),
    );

    const gitSection = runAudit?.sections.find(
      (section) =>
        section.title.startsWith("Git") && !section.title.includes("GitHub"),
    );

    expect(gitSection?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Git Snapshot", value: "Available" }),
        expect.objectContaining({ label: "Branch", value: "main" }),
      ]),
    );
    expect(gitSection?.items.map((item) => item.label)).not.toEqual(
      expect.arrayContaining([
        "GitHub Snapshot",
        "Remote URL",
        "Pull Request",
        "Checks",
        "Review Status",
      ]),
    );
    expect(
      gitSection?.items.some((item) => item.value.includes("github.com")),
    ).toBe(false);
    expect(
      runAudit?.sections.find((section) => section.title === "Commands")?.items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Observed Commands" }),
        expect.objectContaining({ label: "Failed Commands" }),
        expect.objectContaining({
          label: "Recent Commands",
          kind: "command-list",
          commands: expect.arrayContaining([
            expect.objectContaining({
              command: "npm run typecheck",
              result: "Succeeded",
            }),
          ]),
        }),
      ]),
    );
  });

  it("keeps generic custom remotes visible in the Run Audit repository section when GitHub UI is disabled", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const record = (await runtime.cacheStore.listLatestRecords()).find(
      (candidate) => candidate.adapterId === "fake-test",
    );

    expect(record?.gitSnapshots?.projects[0]?.git.snapshot).toBeDefined();
    if (!record?.gitSnapshots?.projects[0]?.git.snapshot) {
      throw new Error("Expected a fake-test project snapshot.");
    }

    record.gitSnapshots.projects[0] = {
      ...record.gitSnapshots.projects[0],
      git: {
        ...record.gitSnapshots.projects[0].git,
        snapshot: {
          ...record.gitSnapshots.projects[0].git.snapshot,
          remoteUrl:
            "ssh://git@git.company.example/example/control-plus-zebra.git",
        },
      },
    };

    await runtime.cacheStore.writeRecord(record);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const sessionId = record.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const runAudit = await service.getRunAudit({ sessionId });
    const gitSection = runAudit?.sections.find(
      (section) => section.title === "Git",
    );

    expect(gitSection?.items.map((item) => item.label)).not.toEqual(
      expect.arrayContaining([
        "GitHub Snapshot",
        "Pull Request",
        "Checks",
        "Review / Merge",
      ]),
    );
    expect(gitSection?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Remote URL",
          value: "ssh://git@git.company.example/example/control-plus-zebra.git",
        }),
      ]),
    );
  }, 15000);

  it("hides clearly GitHub-branded enterprise remotes from the Run Audit repository section when GitHub UI is disabled", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const record = (await runtime.cacheStore.listLatestRecords()).find(
      (candidate) => candidate.adapterId === "fake-test",
    );

    expect(record?.gitSnapshots?.projects[0]?.git.snapshot).toBeDefined();
    if (!record?.gitSnapshots?.projects[0]?.git.snapshot) {
      throw new Error("Expected a fake-test project snapshot.");
    }

    record.gitSnapshots.projects[0] = {
      ...record.gitSnapshots.projects[0],
      git: {
        ...record.gitSnapshots.projects[0].git,
        snapshot: {
          ...record.gitSnapshots.projects[0].git.snapshot,
          remoteUrl:
            "ssh://git@github.company.example/example/control-plus-zebra.git",
        },
      },
    };

    await runtime.cacheStore.writeRecord(record);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const sessionId = record.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const runAudit = await service.getRunAudit({ sessionId });
    const gitSection = runAudit?.sections.find(
      (section) => section.title === "Git",
    );

    expect(gitSection?.items.map((item) => item.label)).not.toEqual(
      expect.arrayContaining([
        "Remote URL",
        "GitHub Snapshot",
        "Pull Request",
        "Checks",
        "Review / Merge",
      ]),
    );
  }, 15000);

  it("keeps failed-command tone neutral when command failure truth is unknown", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const record = (await runtime.cacheStore.listLatestRecords()).find(
      (candidate) => candidate.adapterId === "fake-test",
    );

    expect(record).toBeDefined();
    if (!record) {
      throw new Error("Expected a fake-test cache record.");
    }

    const session = record.normalized.sessions[0];
    const shellCommandSession = record.shellCommands?.sessions.find(
      (entry) => entry.sessionId === session?.id,
    );
    const shellCommandEvidenceIndex = record.normalized.shellCommands.findIndex(
      (entry) => entry.sessionId === session?.id,
    );

    expect(session?.id).toBeDefined();
    expect(shellCommandSession?.shellCommands[0]).toBeDefined();
    expect(shellCommandEvidenceIndex).toBeGreaterThanOrEqual(0);
    if (
      !session?.id ||
      !shellCommandSession?.shellCommands[0] ||
      shellCommandEvidenceIndex < 0
    ) {
      throw new Error("Expected existing shell command truth to mutate.");
    }

    const { exitCode: _removedExitCode, ...unknownParsedCommand } =
      shellCommandSession.shellCommands[0];
    const { rawExitCode: _removedRawExitCode, ...unknownShellCommand } =
      record.normalized.shellCommands[shellCommandEvidenceIndex]!;

    shellCommandSession.shellCommands[0] = {
      ...unknownParsedCommand,
      result: "unknown",
      exitCodeSource: "unknown",
      rawToolStatus: "unknown",
    };
    record.normalized.shellCommands[shellCommandEvidenceIndex] = {
      ...unknownShellCommand,
      rawStatus: "unknown",
    };

    await runtime.cacheStore.writeRecord(record);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const runAudit = await service.getRunAudit({ sessionId: session.id });
    const commandsSection = runAudit?.sections.find(
      (section) => section.title === "Commands",
    );
    const failedCommands = commandsSection?.items.find(
      (item) => item.label === "Failed Commands",
    );
    const recentCommands = commandsSection?.items.find(
      (item) => item.label === "Recent Commands",
    );

    expect(failedCommands).toEqual(
      expect.objectContaining({
        value: "0",
        tone: "neutral",
      }),
    );
    expect(recentCommands).toEqual(
      expect.objectContaining({
        kind: "command-list",
        commands: expect.arrayContaining([
          expect.objectContaining({
            result: "Unknown",
          }),
        ]),
      }),
    );
  }, 15000);

  it("uses store-backed archive availability truth for v3-imported sessions on Run Audit", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const geminiFixture =
      await loadGeminiArtifactFixtureFromStore(exportRuntime);
    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      entityStore: exportRuntime.entityStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry,
    });
    const archivePath = `${exportRuntime.appDataDir}/exports/imported-v3-run-audit-truth.awb-archive.json`;

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: geminiFixture.sessionId },
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      entityStore: importRuntime.entityStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry,
    });
    const importResult = await importer.importArchive({ archivePath });
    const importedSessionPage =
      await importRuntime.entityStore.listSessionsPage({
        sourceId: importResult.sourceId,
        limit: 20,
      });
    const importedSessionId = importedSessionPage.items[0]?.session.id;
    const service = createRunAuditViewModelService({ runtime: importRuntime });

    expect(importedSessionId).toBeDefined();
    if (!importedSessionId) {
      throw new Error(
        "Expected at least one imported session for run-audit availability.",
      );
    }

    const runAudit = await service.getRunAudit({
      sessionId: importedSessionId,
    });

    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: importedSessionId,
        rawArtifactsAvailable: true,
        rawArtifactCount: expect.any(Number),
      }),
    );
  }, 15000);

  it("returns explicit unavailable archive truth when Run Audit archive availability lookup fails", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createRunAuditViewModelService({ runtime });
    const sessionId = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "fake-test",
    )?.normalized.sessions[0]?.id;
    const entityStore = runtime.entityStore as typeof runtime.entityStore & {
      getArchivePreflight?: typeof runtime.entityStore.getArchivePreflight;
    };
    const originalGetArchivePreflight = entityStore.getArchivePreflight;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error(
        "Expected a scanned session for run-audit archive fallback.",
      );
    }

    entityStore.getArchivePreflight = async () => {
      throw new Error("archive preflight unavailable");
    };

    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit).not.toBeNull();
    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: sessionId,
        rawArtifactsAvailable: false,
        rawArtifactCount: 0,
        rawArtifactsReason:
          "Archive export availability could not be resolved for this scope.",
      }),
    );

    entityStore.getArchivePreflight = originalGetArchivePreflight;
  }, 15_000);

  it("keeps run audit visible for cache-fallback sessions with explicit degraded archive truth", async () => {
    const seedRuntime = await createScannedRuntime(tempDirs);
    const sessionId = (await seedRuntime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "fake-test",
    )?.normalized.sessions[0]?.id;
    const failingSourceId = (
      await seedRuntime.sourceRegistry.listSources()
    ).find((source) => source.adapterId === "fake-test")?.sourceId;

    expect(sessionId).toBeDefined();
    expect(failingSourceId).toBeDefined();
    if (!sessionId || !failingSourceId) {
      throw new Error("Expected a fake-test source to degrade.");
    }

    const runtime = await createHydrationDegradedRuntimeFromSeed(
      tempDirs,
      seedRuntime,
      failingSourceId,
    );
    const service = createRunAuditViewModelService({ runtime });
    const runAudit = await service.getRunAudit({ sessionId });

    expect(runAudit).not.toBeNull();
    expect(runAudit?.archiveExport).toEqual(
      expect.objectContaining({
        scopeKind: "session",
        scopeId: sessionId,
        rawArtifactsAvailable: false,
        rawArtifactsReason: expect.stringContaining(
          "entity-store hydration failed",
        ),
      }),
    );
  }, 15000);

  it("filters GitHub-only diagnostics from cache-fallback run audit when GitHub UI is disabled", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const record = (await runtime.cacheStore.listLatestRecords()).find(
      (candidate) => candidate.adapterId === "fake-test",
    );
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session?.id).toBeDefined();
    if (!record || !session?.id) {
      throw new Error("Expected a fake-test source and session.");
    }

    const githubCodeDiagnostic = buildDiagnostic(
      record.adapterId,
      "github.snapshot.timeout",
      "GitHub snapshot timed out while loading repository metadata.",
      "warning",
      "session",
      MEDIUM_CONFIDENCE,
      {
        sourceId: record.sourceId,
        nativeId: "github.snapshot.timeout",
        relatedEntityIds: [session.id],
      },
    );
    const ghMessageDiagnostic = buildDiagnostic(
      record.adapterId,
      "adapter.context.snapshot-timeout",
      "GitHub context is unavailable because the shared read-only `gh` snapshot timed out.",
      "warning",
      "session",
      MEDIUM_CONFIDENCE,
      {
        sourceId: record.sourceId,
        nativeId: "adapter.context.snapshot-timeout",
        relatedEntityIds: [session.id],
      },
    );
    const visibleDiagnostic = buildDiagnostic(
      record.adapterId,
      "parser.pull-request.summary.missing",
      "Pull request summary text was missing from the session transcript.",
      "warning",
      "session",
      MEDIUM_CONFIDENCE,
      {
        sourceId: record.sourceId,
        nativeId: "parser.pull-request.summary.missing",
        relatedEntityIds: [session.id],
      },
    );

    record.normalized.diagnostics = [
      githubCodeDiagnostic,
      ghMessageDiagnostic,
      visibleDiagnostic,
    ];
    session.diagnosticIds = [
      githubCodeDiagnostic.id,
      ghMessageDiagnostic.id,
      visibleDiagnostic.id,
    ];
    record.diagnostics = {
      entries: [githubCodeDiagnostic, ghMessageDiagnostic, visibleDiagnostic],
    };

    await runtime.cacheStore.writeRecord(record);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    runtime.getEntityStoreHydrationState = async () => ({
      failedSourceIds: [record.sourceId],
      sourceStates: [
        {
          sourceId: record.sourceId,
          status: "cache-fallback",
          reason: "Simulated degraded cache-fallback state for test coverage.",
        },
      ],
    });

    const service = createRunAuditViewModelService({ runtime });
    const runAudit = await service.getRunAudit({ sessionId: session.id });
    const diagnosticsSection = runAudit?.sections.find(
      (section) => section.title === "Diagnostics",
    );
    const diagnosticsItem = diagnosticsSection?.items.find(
      (item) => item.label === "Diagnostics",
    );
    const topSignalsItem = diagnosticsSection?.items.find(
      (item) => item.label === "Top Signals",
    );

    expect(runAudit).not.toBeNull();
    expect(diagnosticsItem).toEqual(
      expect.objectContaining({
        value: "1",
        tone: "warning",
      }),
    );
    expect(topSignalsItem).toEqual(
      expect.objectContaining({
        value: visibleDiagnostic.code,
      }),
    );
  }, 15000);
});
