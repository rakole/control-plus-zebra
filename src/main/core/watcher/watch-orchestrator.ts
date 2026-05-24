import type { SessionSourceAdapter } from "../adapter-contract/session-source-adapter.js";
import type { AdapterContext, DiscoveredHarnessSource } from "../adapter-contract/types.js";
import type { CapabilityStatus } from "../model/capabilities.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";
import type {
  RoutedWatchEvent,
  SourceCacheStaleEvent,
  SourceUpdateSignalEvent,
  WatchEventOrigin,
  WatchLifecycleRecord,
  WatchPlan,
  WatchRuntimeEvent
} from "./watch-plan.js";

interface WatchOrchestratorHooks {
  onPlanRecorded?: (record: WatchLifecycleRecord) => Promise<void> | void;
  onSourceCacheStale?: (event: SourceCacheStaleEvent) => Promise<void> | void;
  onSourceUpdateSignaled?: (event: SourceUpdateSignalEvent) => Promise<void> | void;
}

export interface WatchRouteResult {
  accepted: boolean;
  events: RoutedWatchEvent[];
  record?: WatchLifecycleRecord;
  reason?: string;
}

export class WatchOrchestrator {
  readonly #records = new Map<SourceId, WatchLifecycleRecord>();
  readonly #hooks: WatchOrchestratorHooks;

  constructor(hooks: WatchOrchestratorHooks = {}) {
    this.#hooks = hooks;
  }

  async planForSource(
    adapter: SessionSourceAdapter,
    source: DiscoveredHarnessSource,
    context: AdapterContext
  ): Promise<WatchLifecycleRecord> {
    const plan = await adapter.getWatchPlan(source, context);
    const record = createWatchLifecycleRecord({
      adapterId: expectWatchIdentifier(plan.adapterId, adapter.descriptor.id, "adapterId"),
      sourceId: expectWatchIdentifier(plan.sourceId, source.id, "sourceId"),
      status: plan.status,
      scopePaths: [...plan.scopePaths],
      strategy: plan.strategy,
      ...(plan.reason ? { reason: plan.reason } : {})
    });

    this.#records.set(source.id, record);
    await this.#hooks.onPlanRecorded?.(record);
    return record;
  }

  getRecord(sourceId: SourceId): WatchLifecycleRecord | undefined {
    return this.#records.get(sourceId);
  }

  listRecords(): WatchLifecycleRecord[] {
    return [...this.#records.values()];
  }

  async routeEvent(event: WatchRuntimeEvent): Promise<WatchRouteResult> {
    const record = this.#records.get(event.sourceId);

    if (!record) {
      return {
        accepted: false,
        events: [],
        reason: `Source '${event.sourceId}' does not have a planned watch record.`
      };
    }

    if (record.adapterId !== event.adapterId) {
      return {
        accepted: false,
        events: [],
        record,
        reason: `Watch event adapter '${event.adapterId}' does not match planned adapter '${record.adapterId}'.`
      };
    }

    if (record.status !== "supported") {
      return {
        accepted: false,
        events: [],
        record,
        reason: `Source '${event.sourceId}' watch plan is '${record.status}', not routable.`
      };
    }

    if (!supportsOrigin(record.strategy, event.origin)) {
      return {
        accepted: false,
        events: [],
        record,
        reason: `Watch event origin '${event.origin}' does not match watch strategy '${record.strategy}'.`
      };
    }

    if (!isInPlannedScope(record, event.scopePath)) {
      return {
        accepted: false,
        events: [],
        record,
        reason: `Watch event path '${event.scopePath ?? "(missing)"}' is outside the planned watch scope.`
      };
    }

    const staleEvent: SourceCacheStaleEvent = {
      type: "source-cache-stale",
      ...event,
      watchPlan: record
    };
    const updateSignal: SourceUpdateSignalEvent = {
      type: "source-update-signaled",
      ...event,
      watchPlan: record
    };

    await this.#hooks.onSourceCacheStale?.(staleEvent);
    await this.#hooks.onSourceUpdateSignaled?.(updateSignal);

    return {
      accepted: true,
      events: [staleEvent, updateSignal],
      record
    };
  }
}

export function createWatchLifecycleRecord(input: {
  adapterId: AdapterId;
  sourceId: SourceId;
  status: CapabilityStatus;
  scopePaths: string[];
  strategy: "manual" | "native" | "none" | "poll" | "unknown";
  reason?: string;
}): WatchLifecycleRecord {
  return {
    ...input,
    plannedAt: new Date().toISOString()
  };
}

function expectWatchIdentifier<TIdentifier extends AdapterId | SourceId>(
  actual: TIdentifier,
  expected: TIdentifier,
  label: "adapterId" | "sourceId"
): TIdentifier {
  if (actual !== expected) {
    throw new Error(`Watch plan ${label} '${actual}' does not match expected '${expected}'.`);
  }

  return actual;
}

function supportsOrigin(
  strategy: WatchPlan["strategy"],
  origin: WatchEventOrigin
): boolean {
  return strategy === origin;
}

function isInPlannedScope(record: WatchLifecycleRecord, scopePath?: string): boolean {
  if (record.scopePaths.length === 0) {
    return true;
  }

  if (!scopePath) {
    return false;
  }

  return record.scopePaths.some(
    (plannedPath) => scopePath === plannedPath || scopePath.startsWith(`${plannedPath}/`)
  );
}
