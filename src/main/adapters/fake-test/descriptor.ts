import { capabilityState, type HarnessCapabilities } from "../../core/model/capabilities.js";
import type { HarnessDescriptor } from "../../core/adapter-contract/session-source-adapter.js";

export const fakeTestCapabilities: HarnessCapabilities = {
  sessionDiscovery: capabilityState("supported"),
  liveSessionObservation: capabilityState(
    "unsupported",
    "The Phase 1 fixture is static and has no live session feed."
  ),
  eventStreaming: capabilityState(
    "unsupported",
    "The Phase 1 fixture is parsed from a single JSON artifact."
  ),
  messageCapture: capabilityState("supported"),
  toolCallCapture: capabilityState("supported"),
  shellCommandCapture: capabilityState("supported"),
  outputArtifactCapture: capabilityState("supported"),
  fileMutationCapture: capabilityState("supported"),
  sourceValidation: capabilityState("supported"),
  watchPlans: capabilityState(
    "unsupported",
    "Phase 1 does not model adapter-owned watch plans yet."
  ),
  gitContextCapture: capabilityState(
    "unsupported",
    "The fake fixture does not include git evidence."
  ),
  githubContextCapture: capabilityState(
    "unsupported",
    "The fake fixture does not include GitHub evidence."
  ),
  verificationSignals: capabilityState(
    "unknown",
    "The adapter emits shell evidence only; shared core derives verification later."
  )
};

export const fakeTestDescriptor: HarnessDescriptor = {
  id: "fake-test",
  displayName: "Fake Test Harness",
  vendor: "Agent Workbench",
  adapterVersion: "0.1.0",
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
