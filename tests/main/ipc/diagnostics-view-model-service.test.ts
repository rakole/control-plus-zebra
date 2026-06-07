import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiagnosticsViewModelService } from "../../../src/main/app/diagnostics-view-model-service.js";
import { syncLatestSourceCacheRecordToEntityStore } from "../../../src/main/app/workbench-entity-store-sync.js";
import { buildDiagnostic } from "../../../src/main/core/diagnostics/diagnostic.js";
import { MEDIUM_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import {
  cleanupTempDirs,
  createScannedRuntime,
} from "./triage-test-runtime.js";

vi.hoisted(() => {
  (
    globalThis as typeof globalThis & {
      __AW_FEATURE_GITHUB_UI__?: boolean;
    }
  ).__AW_FEATURE_GITHUB_UI__ = false;
});

describe("diagnostics view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("groups source, normalization, and cache diagnostics into sanitized DTOs", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    let cacheReads = 0;
    runtime.cacheStore.listLatestRecords = async () => {
      cacheReads += 1;
      throw new Error("diagnostics route should not hydrate cache records");
    };
    const service = createDiagnosticsViewModelService({ runtime });
    const diagnostics = await service.listDiagnostics();

    expect(cacheReads).toBe(0);
    expect(diagnostics.groups.length).toBeGreaterThan(0);
    expect(
      diagnostics.groups.some((group) => group.sourceArea === "capability"),
    ).toBe(false);
    expect(
      diagnostics.groups.every((group) =>
        group.diagnostics.every(
          (diagnostic) => !diagnostic.message.includes("/tmp/"),
        ),
      ),
    ).toBe(true);

    const rows = diagnostics.groups.flatMap((group) => group.diagnostics);
    const rowKeys = rows.map((row) =>
      [
        row.adapterId,
        row.code,
        row.severity,
        row.message,
        row.sessionId ?? "",
        row.sessionTitle ?? "",
        row.projectDisplayName ?? "",
      ].join("\0"),
    );

    expect(new Set(rowKeys).size).toBe(rowKeys.length);
    expect(
      rows.filter((row) => row.sessionId).every((row) => row.sessionTitle),
    ).toBe(true);
    expect(rows.some((row) => row.code.startsWith("github."))).toBe(false);
  }, 15000);

  it("filters GitHub-only diagnostics by message without hiding unrelated pull-request diagnostics", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const source = (await runtime.sourceRegistry.listSources()).find(
      (candidate) => candidate.adapterId === "fake-test",
    );

    expect(source).toBeDefined();
    if (!source) {
      throw new Error("Expected a fake-test source.");
    }

    const record = await runtime.cacheStore.getLatestSourceRecord(
      source.sourceId,
    );
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session?.id).toBeDefined();
    if (!record || !session?.id) {
      throw new Error("Expected a fake-test cache record with a session.");
    }

    const githubOnlyMessageDiagnostic = buildDiagnostic(
      record.adapterId,
      "adapter.github.message-only",
      "GitHub context is unavailable because the shared read-only `gh` snapshot timed out.",
      "warning",
      "session",
      MEDIUM_CONFIDENCE,
      {
        sourceId: record.sourceId,
        nativeId: "adapter.github.message-only",
        relatedEntityIds: [session.id],
      },
    );
    const pullRequestParserDiagnostic = buildDiagnostic(
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

    record.normalized.diagnostics.push(
      githubOnlyMessageDiagnostic,
      pullRequestParserDiagnostic,
    );
    session.diagnosticIds = [
      ...(session.diagnosticIds ?? []),
      githubOnlyMessageDiagnostic.id,
      pullRequestParserDiagnostic.id,
    ];
    record.diagnostics = {
      entries: [
        ...(record.diagnostics?.entries ?? []),
        githubOnlyMessageDiagnostic,
        pullRequestParserDiagnostic,
      ],
    };

    await runtime.cacheStore.writeRecord(record);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const service = createDiagnosticsViewModelService({ runtime });
    const diagnostics = await service.listDiagnostics();
    const storeDiagnostics = await runtime.entityStore.listDiagnostics({
      sourceId: record.sourceId,
    });
    const rows = diagnostics.groups.flatMap((group) => group.diagnostics);

    expect(
      record.normalized.diagnostics.some(
        (diagnostic) => diagnostic.id === githubOnlyMessageDiagnostic.id,
      ),
    ).toBe(true);
    expect(
      storeDiagnostics.some(
        (diagnostic) => diagnostic.id === githubOnlyMessageDiagnostic.id,
      ),
    ).toBe(true);
    expect(
      storeDiagnostics.some(
        (diagnostic) => diagnostic.id === pullRequestParserDiagnostic.id,
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.code === githubOnlyMessageDiagnostic.code),
    ).toBe(false);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: pullRequestParserDiagnostic.code,
          message: pullRequestParserDiagnostic.message,
        }),
      ]),
    );
  }, 15000);
});
