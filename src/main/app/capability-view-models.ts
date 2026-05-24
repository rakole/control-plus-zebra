import type { CapabilityState, HarnessCapabilities } from "../core/model/capabilities.js";
import type {
  CapabilityBadgeViewModel,
  CapabilityGroupKey,
  CapabilityGroupViewModel
} from "../ipc/view-models.js";

type LegacyCapabilityKey = keyof HarnessCapabilities;
type FlatCapabilityValue = CapabilityState | boolean | string;

interface SpecCapabilityDefinition {
  key: string;
  label: string;
  kind: "boolean" | "enum";
  unsupportedValues?: string[];
}

const legacyCapabilityGroupMembers: Record<
  CapabilityGroupKey,
  ReadonlyArray<{ key: LegacyCapabilityKey; label: string }>
> = {
  discovery: [
    { key: "sessionDiscovery", label: "Session Discovery" },
    { key: "sourceValidation", label: "Source Validation" }
  ],
  replay: [
    { key: "eventStreaming", label: "Transcript Replay" },
    { key: "messageCapture", label: "Assistant Messages" }
  ],
  tools: [
    { key: "toolCallCapture", label: "Tool Calls" },
    { key: "shellCommandCapture", label: "Shell Commands" },
    { key: "outputArtifactCapture", label: "Sidecar Outputs" },
    { key: "fileMutationCapture", label: "File Mutations" }
  ],
  usage: [],
  live: [
    { key: "liveSessionObservation", label: "Active Session Detection" },
    { key: "watchPlans", label: "Watchable Artifacts" }
  ],
  audit: [
    { key: "verificationSignals", label: "Verification Command Evidence" },
    { key: "gitContextCapture", label: "Git Context" },
    { key: "githubContextCapture", label: "GitHub Context" }
  ],
  export: []
};

const specCapabilityGroupMembers: Record<CapabilityGroupKey, ReadonlyArray<SpecCapabilityDefinition>> =
  {
    discovery: [
      { key: "defaultRoots", label: "Default Roots", kind: "boolean" },
      {
        key: "projectRootMapping",
        label: "Project Root Mapping",
        kind: "enum",
        unsupportedValues: ["none"]
      },
      { key: "stableProjectId", label: "Stable Project ID", kind: "boolean" },
      { key: "stableSessionId", label: "Stable Session ID", kind: "boolean" }
    ],
    replay: [
      { key: "transcriptReplay", label: "Transcript Replay", kind: "boolean" },
      { key: "messageRoles", label: "Message Roles", kind: "boolean" },
      { key: "assistantMessages", label: "Assistant Messages", kind: "boolean" },
      { key: "lifecycleEvents", label: "Lifecycle Events", kind: "boolean" },
      { key: "cancellationEvents", label: "Cancellation Events", kind: "boolean" },
      { key: "topicEvents", label: "Topic Events", kind: "boolean" },
      { key: "rawEventPointers", label: "Raw Event Pointers", kind: "boolean" }
    ],
    tools: [
      { key: "toolCalls", label: "Tool Calls", kind: "boolean" },
      { key: "toolResults", label: "Tool Results", kind: "boolean" },
      { key: "fileReads", label: "File Reads", kind: "boolean" },
      { key: "fileSearches", label: "File Searches", kind: "boolean" },
      { key: "fileMutations", label: "File Mutations", kind: "boolean" },
      { key: "diffStats", label: "Diff Stats", kind: "boolean" },
      { key: "shellCommands", label: "Shell Commands", kind: "boolean" },
      { key: "shellOutputs", label: "Shell Outputs", kind: "boolean" },
      { key: "sidecarOutputs", label: "Sidecar Outputs", kind: "boolean" }
    ],
    usage: [
      { key: "modelNames", label: "Model Names", kind: "boolean" },
      { key: "tokenCounts", label: "Token Counts", kind: "boolean" },
      { key: "costEstimates", label: "Cost Estimates", kind: "boolean" }
    ],
    live: [
      {
        key: "activeSessionDetection",
        label: "Active Session Detection",
        kind: "enum",
        unsupportedValues: ["none"]
      },
      { key: "watchableArtifacts", label: "Watchable Artifacts", kind: "boolean" },
      { key: "incrementalParsing", label: "Incremental Parsing", kind: "boolean" }
    ],
    audit: [
      { key: "agentClaimDetection", label: "Agent Claim Detection", kind: "boolean" },
      { key: "finalAnswerDetection", label: "Final Answer Detection", kind: "boolean" },
      { key: "shellExitCodeEvidence", label: "Shell Exit Code Evidence", kind: "boolean" },
      {
        key: "verificationCommandEvidence",
        label: "Verification Command Evidence",
        kind: "boolean"
      }
    ],
    export: [
      { key: "rawArtifactExport", label: "Raw Artifact Export", kind: "boolean" },
      { key: "normalizedExport", label: "Normalized Export", kind: "boolean" }
    ]
  };

