import type { SessionSourceAdapter } from "../adapter-contract/session-source-adapter.js";
import type { AdapterContext, DiscoveredHarnessSource } from "../adapter-contract/types.js";
import type { CapabilityStatus } from "../model/capabilities.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";
import type { WatchLifecycleRecord, WatchPlan } from "./watch-plan.js";

export class WatchOrchestrator {
  readonly #records = new Map<SourceId, WatchLifecycleRecord>();

  async planForSource(
    adapter: SessionSourceAdapter,
    source: DiscoveredHarnessSource,
    context: AdapterContext
  ): Promise<WatchLifecycleRecord> {
    const plannedAt = new Date().toISOString();
    const plan =
      (await adapter.getWatchPlan?.(source, context)) ?? buildFallbackPlan(adapter, source);
    const record: WatchLifecycleRecord = {
      ...plan,
      plannedAt
    };

    this.#records.set(source.id, record);
    return record;
  }

  getRecord(sourceId: SourceId): WatchLifecycleRecord | undefined {
    return this.#records.get(sourceId);
  }

  listRecords(): WatchLifecycleRecord[] {
    return [...this.#records.values()];
  }
}

function buildFallbackPlan(
  adapter: SessionSourceAdapter,
  source: DiscoveredHarnessSource
): WatchPlan {
  const watchCapability = adapter.descriptor.capabilities.watchPlans;

  return {
    adapterId: adapter.descriptor.id,
    sourceId: source.id,
    status: watchCapability.status as CapabilityStatus,
    scopePaths: [],
    strategy: watchCapability.status === "supported" ? "manual" : "none",
    ...(watchCapability.reason ? { reason: watchCapability.reason } : {})
  };
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

