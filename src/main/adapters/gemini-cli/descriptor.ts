import type {
  AdapterCapabilities,
  GroupedHarnessCapabilities
} from "../../core/adapter-contract/types.js";
import type { HarnessDescriptor } from "../../core/adapter-contract/session-source-adapter.js";

const geminiCliCapabilityGroups = {
  discovery: {
    defaultRoots: true,
    projectRootMapping: "native",
    stableProjectId: true,
    stableSessionId: true
  },
  replay: {
    transcriptReplay: true,
    messageRoles: true,
    assistantMessages: true,
    lifecycleEvents: true,
    cancellationEvents: true,
    topicEvents: true,
    rawEventPointers: true
  },
  tools: {
    toolCalls: true,
    toolResults: true,
    fileReads: true,
    fileSearches: false,
    fileMutations: true,
    diffStats: false,
    shellCommands: true,
    shellOutputs: true,
    sidecarOutputs: true
  },
  usage: {
    modelNames: true,
    tokenCounts: true,
    costEstimates: false
  },
  live: {
    activeSessionDetection: "none",
    watchableArtifacts: false,
    incrementalParsing: false
  },
  audit: {
    agentClaimDetection: true,
    finalAnswerDetection: true,
    shellExitCodeEvidence: false,
    verificationCommandEvidence: true
  },
  export: {
    rawArtifactExport: true,
    normalizedExport: true
  }
} satisfies GroupedHarnessCapabilities;

export const geminiCliCapabilities: AdapterCapabilities = geminiCliCapabilityGroups;

export const geminiCliDescriptor: HarnessDescriptor = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  vendor: "Google",
  adapterVersion: "0.1.0",
  parserVersion: "0.1.0",
  supportedPlatforms: ["darwin", "linux", "win32"],
  defaultRoots: [
    {
      path: "~/.gemini/tmp",
      label: "Gemini CLI temp root",
      kind: "directory"
    }
  ],
  capabilities: geminiCliCapabilities
};
