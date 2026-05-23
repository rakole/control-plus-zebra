import type { AdapterId, SessionId, SourceId } from "./identifiers.js";

export type CapabilityStatus = "supported" | "unsupported" | "unknown";

export interface CapabilityState {
  status: CapabilityStatus;
  reason?: string;
  details?: string;
}

export interface HarnessCapabilities {
  sessionDiscovery: CapabilityState;
  liveSessionObservation: CapabilityState;
  eventStreaming: CapabilityState;
  messageCapture: CapabilityState;
  toolCallCapture: CapabilityState;
  shellCommandCapture: CapabilityState;
  outputArtifactCapture: CapabilityState;
  fileMutationCapture: CapabilityState;
  sourceValidation: CapabilityState;
  watchPlans: CapabilityState;
  gitContextCapture: CapabilityState;
  githubContextCapture: CapabilityState;
  verificationSignals: CapabilityState;
}

export interface CapabilityEnvelope {
  adapterId: AdapterId;
  sourceId?: SourceId;
  sessionId?: SessionId;
  capabilities: HarnessCapabilities;
}

export const UNKNOWN_CAPABILITY_STATE: CapabilityState = { status: "unknown" };

export function capabilityState(
  status: CapabilityStatus,
  reason?: string,
  details?: string
): CapabilityState {
  return {
    status,
    ...(reason ? { reason } : {}),
    ...(details ? { details } : {})
  };
}
