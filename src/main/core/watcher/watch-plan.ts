import type { CapabilityStatus } from "../model/capabilities.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";

export type WatchStrategy = "manual" | "native" | "none" | "poll" | "unknown";

export interface WatchPlan {
  adapterId: AdapterId;
  sourceId: SourceId;
  status: CapabilityStatus;
  scopePaths: string[];
  strategy: WatchStrategy;
  reason?: string;
}

export interface WatchLifecycleRecord extends WatchPlan {
  plannedAt: string;
}

