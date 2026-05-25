import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createOutputArtifactViewModelService } from "../../../src/main/app/output-artifact-view-model-service.js";
import { createSessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import type { SessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import type { WorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";
import type { SessionDetailViewModel } from "../../../src/main/ipc/view-models.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/raw-artifact-index.js";
import type { SourceRecord } from "../../../src/main/core/registry/source-registry.js";
import {
  createLargeSourceFixture,
  summarizeHydratedRecords
} from "../../fixtures/large-source-fixture.js";

describe("large source hydration removal sentinels", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("removal sentinel: listSessionsPage still hydrates full timeline, message, tool, and artifact arrays before paging", async () => {
    const fixture = createLargeSourceFixture();
    let listLatestRecordsCalls = 0;
    let hydratedCounts = summarizeHydratedRecords([]);

    const runtime = createRuntimeStub({
      records: fixture.records,
      sources: fixture.sources,
      rawArtifactEntries: fixture.rawArtifactEntries,
      onListLatestRecords(records) {
        listLatestRecordsCalls += 1;
        hydratedCounts = summarizeHydratedRecords(records);
      }
    });
    const service = createSessionViewModelService({ runtime });

    if (!service.listSessionsPage) {
      throw new Error("Expected listSessionsPage to be available.");
    }

    const page = await service.listSessionsPage({
      limit: 2
    });

    expect(listLatestRecordsCalls).toBe(1);
    expect(page.sessions).toHaveLength(2);
    expect(page.pageInfo.totalCount).toBe(fixture.summary.sessionCount);
    expect(hydratedCounts).toMatchObject({
      sourceCount: fixture.summary.sourceCount,
      sessionCount: fixture.summary.sessionCount,
      eventCount: fixture.summary.eventCount,
      messageCount: fixture.summary.messageCount,
      toolCallCount: fixture.summary.toolCallCount,
      shellCommandCount: fixture.summary.shellCommandCount,
      outputArtifactCount: fixture.summary.outputArtifactCount
    });
    expect(hydratedCounts.sessionCount).toBeGreaterThan(page.sessions.length);
    expect(hydratedCounts.eventCount).toBeGreaterThan(page.sessions.length);
    expect(hydratedCounts.messageCount).toBeGreaterThan(page.sessions.length);
    expect(hydratedCounts.toolCallCount).toBeGreaterThan(page.sessions.length);
    expect(hydratedCounts.outputArtifactCount).toBeGreaterThan(page.sessions.length);
  });

  it("removal sentinel: getSessionTimeline(limit) still loads unrelated sources and sessions via full triage hydration", async () => {
    const fixture = createLargeSourceFixture();
    let loadedSourceIds: string[] = [];
    let loadedSessionIds: string[] = [];
    let loadedEventCount = 0;

    const runtime = createRuntimeStub({
      records: fixture.records,
      sources: fixture.sources,
      rawArtifactEntries: fixture.rawArtifactEntries,
      onListLatestRecords(records) {
        loadedSourceIds = records.map((record) => record.sourceId);
        loadedSessionIds = records.flatMap((record) =>
          record.normalized.sessions.map((session) => session.id)
        );
        loadedEventCount = records.reduce(
          (count, record) => count + record.normalized.events.length,
          0
        );
      }
    });
    const service = createSessionDetailViewModelService({ runtime });

    if (!service.getSessionTimeline) {
      throw new Error("Expected getSessionTimeline to be available.");
    }

    const result = await service.getSessionTimeline({
      sessionId: fixture.target.sessionId,
      limit: 1
    });

    expect(fixture.unrelated.sourceId).not.toBe(fixture.target.sourceId);
    expect(result.timeline).toHaveLength(1);
    expect(result.pageInfo.totalCount).toBe(fixture.target.timelineEntryCount);
    expect(loadedSourceIds).toContain(fixture.unrelated.sourceId);
    expect(loadedSessionIds).toContain(fixture.unrelated.sessionId);
    expect(loadedEventCount).toBe(fixture.summary.eventCount);
    expect(loadedEventCount).toBeGreaterThan(fixture.target.timelineEntryCount);
  });

  it("removal sentinel: output artifact preview still resolves through full session detail and the full raw artifact index", async () => {
    const fixture = createLargeSourceFixture();
    let sessionDetailCalls = 0;
    let requestedSessionId = "";
    let hydratedTimelineLength = 0;
    let rawArtifactLoadCalls = 0;
    let loadedRawArtifactEntryCount = 0;

    const runtime = createRuntimeStub({
      records: fixture.records,
      sources: fixture.sources,
      rawArtifactEntries: fixture.rawArtifactEntries,
      onRawArtifactLoad(entries) {
        rawArtifactLoadCalls += 1;
        loadedRawArtifactEntryCount = entries.length;
      }
    });
    const service = createOutputArtifactViewModelService({
      runtime,
      sessionDetailService: {
        async getSessionDetail(request) {
          sessionDetailCalls += 1;
          requestedSessionId = request.sessionId;
          hydratedTimelineLength = fixture.target.timelineEntryCount;

          return {
            session: {} as SessionDetailViewModel["session"],
            timeline: buildFullTimelineSentinel(fixture.target)
          };
        }
      }
    });

    const preview = await service.getPreview({
      sessionId: fixture.target.sessionId,
      outputArtifactId: fixture.target.outputArtifactId
    });

    expect(preview).toMatchObject({
      status: "preview-ready",
      outputArtifactId: fixture.target.outputArtifactId,
      text: fixture.target.outputArtifactPreview
    });
    expect(sessionDetailCalls).toBe(1);
    expect(requestedSessionId).toBe(fixture.target.sessionId);
    expect(hydratedTimelineLength).toBe(fixture.target.timelineEntryCount);
    expect(rawArtifactLoadCalls).toBe(1);
    expect(loadedRawArtifactEntryCount).toBe(fixture.summary.rawArtifactEntryCount);
    expect(loadedRawArtifactEntryCount).toBeGreaterThan(1);
  });

  it("removal sentinel: output artifact load still enters real session detail hydration and full raw artifact index loading", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-large-artifact-load-"));
    const fixture = createLargeSourceFixture({
      rootBasePath: tempDir
    });
    const targetEntry = findTargetRawArtifactEntry(fixture.rawArtifactEntries, {
      outputArtifactId: fixture.target.outputArtifactId,
      sourceId: fixture.target.sourceId
    });

    tempDirs.push(tempDir);
    await mkdir(path.dirname(targetEntry.path ?? ""), { recursive: true });
    await writeFile(targetEntry.path ?? "", fixture.target.outputArtifactPreview, "utf8");

    const hydratedRecordCounts: ReturnType<typeof summarizeHydratedRecords>[] = [];
    let rawArtifactLoadCalls = 0;
    let loadedRawArtifactEntryCount = 0;
    let hydratedDetailTimelineLength = 0;
    const runtime = createRuntimeStub({
      records: fixture.records,
      sources: fixture.sources,
      rawArtifactEntries: fixture.rawArtifactEntries,
      onListLatestRecords(records) {
        hydratedRecordCounts.push(summarizeHydratedRecords(records));
      },
      onRawArtifactLoad(entries) {
        rawArtifactLoadCalls += 1;
        loadedRawArtifactEntryCount = entries.length;
      }
    });
    const realSessionDetailService = createSessionDetailViewModelService({ runtime });
    const measuringSessionDetailService: SessionDetailViewModelService = {
      async getSessionDetail(request) {
        const detail = await realSessionDetailService.getSessionDetail(request);

        hydratedDetailTimelineLength = detail?.timeline.length ?? 0;
        return detail;
      }
    };
    const service = createOutputArtifactViewModelService({
      runtime,
      sessionDetailService: measuringSessionDetailService
    });

    const loaded = await service.loadArtifact({
      sessionId: fixture.target.sessionId,
      outputArtifactId: fixture.target.outputArtifactId
    });

    expect(loaded).toMatchObject({
      status: "loaded",
      outputArtifactId: fixture.target.outputArtifactId,
      text: fixture.target.outputArtifactPreview
    });
    expect(hydratedRecordCounts).toHaveLength(2);
    expect(hydratedRecordCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCount: fixture.summary.sourceCount,
          sessionCount: fixture.summary.sessionCount,
          eventCount: fixture.summary.eventCount,
          outputArtifactCount: fixture.summary.outputArtifactCount
        })
      ])
    );
    expect(hydratedDetailTimelineLength).toBe(fixture.target.timelineEntryCount);
    expect(rawArtifactLoadCalls).toBe(1);
    expect(loadedRawArtifactEntryCount).toBe(fixture.summary.rawArtifactEntryCount);
    expect(loadedRawArtifactEntryCount).toBeGreaterThan(1);
  });
});

