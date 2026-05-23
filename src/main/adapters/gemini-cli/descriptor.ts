import { capabilityState, type HarnessCapabilities } from "../../core/model/capabilities.js";
import type { HarnessDescriptor } from "../../core/adapter-contract/session-source-adapter.js";

export const geminiCliCapabilities: HarnessCapabilities = {
  sessionDiscovery: capabilityState("supported"),
  liveSessionObservation: capabilityState(
    "unsupported",
    "The Phase 4 adapter scans local Gemini artifacts but does not stream live sessions."
  ),
  eventStreaming: capabilityState(
    "unsupported",
    "Gemini CLI evidence is parsed from persisted artifacts rather than a live event stream."
  ),
  messageCapture: capabilityState("supported"),
  toolCallCapture: capabilityState("supported"),
  shellCommandCapture: capabilityState("supported"),
  outputArtifactCapture: capabilityState("supported"),
  fileMutationCapture: capabilityState("supported"),
  sourceValidation: capabilityState("supported"),
  watchPlans: capabilityState(
    "unsupported",
    "Phase 4 does not model adapter-owned watch plans yet."
  ),
  gitContextCapture: capabilityState(
    "unsupported",
    "Phase 4 does not infer git context from Gemini CLI evidence."
  ),
  githubContextCapture: capabilityState(
    "unsupported",
    "Phase 4 does not infer GitHub context from Gemini CLI evidence."
  ),
  verificationSignals: capabilityState(
    "unknown",
    "The adapter captures evidence only; shared core derives verification later."
  )
};

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