const capabilityGroupLabels: Record<CapabilityGroupKey, string> = {
  discovery: "Discovery",
  replay: "Replay",
  tools: "Tools",
  usage: "Usage",
  live: "Live",
  audit: "Audit",
  export: "Export"
};

const specCapabilityFallbackKeys: Record<CapabilityGroupKey, Record<string, readonly string[]>> = {
  discovery: {
    defaultRoots: ["defaultRoots", "sessionDiscovery", "sourceValidation"],
    projectRootMapping: ["projectRootMapping"],
    stableProjectId: ["stableProjectId"],
    stableSessionId: ["stableSessionId"]
  },
  replay: {
    transcriptReplay: ["transcriptReplay", "eventStreaming"],
    messageRoles: ["messageRoles"],
    assistantMessages: ["assistantMessages", "messageCapture"],
    lifecycleEvents: ["lifecycleEvents"],
    cancellationEvents: ["cancellationEvents"],
    topicEvents: ["topicEvents"],
    rawEventPointers: ["rawEventPointers"]
  },
  tools: {
    toolCalls: ["toolCalls", "toolCallCapture"],
    toolResults: ["toolResults"],
    fileReads: ["fileReads"],
    fileSearches: ["fileSearches"],
    fileMutations: ["fileMutations", "fileMutationCapture"],
    diffStats: ["diffStats"],
    shellCommands: ["shellCommands", "shellCommandCapture"],
    shellOutputs: ["shellOutputs"],
    sidecarOutputs: ["sidecarOutputs", "outputArtifactCapture"]
  },
  usage: {
    modelNames: ["modelNames"],
    tokenCounts: ["tokenCounts"],
    costEstimates: ["costEstimates"]
  },
  live: {
    activeSessionDetection: ["activeSessionDetection", "liveSessionObservation"],
    watchableArtifacts: ["watchableArtifacts", "watchPlans"],
    incrementalParsing: ["incrementalParsing"]
  },
  audit: {
    agentClaimDetection: ["agentClaimDetection"],
    finalAnswerDetection: ["finalAnswerDetection"],
    shellExitCodeEvidence: ["shellExitCodeEvidence"],
    verificationCommandEvidence: [
      "verificationCommandEvidence",
      "verificationSignals"
    ]
  },
  export: {
    rawArtifactExport: ["rawArtifactExport"],
    normalizedExport: ["normalizedExport"]
  }
};

export function toCapabilityGroups(capabilities: unknown): CapabilityGroupViewModel[] {
  return (Object.keys(capabilityGroupLabels) as CapabilityGroupKey[]).map((groupKey) => ({
    key: groupKey,
    label: capabilityGroupLabels[groupKey],
    capabilities: toCapabilityBadgesForGroup(capabilities, groupKey)
  }));
}

export function flattenCapabilityGroups(
  groups: CapabilityGroupViewModel[]
): CapabilityBadgeViewModel[] {
  return groups.flatMap((group) => group.capabilities);
}

export function getGroupedCapabilityState(
  capabilities: unknown,
  groupKey: CapabilityGroupKey,
  capabilityKey: string
): CapabilityState | undefined {
  const specState = getSpecCapabilityState(capabilities, groupKey, capabilityKey);

  if (specState) {
    return specState;
  }

  const flatSpecState = getFlatSpecCapabilityState(capabilities, groupKey, capabilityKey);

  if (flatSpecState) {
    return flatSpecState;
  }

  const legacyMatch = legacyCapabilityGroupMembers[groupKey].find(
    (capability) => capability.key === capabilityKey
  );

  return legacyMatch ? getLegacyCapabilityState(capabilities, legacyMatch.key) : undefined;
}

