import type { AdapterCapabilities, GroupedHarnessCapabilities } from "../../core/adapter-contract/types.js";
import type { HarnessDescriptor } from "../../core/adapter-contract/session-source-adapter.js";

const fakeTestCapabilityGroups = {
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
    topicEvents: false,
    rawEventPointers: true
  },
  tools: {
    toolCalls: true,
    toolResults: true,
    fileReads: false,
    fileSearches: false,
    fileMutations: true,
    diffStats: false,
    shellCommands: true,
    shellOutputs: true,
    sidecarOutputs: true
  },
  usage: {
    modelNames: false,
    tokenCounts: false,
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

export const fakeTestCapabilities: AdapterCapabilities = fakeTestCapabilityGroups;

export const fakeTestDescriptor: HarnessDescriptor = {
  id: "fake-test",
  displayName: "Fake Test Harness",
  vendor: "Agent Workbench",
  adapterVersion: "0.1.0",
  parserVersion: "0.1.0",
  supportedPlatforms: ["darwin", "linux", "win32"],
  defaultRoots: [
    {
      path: "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json",
      label: "Phase 1 fake harness fixture",
      kind: "file"
    }
  ],
  capabilities: fakeTestCapabilities
};