function createRuntimeStub(input: {
  records: WorkbenchRuntime["cacheStore"] extends { listLatestRecords(): Promise<infer T> } ? T : never;
  rawArtifactEntries: WorkbenchRuntime["rawArtifactIndex"] extends { load(): Promise<infer T> } ? T : never;
  sources: SourceRecord[];
  onListLatestRecords?: (
    records: WorkbenchRuntime["cacheStore"] extends { listLatestRecords(): Promise<infer T> } ? T : never
  ) => void;
  onRawArtifactLoad?: (
    entries: WorkbenchRuntime["rawArtifactIndex"] extends { load(): Promise<infer T> } ? T : never
  ) => void;
}): WorkbenchRuntime {
  const sourcesById = new Map(input.sources.map((source) => [source.sourceId, source] as const));

  return {
    appDataDir: "/virtual/agent-workbench",
    adapterRegistry: {
      listDescriptors() {
        return [{
          id: "fake-test",
          displayName: "Fake Test Harness"
        }];
      }
    } as WorkbenchRuntime["adapterRegistry"],
    cacheStore: {
      async listLatestRecords() {
        input.onListLatestRecords?.(input.records);
        return input.records;
      }
    } as WorkbenchRuntime["cacheStore"],
    rawArtifactIndex: {
      async load() {
        input.onRawArtifactLoad?.(input.rawArtifactEntries);
        return input.rawArtifactEntries;
      }
    } as WorkbenchRuntime["rawArtifactIndex"],
    sourceRegistry: {
      async getSource(sourceId) {
        return sourcesById.get(sourceId);
      },
      async listSources() {
        return input.sources;
      }
    } as WorkbenchRuntime["sourceRegistry"],
    scanner: {} as WorkbenchRuntime["scanner"],
    watchOrchestrator: {} as WorkbenchRuntime["watchOrchestrator"]
  };
}