function toCapabilityBadgesForGroup(
  capabilities: unknown,
  groupKey: CapabilityGroupKey
): CapabilityBadgeViewModel[] {
  return specCapabilityGroupMembers[groupKey]
    .map((capability) => {
      const state = getGroupedCapabilityState(capabilities, groupKey, capability.key) ?? {
        status: "unknown"
      };

      return {
        key: `${groupKey}.${capability.key}`,
        label: capability.label,
        state: toCapabilityLabel(state.status),
        ...(state.reason ? { reason: state.reason } : {})
      };
    })
    .filter((capability) => capability !== null) as CapabilityBadgeViewModel[];
}

function getLegacyCapabilityState(
  capabilities: unknown,
  capabilityKey: LegacyCapabilityKey
): CapabilityState | undefined {
  const record = asRecord(capabilities);
  const value = record?.[capabilityKey];

  return isCapabilityState(value) ? value : undefined;
}

function getSpecCapabilityState(
  capabilities: unknown,
  groupKey: CapabilityGroupKey,
  capabilityKey: string
): CapabilityState | undefined {
  const groupRecord = asRecord(asRecord(capabilities)?.[groupKey]);

  if (!groupRecord || !(capabilityKey in groupRecord)) {
    return undefined;
  }

  const value = groupRecord[capabilityKey];
  const definition = specCapabilityGroupMembers[groupKey].find(
    (capability) => capability.key === capabilityKey
  );

  if (!definition) {
    return undefined;
  }

  if (definition.kind === "boolean") {
    if (value === true) {
      return { status: "supported" };
    }

    if (value === false) {
      return { status: "unsupported" };
    }

    return { status: "unknown" };
  }

  if (typeof value !== "string") {
    return { status: "unknown" };
  }

  if (definition.unsupportedValues?.includes(value)) {
    return { status: "unsupported", reason: humanizeCapabilityValue(value) };
  }

  return { status: "supported", reason: humanizeCapabilityValue(value) };
}

function getFlatSpecCapabilityState(
  capabilities: unknown,
  groupKey: CapabilityGroupKey,
  capabilityKey: string
): CapabilityState | undefined {
  const record = asRecord(capabilities);
  const definition = specCapabilityGroupMembers[groupKey].find(
    (capability) => capability.key === capabilityKey
  );
  const fallbackKeys = specCapabilityFallbackKeys[groupKey][capabilityKey];

  if (!record || !definition || !fallbackKeys) {
    return undefined;
  }

  for (const fallbackKey of fallbackKeys) {
    if (!(fallbackKey in record)) {
      continue;
    }

	    const state = toSpecCapabilityState(asFlatCapabilityValue(record[fallbackKey]), definition);

    if (state) {
      return state;
    }
  }

  return undefined;
}

function toSpecCapabilityState(
  value: FlatCapabilityValue | undefined,
  definition: SpecCapabilityDefinition
): CapabilityState | undefined {
  if (isCapabilityState(value)) {
    return value;
  }

  if (definition.kind === "boolean") {
    if (value === true) {
      return { status: "supported" };
    }

    if (value === false) {
      return { status: "unsupported" };
    }

    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  if (definition.unsupportedValues?.includes(value)) {
    return { status: "unsupported", reason: humanizeCapabilityValue(value) };
  }

  return { status: "supported", reason: humanizeCapabilityValue(value) };
}

function asFlatCapabilityValue(value: unknown): FlatCapabilityValue | undefined {
  if (isCapabilityState(value) || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  return undefined;
}

function isCapabilityState(value: unknown): value is CapabilityState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      typeof (value as { status?: unknown }).status === "string"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function humanizeCapabilityValue(value: string): string {
  return value.replace(/-/gu, " ").replace(/^./u, (first) => first.toUpperCase());
}

function toCapabilityLabel(status: CapabilityState["status"]): CapabilityBadgeViewModel["state"] {
  switch (status) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}
