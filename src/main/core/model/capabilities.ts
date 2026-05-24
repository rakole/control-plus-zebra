import type { HarnessId, SessionId, SourceId } from "./identifiers.js";

export type CapabilityStatus = "supported" | "unsupported" | "unknown";

export interface CapabilityState {
  status: CapabilityStatus;
  reason?: string;
  details?: string;
}

export interface HarnessCapabilities {
  discovery: {
    defaultRoots: boolean;
    projectRootMapping: "native" | "inferred" | "none";
    stableProjectId: boolean;
    stableSessionId: boolean;
  };
  replay: {
    transcriptReplay: boolean;
    messageRoles: boolean;
    assistantMessages: boolean;
    lifecycleEvents: boolean;
    cancellationEvents: boolean;
    topicEvents: boolean;
    rawEventPointers: boolean;
  };
  tools: {
    toolCalls: boolean;
    toolResults: boolean;
    fileReads: boolean;
    fileSearches: boolean;
    fileMutations: boolean;
    diffStats: boolean;
    shellCommands: boolean;
    shellOutputs: boolean;
    sidecarOutputs: boolean;
  };
  usage: {
    modelNames: boolean;
    tokenCounts: boolean;
    costEstimates: boolean;
  };
  live: {
    activeSessionDetection: "mtime" | "process" | "hook" | "native" | "none";
    watchableArtifacts: boolean;
    incrementalParsing: boolean;
  };
  audit: {
    agentClaimDetection: boolean;
    finalAnswerDetection: boolean;
    shellExitCodeEvidence: boolean;
    verificationCommandEvidence: boolean;
  };
  export: {
    rawArtifactExport: boolean;
    normalizedExport: boolean;
  };
  /** @deprecated Transitional Wave 2 type-only compatibility. Use discovery.defaultRoots. */
  sessionDiscovery?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use live.activeSessionDetection. */
  liveSessionObservation?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use replay.transcriptReplay. */
  eventStreaming?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use replay.assistantMessages. */
  messageCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use tools.toolCalls. */
  toolCallCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use tools.shellCommands. */
  shellCommandCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use tools.sidecarOutputs. */
  outputArtifactCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use tools.fileMutations. */
  fileMutationCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use discovery.defaultRoots. */
  sourceValidation?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use live.watchableArtifacts. */
  watchPlans?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Git is shared-core evidence. */
  gitContextCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. GitHub is shared-core evidence. */
  githubContextCapture?: CapabilityState;
  /** @deprecated Transitional Wave 2 type-only compatibility. Use audit.verificationCommandEvidence. */
  verificationSignals?: CapabilityState;
}

export interface CapabilityEnvelope {
  adapterId: HarnessId;
  sourceId?: SourceId;
  sessionId?: SessionId;
  capabilities: HarnessCapabilities;
}

export interface ResolvedCapabilityState<TValue = boolean | string> extends CapabilityState {
  value?: TValue;
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

export function resolveBooleanCapability(
  snapshot: CapabilityEnvelope | undefined,
  select: (capabilities: HarnessCapabilities) => boolean,
  options: {
    unsupportedReason?: string;
    unknownReason?: string;
  } = {}
): ResolvedCapabilityState<boolean> {
  if (!snapshot) {
    return {
      ...capabilityState(
        "unknown",
        options.unknownReason ?? "Capability state is unavailable for this scope."
      )
    };
  }

  const value = select(snapshot.capabilities);

  return {
    ...capabilityState(
      value ? "supported" : "unsupported",
      value ? undefined : options.unsupportedReason
    ),
    value
  };
}

export function resolveEnumCapability<TValue extends string>(
  snapshot: CapabilityEnvelope | undefined,
  select: (capabilities: HarnessCapabilities) => TValue,
  options: {
    supportedValues: readonly TValue[];
    unsupportedReason?: string | ((value: TValue) => string | undefined);
    unknownReason?: string;
  }
): ResolvedCapabilityState<TValue> {
  if (!snapshot) {
    return {
      ...capabilityState(
        "unknown",
        options.unknownReason ?? "Capability state is unavailable for this scope."
      )
    };
  }

  const value = select(snapshot.capabilities);
  const isSupported = options.supportedValues.includes(value);
  const unsupportedReason =
    typeof options.unsupportedReason === "function"
      ? options.unsupportedReason(value)
      : options.unsupportedReason;

  return {
    ...capabilityState(isSupported ? "supported" : "unsupported", unsupportedReason),
    value
  };
}

export function getCapabilityViewLabel(state: CapabilityState): "Supported" | "Unsupported" | "Unknown" {
  switch (state.status) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    default:
      return "Unknown";
  }
}

export function isCapabilitySupported(state: CapabilityState | undefined): boolean {
  return state?.status === "supported";
}

export function booleanCapabilityState(
  value: boolean,
  unsupportedReason?: string
): CapabilityState {
  return capabilityState(value ? "supported" : "unsupported", value ? undefined : unsupportedReason);
}

export function enumCapabilityState<TValue extends string>(
  value: TValue,
  unsupportedValues: readonly TValue[],
  unsupportedReason?: string
): CapabilityState {
  return capabilityState(
    unsupportedValues.includes(value) ? "unsupported" : "supported",
    unsupportedValues.includes(value) ? unsupportedReason : undefined
  );
}
