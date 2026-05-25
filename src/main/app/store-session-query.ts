import type { SourceRecord } from "../core/registry/source-registry.js";
import {
  PaginationValidationError,
  decodeOpaqueCursor,
  encodeOpaqueCursor
} from "../core/store/index.js";
import type {
  WorkbenchProjectRollup,
  WorkbenchSessionCursorKey,
  WorkbenchSessionRecord,
  WorkbenchTimelinePage,
  WorkbenchTimelinePageQuery,
  WorkbenchTimelineRecord
} from "../core/store/workbench-entity-store.js";
import type { WorkbenchRuntime } from "./workbench-runtime.js";

interface GlobalSessionCursorState {
  adapterId?: string;
  nextCursorBySourceIdJson: string;
}

export interface StoreSessionLocation {
  session: WorkbenchSessionRecord["session"];
  source: SourceRecord;
}

export async function listCurrentStoreSources(
  runtime: WorkbenchRuntime,
  adapterId?: string
): Promise<SourceRecord[]> {
  const sources = await runtime.sourceRegistry.listSources();
  const currentRuns = await Promise.all(
    sources.map(async (source) => ({
      source,
      currentRun: await runtime.entityStore.getCurrentIngestRun({ sourceId: source.sourceId })
    }))
  );

  return currentRuns
    .filter(({ source, currentRun }) => {
      if (!currentRun) {
        return false;
      }

      return !adapterId || source.adapterId === adapterId;
    })
    .map(({ source }) => source)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export async function listGlobalSessionPage(
  runtime: WorkbenchRuntime,
  request: { adapterId?: string; cursor?: string; limit?: number }
): Promise<{
  pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
  rows: WorkbenchSessionRecord[];
}> {
  const sources = await listCurrentStoreSources(runtime, request.adapterId);
  const limit = request.limit ?? 50;
  const cursorState = decodeGlobalCursor(request.cursor, request.adapterId);
  const nextCursorBySourceId = { ...(cursorState?.nextCursorBySourceId ?? {}) };
  const totalCountsBySourceId = new Map<string, number>();
  const rows: WorkbenchSessionRecord[] = [];
  const heap: Array<{
    nextCursor?: string;
    row: WorkbenchSessionRecord;
    sourceId: string;
  }> = [];

  await Promise.all(
    sources.map(async (source) => {
      const sourceCursor = nextCursorBySourceId[source.sourceId];
      const query = {
        sourceId: source.sourceId,
        ...(request.adapterId ? { adapterId: request.adapterId } : {}),
        ...(sourceCursor ? { cursor: sourceCursor } : {}),
        limit: 1
      };
      const page = await runtime.entityStore.listSessionsPage(query);

      totalCountsBySourceId.set(source.sourceId, page.pageInfo.totalCount ?? 0);

      if (page.items[0]) {
        heap.push({
          sourceId: source.sourceId,
          row: page.items[0],
          ...(page.pageInfo.nextCursor ? { nextCursor: page.pageInfo.nextCursor } : {})
        });
      }
    })
  );

  sortSessionHeap(heap);

  while (rows.length < limit && heap[0]) {
    const next = heap.shift()!;

    rows.push(next.row);
    nextCursorBySourceId[next.sourceId] = next.nextCursor;

    const nextCursor = next.nextCursor;

    if (!nextCursor) {
      continue;
    }

    const page = await runtime.entityStore.listSessionsPage({
      sourceId: next.sourceId,
      ...(request.adapterId ? { adapterId: request.adapterId } : {}),
      cursor: nextCursor,
      limit: 1
    });

    if (page.items[0]) {
      heap.push({
        sourceId: next.sourceId,
        row: page.items[0],
        ...(page.pageInfo.nextCursor ? { nextCursor: page.pageInfo.nextCursor } : {})
      });
      sortSessionHeap(heap);
    }
  }

  const hasMore = heap.length > 0;
  const totalCount = [...totalCountsBySourceId.values()].reduce((sum, value) => sum + value, 0);

  return {
    rows,
    pageInfo: {
      hasMore,
      ...(hasMore
        ? {
            nextCursor: encodeOpaqueCursor<GlobalSessionCursorState>({
              ...(request.adapterId ? { adapterId: request.adapterId } : {}),
              nextCursorBySourceIdJson: JSON.stringify(
                Object.fromEntries(
                  Object.entries(nextCursorBySourceId).filter(([, value]) => Boolean(value))
                )
              )
            })
          }
        : {}),
      totalCount
    }
  };
}

export async function listAllStoreSessions(
  runtime: WorkbenchRuntime,
  adapterId?: string
): Promise<WorkbenchSessionRecord[]> {
  const rows: WorkbenchSessionRecord[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await listGlobalSessionPage(runtime, {
      ...(adapterId ? { adapterId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 100
    });

    rows.push(...page.rows);

    if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) {
      return rows;
    }

    cursor = page.pageInfo.nextCursor;
  }
}

export async function findStoreSessionLocation(
  runtime: WorkbenchRuntime,
  sessionId: string
): Promise<StoreSessionLocation | undefined> {
  const sources = await listCurrentStoreSources(runtime);

  for (const source of sources) {
    const rollup = await runtime.entityStore.getSessionRollup({
      sourceId: source.sourceId,
      sessionId
    });

    if (rollup?.session) {
      return {
        source,
        session: rollup.session
      };
    }
  }

  return undefined;
}

export async function listProjectRollupsBySourceId(
  runtime: WorkbenchRuntime,
  sourceId: string
): Promise<Map<string, WorkbenchProjectRollup>> {
  const rollups = await runtime.entityStore.listProjectRollups({ sourceId });

  return new Map(
    rollups
      .filter((rollup) => rollup.projectId)
      .map((rollup) => [rollup.projectId!, rollup] as const)
  );
}

export async function collectSessionTimelineRecords(
  runtime: WorkbenchRuntime,
  request: WorkbenchTimelinePageQuery
): Promise<WorkbenchTimelinePage> {
  return runtime.entityStore.getSessionTimelinePage(request);
}

export async function collectAllSessionTimelineRecords(
  runtime: WorkbenchRuntime,
  sourceId: string,
  sessionId: string
): Promise<WorkbenchTimelineRecord[]> {
  const items: WorkbenchTimelineRecord[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await runtime.entityStore.getSessionTimelinePage({
      sourceId,
      sessionId,
      ...(cursor ? { cursor } : {}),
      limit: 100
    });

    items.push(...page.items);

    if (!page.pageInfo.nextCursor) {
      return items;
    }

    cursor = page.pageInfo.nextCursor;
  }
}

function decodeGlobalCursor(
  cursor: string | undefined,
  adapterId?: string
): (GlobalSessionCursorState & {
  nextCursorBySourceId: Record<string, string | undefined>;
}) | undefined {
  if (!cursor) {
    return undefined;
  }

  const state = decodeOpaqueCursor<GlobalSessionCursorState>(cursor);

  if ((state.adapterId ?? undefined) !== (adapterId ?? undefined)) {
    throw new PaginationValidationError("invalid-cursor");
  }

  return {
    ...state,
    nextCursorBySourceId: parseSourceCursorState(state.nextCursorBySourceIdJson)
  };
}

function parseSourceCursorState(value: string): Record<string, string | undefined> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PaginationValidationError("invalid-cursor");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PaginationValidationError("invalid-cursor");
  }

  const sourceCursorState: Record<string, string | undefined> = {};

  for (const [sourceId, cursor] of Object.entries(parsed)) {
    if (typeof cursor !== "string") {
      throw new PaginationValidationError("invalid-cursor");
    }

    sourceCursorState[sourceId] = cursor;
  }

  return sourceCursorState;
}

function sortSessionHeap(
  heap: Array<{ row: WorkbenchSessionRecord }>
): void {
  heap.sort((left, right) => compareSessionCursorKeys(left.row, right.row));
}

function compareSessionCursorKeys(
  left: WorkbenchSessionRecord,
  right: WorkbenchSessionRecord
): number {
  const leftKey = toSessionCursorKey(left);
  const rightKey = toSessionCursorKey(right);

  if (leftKey.lastUpdatedAt !== rightKey.lastUpdatedAt) {
    return rightKey.lastUpdatedAt.localeCompare(leftKey.lastUpdatedAt);
  }

  return rightKey.sessionId.localeCompare(leftKey.sessionId);
}

function toSessionCursorKey(
  row: WorkbenchSessionRecord
): WorkbenchSessionCursorKey {
  return {
    lastUpdatedAt: row.session.lastUpdatedAt ?? row.session.startedAt ?? "",
    sessionId: row.session.id
  };
}
