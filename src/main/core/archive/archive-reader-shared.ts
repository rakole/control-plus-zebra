import type { AdapterCapabilities, GroupedHarnessCapabilities } from "../adapter-contract/types.js";

export const ARCHIVE_READER_ADAPTER_ID = "archive-reader";

const archiveReaderCapabilityGroups = {
  discovery: {
    defaultRoots: false,
    projectRootMapping: "none",
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
    fileSearches: true,
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
    shellExitCodeEvidence: true,
    verificationCommandEvidence: true
  },
  export: {
    rawArtifactExport: true,
    normalizedExport: true
  }
} satisfies GroupedHarnessCapabilities;

export const archiveReaderCapabilities: AdapterCapabilities = archiveReaderCapabilityGroups;
