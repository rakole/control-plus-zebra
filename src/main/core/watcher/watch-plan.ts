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

export type WatchEventOrigin = Extract<WatchStrategy, "native" | "poll">;

export interface WatchRuntimeEvent {
  adapterId: AdapterId;
  sourceId: SourceId;
  origin: WatchEventOrigin;
  observedAt: string;
  scopePath?: string;
  reason?: string;
}

export interface SourceCacheStaleEvent extends WatchRuntimeEvent {
  type: "source-cache-stale";
  watchPlan: WatchLifecycleRecord;
}

export interface SourceUpdateSignalEvent extends WatchRuntimeEvent {
  type: "source-update-signaled";
  watchPlan: WatchLifecycleRecord;
}

export type RoutedWatchEvent = SourceCacheStaleEvent | SourceUpdateSignalEvent;
