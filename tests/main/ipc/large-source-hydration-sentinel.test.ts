import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createOutputArtifactViewModelService } from "../../../src/main/app/output-artifact-view-model-service.js";
import { createSessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import type {
  WorkbenchEntityStoreHydrationState,
  WorkbenchRuntime
} from "../../../src/main/app/workbench-runtime.js";
import type { RawArtifactIndexEntry } from "../../../src/main/core/ingestion/raw-artifact-index.js";
import type {
  FileMutationEvidence,
  OutputArtifact,
  Session,
  SessionEvent,
  SessionMessage,
  ShellCommandEvidence,
  ToolCall
} from "../../../src/main/core/model/entities.js";
import type { SourceRecord } from "../../../src/main/core/registry/source-registry.js";
import {
  encodeOpaqueCursor,
  type WorkbenchCurrentRunScope,
  type WorkbenchSessionPageQuery,
  type WorkbenchSessionRecord,
  type WorkbenchTimelinePageQuery,
  type WorkbenchTimelineRecord
} from "../../../src/main/core/store/index.js";
import {
  createLargeSourceFixture,
  type LargeSourceFixture
} from "../../fixtures/large-source-fixture.js";

describe("large source hydration removal sentinels", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("listSessionsPage falls back to store/current-run hydration when source states are omitted", async () => {
    const fixture = createLargeSourceFixture();
    let listLatestRecordsCalls = 0;
    const runtime = createRuntimeStub(fixture, {
      onListLatestRecords() {
        listLatestRecordsCalls += 1;
      }
    });
    const service = createSessionViewModelService({ runtime });

    if (!service.listSessionsPage) {
      throw new Error("Expected listSessionsPage to be available.");
    }

    const page = await service.listSessionsPage({ limit: 2 });

    expect(listLatestRecordsCalls).toBe(0);
    expect(page.sessions).toHaveLength(2);
    expect(page.pageInfo.totalCount).toBe(fixture.summary.sessionCount);
  });

  it("listSessionsPage keeps explicit degraded-source fallback behavior", async () => {
    const fixture = createLargeSourceFixture({ sourceCount: 1 });
    let listLatestRecordsCalls = 0;
    const storeSessionPageSourceIds: string[] = [];
    const runtime = createRuntimeStub(fixture, {
      hydrationState: {
        failedSourceIds: [fixture.target.sourceId],
        sourceStates: [{
          sourceId: fixture.target.sourceId,
          status: "cache-fallback",
          reason: "entity-store hydration failed for this source"
        }]
      },
      onListLatestRecords() {
        listLatestRecordsCalls += 1;
      },
      onSessionPageQuery({ sourceId }) {
        storeSessionPageSourceIds.push(sourceId);
      }
    });
    const service = createSessionViewModelService({ runtime });

    if (!service.listSessionsPage) {
      throw new Error("Expected listSessionsPage to be available.");
    }

    const page = await service.listSessionsPage({ limit: 2 });

    expect(listLatestRecordsCalls).toBe(2);
    expect(storeSessionPageSourceIds).toEqual([]);
    expect(page.sessions).toHaveLength(2);
    expect(page.pageInfo.totalCount).toBe(fixture.summary.sessionCount);
    expect(page.sessions.every((session) => session.sourceId === fixture.target.sourceId)).toBe(true);
  });

  it("getSessionTimeline(limit) only queries the target session timeline from the store", async () => {
    const fixture = createLargeSourceFixture();
    let listLatestRecordsCalls = 0;
    const timelineQueries: Array<{ sourceId: string; sessionId: string }> = [];
    const runtime = createRuntimeStub(fixture, {
      onListLatestRecords() {
        listLatestRecordsCalls += 1;
      },
      onTimelineQuery(query) {
        timelineQueries.push(query);
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

    expect(listLatestRecordsCalls).toBe(0);
    expect(result.timeline).toHaveLength(1);
    expect(result.pageInfo.totalCount).toBe(fixture.target.timelineEntryCount);
    expect(timelineQueries).toEqual([{
      sourceId: fixture.target.sourceId,
      sessionId: fixture.target.sessionId
    }]);
  });

  it("output artifact preview resolves from store-backed timeline and raw artifact metadata only", async () => {
    const fixture = createLargeSourceFixture();
    let listLatestRecordsCalls = 0;
    let rawArtifactLoadCalls = 0;
    let sessionDetailCalls = 0;
    const runtime = createRuntimeStub(fixture, {
      onListLatestRecords() {
        listLatestRecordsCalls += 1;
      },
      onRawArtifactLoad() {
        rawArtifactLoadCalls += 1;
      }
    });
    const service = createOutputArtifactViewModelService({
      runtime,
      sessionDetailService: {
        async getSessionDetail() {
          sessionDetailCalls += 1;
          return null;
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
    expect(listLatestRecordsCalls).toBe(0);
    expect(rawArtifactLoadCalls).toBe(0);
    expect(sessionDetailCalls).toBe(0);
  });

  it("output artifact preview uses targeted store timeline lookup instead of paging the full session timeline", async () => {
    const fixture = createLargeSourceFixture();
    const timelineQueries: Array<{ sourceId: string; sessionId: string }> = [];
    const targetedLookups: Array<{
      outputArtifactId: string;
      sessionId: string;
      sourceId: string;
    }> = [];
    const runtime = createRuntimeStub(fixture, {
      onTimelineQuery(query) {
        timelineQueries.push(query);
      },
      onTargetedOutputArtifactTimelineLookup(query) {
        targetedLookups.push(query);
      }
    });
    const service = createOutputArtifactViewModelService({ runtime });

    const preview = await service.getPreview({
      sessionId: fixture.target.sessionId,
      outputArtifactId: fixture.target.outputArtifactId
    });

    expect(preview).toMatchObject({
      status: "preview-ready",
      outputArtifactId: fixture.target.outputArtifactId,
      text: fixture.target.outputArtifactPreview
    });
    expect(timelineQueries).toEqual([]);
    expect(targetedLookups).toEqual([{
      sourceId: fixture.target.sourceId,
      sessionId: fixture.target.sessionId,
      outputArtifactId: fixture.target.outputArtifactId
    }]);
  });

  it("output artifact preview returns missing when the artifact belongs to the source but not the requested session", async () => {
    const fixture = createLargeSourceFixture();
    const sourceRecord = fixture.records.find(
      (record) => record.sourceId === fixture.target.sourceId
    );
    const otherSessionOnSameSource = sourceRecord?.normalized.sessions.find(
      (session) => session.id !== fixture.target.sessionId
    );

    if (!otherSessionOnSameSource) {
      throw new Error("Expected another session on the target source.");
    }

    const timelineQueries: Array<{ sourceId: string; sessionId: string }> = [];
    const targetedLookups: Array<{
      outputArtifactId: string;
      sessionId: string;
      sourceId: string;
    }> = [];
    const runtime = createRuntimeStub(fixture, {
      onTimelineQuery(query) {
        timelineQueries.push(query);
      },
      onTargetedOutputArtifactTimelineLookup(query) {
        targetedLookups.push(query);
      }
    });
    const service = createOutputArtifactViewModelService({ runtime });

    const preview = await service.getPreview({
      sessionId: otherSessionOnSameSource.id,
      outputArtifactId: fixture.target.outputArtifactId
    });

    expect(preview).toMatchObject({
      status: "missing",
      outputArtifactId: fixture.target.outputArtifactId
    });
    expect(timelineQueries).toEqual([]);
    expect(targetedLookups).toEqual([{
      sourceId: fixture.target.sourceId,
      sessionId: otherSessionOnSameSource.id,
      outputArtifactId: fixture.target.outputArtifactId
    }]);
  });

  it("output artifact load reads the target file without cache hydration or raw index loading", async () => {
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

    let listLatestRecordsCalls = 0;
    let rawArtifactLoadCalls = 0;
    const runtime = createRuntimeStub(fixture, {
      onListLatestRecords() {
        listLatestRecordsCalls += 1;
      },
      onRawArtifactLoad() {
        rawArtifactLoadCalls += 1;
      }
    });
    const service = createOutputArtifactViewModelService({ runtime });

    const loaded = await service.loadArtifact({
      sessionId: fixture.target.sessionId,
      outputArtifactId: fixture.target.outputArtifactId
    });

    expect(loaded).toMatchObject({
      status: "loaded",
      outputArtifactId: fixture.target.outputArtifactId,
      text: fixture.target.outputArtifactPreview
    });
    expect(listLatestRecordsCalls).toBe(0);
    expect(rawArtifactLoadCalls).toBe(0);
  });
});

function createRuntimeStub(
  fixture: LargeSourceFixture,
  hooks: {
    hydrationState?: WorkbenchEntityStoreHydrationState;
    onListLatestRecords?: () => void;
    onRawArtifactLoad?: () => void;
    onSessionPageQuery?: (query: { sourceId: string }) => void;
    onTimelineQuery?: (query: { sourceId: string; sessionId: string }) => void;
    onTargetedOutputArtifactTimelineLookup?: (query: {
      outputArtifactId: string;
      sessionId: string;
      sourceId: string;
    }) => void;
  } = {}
): WorkbenchRuntime {
  const sourcesById = new Map(fixture.sources.map((source) => [source.sourceId, source] as const));
  const sessionsBySourceId = new Map<string, Session[]>();
  const sessionRollups = new Map<string, WorkbenchSessionRecord>();
  const timelineRecordsBySessionId = new Map<string, WorkbenchTimelineRecord[]>();
  const outputArtifactsByKey = new Map<string, OutputArtifact>();
  const rawMetadataByArtifactId = new Map<string, {
    artifactId: string;
    sourceId: string;
    sessionId?: string;
    outputArtifactId?: string;
    status: "available";
    entry: RawArtifactIndexEntry;
  }>();
  const rawMetadataByOutputArtifactId = new Map<string, {
    artifactId: string;
    sourceId: string;
    sessionId?: string;
    outputArtifactId?: string;
    status: "available";
    entry: RawArtifactIndexEntry;
  }>();

  for (const record of fixture.records) {
    const sessions = [...record.normalized.sessions].sort(compareSessionsByActivity);
    const messagesByEventId = indexByEventId(record.normalized.messages, (item) => item.source);
    const toolCallsByEventId = indexByEventId(record.normalized.toolCalls, (item) => item.source);
    const shellCommandsByEventId = indexByEventId(
      record.normalized.shellCommands,
      (item) => item.source
    );
    const outputArtifactsByEventId = groupArtifactsByEventId(record.normalized.outputArtifacts);
    const fileMutationsByEventId = indexByEventId(
      record.normalized.fileMutations,
      (item) => item.source
    );

    sessionsBySourceId.set(record.sourceId, sessions);

    for (const session of sessions) {
      sessionRollups.set(session.id, {
        ...(session.projectId ? { projectId: session.projectId } : {}),
        ...(session.runAudit ? { runAudit: session.runAudit } : {}),
        ...(session.verification ? { verification: session.verification } : {}),
        session
      });
    }

    for (const outputArtifact of record.normalized.outputArtifacts) {
      outputArtifactsByKey.set(buildOutputArtifactKey(record.sourceId, outputArtifact.id), outputArtifact);
    }

    for (const entry of fixture.rawArtifactEntries.filter((candidate) => candidate.sourceId === record.sourceId)) {
      const outputArtifact = record.normalized.outputArtifacts.find(
        (candidate) => candidate.nativeRef === entry.nativeRef
      );
      const metadata = {
        artifactId: entry.id,
        sourceId: record.sourceId,
        ...(outputArtifact?.sessionId ? { sessionId: outputArtifact.sessionId } : {}),
        ...(outputArtifact?.id ? { outputArtifactId: outputArtifact.id } : {}),
        status: "available" as const,
        entry
      };

      rawMetadataByArtifactId.set(entry.id, metadata);
      if (outputArtifact?.id) {
        rawMetadataByOutputArtifactId.set(
          buildOutputArtifactKey(record.sourceId, outputArtifact.id),
          metadata
        );
      }
    }

    const eventsBySessionId = new Map<string, SessionEvent[]>();
    for (const event of record.normalized.events) {
      const current = eventsBySessionId.get(event.sessionId) ?? [];
      current.push(event);
      eventsBySessionId.set(event.sessionId, current);
    }

    for (const [sessionId, events] of eventsBySessionId.entries()) {
      const timelineRecords = [...events]
        .sort(compareEventsByOrder)
        .map((event): WorkbenchTimelineRecord => ({
          event,
          ...(messagesByEventId.get(event.id) ? { message: messagesByEventId.get(event.id)! } : {}),
          ...(toolCallsByEventId.get(event.id) ? { toolCall: toolCallsByEventId.get(event.id)! } : {}),
          ...(shellCommandsByEventId.get(event.id)
            ? { shellCommand: shellCommandsByEventId.get(event.id)! }
            : {}),
          ...(outputArtifactsByEventId.get(event.id)
            ? { outputArtifacts: outputArtifactsByEventId.get(event.id)! }
            : {}),
          ...(fileMutationsByEventId.get(event.id)
            ? { fileMutation: fileMutationsByEventId.get(event.id)! }
            : {})
        }));

      timelineRecordsBySessionId.set(sessionId, timelineRecords);
    }
  }

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
        hooks.onListLatestRecords?.();
        return fixture.records;
      }
    } as WorkbenchRuntime["cacheStore"],
    entityStore: {
      async getCurrentIngestRun({ sourceId }: WorkbenchCurrentRunScope) {
        return sourcesById.has(sourceId)
          ? {
              ingestRunId: `run-${sourceId}`,
              adapterId: "fake-test",
              sourceId,
              status: "published",
              startedAt: "2026-05-25T12:00:00.000Z",
              updatedAt: "2026-05-25T12:00:00.000Z",
              publishedAt: "2026-05-25T12:00:00.000Z"
            }
          : undefined;
      },

      async listSessionsPage(query: WorkbenchSessionPageQuery) {
        hooks.onSessionPageQuery?.({
          sourceId: query.sourceId
        });
        const sessions = (sessionsBySourceId.get(query.sourceId) ?? [])
          .filter((session) => !query.adapterId || session.adapterId === query.adapterId)
          .filter((session) => !query.projectId || session.projectId === query.projectId);
        const limit = query.limit ?? 50;
        const items = sessions.slice(0, limit).map((session) => ({
          ...(session.runAudit ? { runAudit: session.runAudit } : {}),
          ...(session.verification ? { verification: session.verification } : {}),
          session
        }));

        return {
          items,
          pageInfo: {
            hasMore: sessions.length > limit,
            ...(sessions.length > limit
              ? {
                  nextCursor: encodeOpaqueCursor({
                    lastUpdatedAt: sessions[limit - 1]?.lastUpdatedAt ?? sessions[limit - 1]?.startedAt ?? "",
                    sessionId: sessions[limit - 1]?.id ?? ""
                  })
                }
              : {}),
            totalCount: sessions.length
          }
        };
      },

      async listDiagnostics() {
        return [];
      },

      async listProjectRollups() {
        return [];
      },

      async getSessionRollup({ sessionId }: { sourceId: string; sessionId: string }) {
        return sessionRollups.get(sessionId);
      },

      async getSessionTimelinePage(query: WorkbenchTimelinePageQuery) {
        hooks.onTimelineQuery?.({
          sourceId: query.sourceId,
          sessionId: query.sessionId
        });
        const records = timelineRecordsBySessionId.get(query.sessionId) ?? [];
        const limit = query.limit ?? 50;

        return {
          items: records.slice(0, limit),
          pageInfo: {
            hasMore: records.length > limit,
            totalCount: records.length
          }
        };
      },

      async getOutputArtifact(
        { sourceId, outputArtifactId }: { sourceId: string; outputArtifactId: string }
      ) {
        return outputArtifactsByKey.get(buildOutputArtifactKey(sourceId, outputArtifactId));
      },

      async getOutputArtifactTimelineRecord(
        {
          sourceId,
          sessionId,
          outputArtifactId
        }: {
          outputArtifactId: string;
          sessionId: string;
          sourceId: string;
        }
      ) {
        hooks.onTargetedOutputArtifactTimelineLookup?.({
          sourceId,
          sessionId,
          outputArtifactId
        });
        return (timelineRecordsBySessionId.get(sessionId) ?? []).find((record) =>
          (record.outputArtifacts ?? []).some((artifact) => artifact.id === outputArtifactId)
        );
      },

      async getRawArtifactMetadata(
        { sourceId, artifactId }: { sourceId: string; artifactId: string }
      ) {
        const metadata = rawMetadataByArtifactId.get(artifactId);
        return metadata?.sourceId === sourceId ? metadata : undefined;
      },

      async listRawArtifactMetadata({ sourceId }: { sourceId: string }) {
        return [...rawMetadataByArtifactId.values()].filter(
          (metadata) => metadata.sourceId === sourceId
        );
      },

      async getRawArtifactMetadataByOutputArtifactId(
        { sourceId, outputArtifactId }: { sourceId: string; outputArtifactId: string }
      ) {
        return rawMetadataByOutputArtifactId.get(
          buildOutputArtifactKey(sourceId, outputArtifactId)
        );
      }
    } as unknown as WorkbenchRuntime["entityStore"],
    async ensureEntityStoreReady() {
      return undefined;
    },
    async getEntityStoreHydrationState() {
      return hooks.hydrationState ?? {
        failedSourceIds: [],
        sourceStates: []
      };
    },
    projectDir: "/virtual/project",
    rawArtifactIndex: {
      async load() {
        hooks.onRawArtifactLoad?.();
        return fixture.rawArtifactEntries;
      }
    } as WorkbenchRuntime["rawArtifactIndex"],
    scanJobRunner: {
      getActiveScanCount() {
        return 0;
      },
      async scanSource() {
        throw new Error("large-source hydration sentinel runtime does not support scans");
      }
    },
    sourceRegistry: {
      async getSource(sourceId) {
        return sourcesById.get(sourceId);
      },
      async listSources() {
        return fixture.sources;
      }
    } as WorkbenchRuntime["sourceRegistry"],
    scanner: {} as WorkbenchRuntime["scanner"],
    watchOrchestrator: {} as WorkbenchRuntime["watchOrchestrator"]
  };
}

function buildOutputArtifactKey(sourceId: string, outputArtifactId: string): string {
  return `${sourceId}\0${outputArtifactId}`;
}

function indexByEventId<TItem>(
  items: TItem[],
  selectSource: (item: TItem) => unknown
): Map<string, TItem> {
  const indexed = new Map<string, TItem>();

  for (const item of items) {
    const eventId = getSourceEventId(selectSource(item));

    if (eventId) {
      indexed.set(eventId, item);
    }
  }

  return indexed;
}

function groupArtifactsByEventId(items: OutputArtifact[]): Map<string, OutputArtifact[]> {
  const grouped = new Map<string, OutputArtifact[]>();

  for (const item of items) {
    const eventId = getSourceEventId(item.source);

    if (!eventId) {
      continue;
    }

    const current = grouped.get(eventId) ?? [];
    current.push(item);
    grouped.set(eventId, current);
  }

  return grouped;
}

function getSourceEventId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const eventId = (value as { eventId?: unknown }).eventId;
  return typeof eventId === "string" ? eventId : undefined;
}

function compareSessionsByActivity(left: Session, right: Session): number {
  const leftTimestamp = left.lastUpdatedAt ?? left.startedAt ?? "";
  const rightTimestamp = right.lastUpdatedAt ?? right.startedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return right.id.localeCompare(left.id);
}

function compareEventsByOrder(left: SessionEvent, right: SessionEvent): number {
  const leftKey = left.orderKey ?? left.timestamp ?? left.id;
  const rightKey = right.orderKey ?? right.timestamp ?? right.id;

  return leftKey.localeCompare(rightKey);
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
