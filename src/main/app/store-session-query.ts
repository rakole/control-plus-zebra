import type { NormalizedCacheRecord } from "../core/cache/file-backed-cache-store.js";
import type { Session } from "../core/model/entities.js";
import type { SourceRecord } from "../core/registry/source-registry.js";
import {
  PaginationValidationError,
  decodeOpaqueCursor,
  encodeOpaqueCursor
} from "../core/store/index.js";
import type {
  WorkbenchOverviewActivityBucket,
  WorkbenchProjectRollup,
  WorkbenchSessionCursorKey,
  WorkbenchSessionRecord,
  WorkbenchTimelinePage,
  WorkbenchTimelinePageQuery,
  WorkbenchTimelineRecord
} from "../core/store/workbench-entity-store.js";
import type {
  WorkbenchRuntime,
  WorkbenchSourceHydrationState
} from "./workbench-runtime.js";

interface GlobalSessionCursorState {
  adapterId?: string;
  fallbackIndex?: number;
  nextCursorBySourceIdJson: string;
}

export interface StoreSessionLocation {
  session: WorkbenchSessionRecord["session"];
  source: SourceRecord;
}

export interface StoreSourceCoverage {
  cacheFallbackRecords: NormalizedCacheRecord[];
  degradedSourceStatesBySourceId: Map<string, WorkbenchSourceHydrationState>;
  sourceRecordsBySourceId: Map<string, SourceRecord>;
  storeSources: SourceRecord[];
}

export interface StoreOverviewActivityHeatmapBucket {
  day: string;
  needsAttentionCount: number;
  sessionCount: number;
}

export async function listCurrentStoreSources(
  runtime: WorkbenchRuntime,
  adapterId?: string
): Promise<SourceRecord[]> {
  return (await loadStoreSourceCoverage(runtime, adapterId)).storeSources;
}

export async function loadStoreSourceCoverage(
  runtime: WorkbenchRuntime,
  adapterId?: string
): Promise<StoreSourceCoverage> {
  const [hydrationState, sources] = await Promise.all([
    runtime.getEntityStoreHydrationState(),
    runtime.sourceRegistry.listSources()
  ]);
  const sourceRecordsBySourceId = new Map(
    sources.map((source) => [source.sourceId, source] as const)
  );
  const hydrationStatesBySourceId = new Map(
    hydrationState.sourceStates.map((state) => [state.sourceId, state] as const)
  );
  const degradedSourceStatesBySourceId = new Map<string, WorkbenchSourceHydrationState>();
  const storeSources: SourceRecord[] = [];
  const degradedSources: SourceRecord[] = [];

  for (const source of sources) {
    if (adapterId && source.adapterId !== adapterId) {
      continue;
    }

    const hydration = hydrationStatesBySourceId.get(source.sourceId);

    // Hydration metadata is a best-effort bootstrap snapshot. Sources created
    // after that snapshot must still use the live entity-store path unless
    // they were explicitly marked degraded for cache fallback.
    if (!hydration || hydration.status === "store-ready") {
      storeSources.push(source);
      continue;
    }

    if (hydration.status !== "cache-fallback") {
      continue;
    }

    degradedSourceStatesBySourceId.set(source.sourceId, hydration);
    degradedSources.push(source);
  }

  storeSources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  degradedSources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const cacheFallbackRecords =
    degradedSources.length === 0
      ? []
      : (await runtime.cacheStore.listLatestRecords())
          .filter((record) =>
            degradedSources.some((source) => findLatestSourceCacheRecord([record], source))
          )
          .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  return {
    cacheFallbackRecords,
    degradedSourceStatesBySourceId,
    sourceRecordsBySourceId,
    storeSources
  };
}

export async function listGlobalSessionPage(
  runtime: WorkbenchRuntime,
  request: { adapterId?: string; cursor?: string; limit?: number }
): Promise<{
  pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
  rows: WorkbenchSessionRecord[];
}> {
  const coverage = await loadStoreSourceCoverage(
    runtime,
    request.adapterId
  );
  return listGlobalSessionPageFromCoverage(runtime, coverage, request);
}