function buildFullTimelineSentinel(target: {
  outputArtifactId: string;
  timelineEntryCount: number;
}): SessionDetailViewModel["timeline"] {
  return Array.from({ length: target.timelineEntryCount }, (_, index) => ({
    id:
      index === target.timelineEntryCount - 1
        ? target.outputArtifactId
        : `timeline-sentinel-${index + 1}`,
    kind:
      index === target.timelineEntryCount - 1
        ? "output-artifact"
        : "metadata",
    timestamp: `2026-05-25T12:${String(index).padStart(2, "0")}:00.000Z`,
    title:
      index === target.timelineEntryCount - 1
        ? "Output artifact"
        : `Timeline sentinel ${index + 1}`,
    summary:
      index === target.timelineEntryCount - 1
        ? "Target output artifact"
        : "Unrelated timeline entry",
    metadata: []
  }));
}

function findTargetRawArtifactEntry(
  entries: RawArtifactIndexEntry[],
  target: { outputArtifactId: string; sourceId: string }
): RawArtifactIndexEntry {
  const entry = entries.find(
    (candidate) =>
      candidate.sourceId === target.sourceId &&
      candidate.artifactKind === "output-artifact" &&
      candidate.nativeRef === `native-${target.outputArtifactId}`
  );

  if (!entry) {
    throw new Error(`Expected a raw artifact entry for ${target.outputArtifactId}.`);
  }

  return entry;
}