async function listGlobalSessionPageFromCoverage(
  runtime: WorkbenchRuntime,
  coverage: StoreSourceCoverage,
  request: { adapterId?: string; cursor?: string; limit?: number }
): Promise<{
  pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
  rows: WorkbenchSessionRecord[];
}> {
  const { cacheFallbackRecords, storeSources } = coverage;
  const limit = request.limit ?? 50;
  const cursorState = decodeGlobalCursor(request.cursor, request.adapterId);
  const nextCursorBySourceId = { ...(cursorState?.nextCursorBySourceId ?? {}) };
  let fallbackIndex = cursorState?.fallbackIndex ?? 0;
  const totalCountsBySourceId = new Map<string, number>();
  const fallbackRows = buildFallbackSessionRows(cacheFallbackRecords);
  const rows: WorkbenchSessionRecord[] = [];
  const heap: Array<{
    fallbackIndex?: number;
    kind: "fallback" | "store";
    nextCursor?: string;
    row: WorkbenchSessionRecord;
    sourceId: string;
  }> = [];

  await Promise.all(
    storeSources.map(async (source) => {
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
          kind: "store",
          sourceId: source.sourceId,
          row: page.items[0],
          ...(page.pageInfo.nextCursor ? { nextCursor: page.pageInfo.nextCursor } : {})
        });
      }
    })
  );

  const initialFallbackRow = fallbackRows[fallbackIndex];

  if (initialFallbackRow) {
    heap.push({
      fallbackIndex,
      kind: "fallback",
      sourceId: initialFallbackRow.session.sourceId,
      row: initialFallbackRow
    });
  }

  sortSessionHeap(heap);

  while (rows.length < limit && heap[0]) {
    const next = heap.shift()!;

    rows.push(next.row);
    if (next.kind === "fallback") {
      fallbackIndex = (next.fallbackIndex ?? fallbackIndex) + 1;

      const nextFallbackRow = fallbackRows[fallbackIndex];

      if (nextFallbackRow) {
        heap.push({
          fallbackIndex,
          kind: "fallback",
          sourceId: nextFallbackRow.session.sourceId,
          row: nextFallbackRow
        });
        sortSessionHeap(heap);
      }
      continue;
    }

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
        kind: "store",
        sourceId: next.sourceId,
        row: page.items[0],
        ...(page.pageInfo.nextCursor ? { nextCursor: page.pageInfo.nextCursor } : {})
      });
      sortSessionHeap(heap);
    }
  }

  const hasMore = heap.length > 0;
  const totalCount =
    [...totalCountsBySourceId.values()].reduce((sum, value) => sum + value, 0) +
    fallbackRows.length;

  return {
    rows,
    pageInfo: {
      hasMore,
      ...(hasMore
        ? {
            nextCursor: encodeOpaqueCursor<GlobalSessionCursorState>({
              ...(request.adapterId ? { adapterId: request.adapterId } : {}),
              fallbackIndex,
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
  adapterId?: string,
  coverage?: StoreSourceCoverage
): Promise<WorkbenchSessionRecord[]> {
  const rows: WorkbenchSessionRecord[] = [];
  let cursor: string | undefined;
  const resolvedCoverage = coverage ?? (await loadStoreSourceCoverage(runtime, adapterId));

  for (;;) {
    const page = await listGlobalSessionPageFromCoverage(runtime, resolvedCoverage, {
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

export async function listStoreOverviewActivityHeatmapBuckets(
  runtime: WorkbenchRuntime,
  request: {
    endDay: string;
    startDay: string;
  },
  coverage?: StoreSourceCoverage
): Promise<StoreOverviewActivityHeatmapBucket[]> {
  const resolvedCoverage = coverage ?? (await loadStoreSourceCoverage(runtime));
  const countsByDay = new Map<string, StoreOverviewActivityHeatmapBucket>();
  const storeBuckets = await Promise.all(
    resolvedCoverage.storeSources.map((source) =>
      runtime.entityStore.listOverviewActivityBuckets({
        sourceId: source.sourceId,
        startDay: request.startDay,
        endDay: request.endDay
      })
    )
  );

  for (const bucket of storeBuckets.flat()) {
    mergeOverviewActivityBucket(countsByDay, bucket);
  }

  for (const record of resolvedCoverage.cacheFallbackRecords) {
    const derivedAuditBySessionId = new Map(
      (record.derived?.sessions ?? []).map((session) => [session.sessionId, session.audit] as const)
    );

    for (const session of record.normalized.sessions) {
      const stamp = session.lastUpdatedAt ?? session.startedAt;

      if (!stamp) {
        continue;
      }

      const day = stamp.slice(0, 10);

      if (day < request.startDay || day > request.endDay) {
        continue;
      }

      const runAudit = session.runAudit ?? derivedAuditBySessionId.get(session.id);

      mergeOverviewActivityBucket(countsByDay, {
        day,
        sessionCount: 1,
        needsAttentionCount: runAudit?.status === "clean" ? 0 : 1
      });
    }
  }

  return [...countsByDay.values()].sort((left, right) => left.day.localeCompare(right.day));
}

export async function findStoreSessionLocation(
  runtime: WorkbenchRuntime,
  sessionId: string
): Promise<StoreSessionLocation | undefined> {
  const coverage = await loadStoreSourceCoverage(runtime);

  for (const source of coverage.storeSources) {
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

  for (const record of coverage.cacheFallbackRecords) {
    const session = record.normalized.sessions.find((candidate) => candidate.id === sessionId);
    const source = coverage.sourceRecordsBySourceId.get(record.sourceId);

    if (session && source) {
      return {
        source,
        session
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

  if (
    state.fallbackIndex !== undefined &&
    (!Number.isInteger(state.fallbackIndex) || state.fallbackIndex < 0)
  ) {
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

function buildFallbackSessionRows(
  records: NormalizedCacheRecord[]
): WorkbenchSessionRecord[] {
  const rows = records.flatMap((record) =>
    record.normalized.sessions.map((session) => ({
      session: {
        ...session,
        sourceId: record.sourceId
      }
    }))
  );

  rows.sort(compareSessionCursorKeys);

  return rows;
}

function mergeOverviewActivityBucket(
  countsByDay: Map<string, StoreOverviewActivityHeatmapBucket>,
  bucket: WorkbenchOverviewActivityBucket | StoreOverviewActivityHeatmapBucket
): void {
  const current = countsByDay.get(bucket.day) ?? {
    day: bucket.day,
    needsAttentionCount: 0,
    sessionCount: 0
  };

  current.sessionCount += bucket.sessionCount;
  current.needsAttentionCount += bucket.needsAttentionCount;
  countsByDay.set(bucket.day, current);
}

function findLatestSourceCacheRecord(
  records: NormalizedCacheRecord[],
  source: SourceRecord
): NormalizedCacheRecord | undefined {
  return records.find((candidate) => {
    if (source.cache.cacheKey && candidate.cacheKey === source.cache.cacheKey) {
      return true;
    }

    return candidate.sourceId === source.sourceId;
  });
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
