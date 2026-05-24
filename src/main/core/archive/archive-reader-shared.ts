import { capabilityState, type HarnessCapabilities } from "../model/capabilities.js";

export const ARCHIVE_READER_ADAPTER_ID = "archive-reader";

export const archiveReaderCapabilities: HarnessCapabilities = {
  sessionDiscovery: capabilityState(
    "unsupported",
    "Imported archives are hydrated at import time instead of using live discovery."
  ),
  liveSessionObservation: capabilityState(
    "unsupported",
    "Imported archives are persistent read-only snapshots."
  ),
  eventStreaming: capabilityState(
    "unsupported",
    "Imported archives do not stream live events."
  ),
  messageCapture: capabilityState(
    "supported",
    "Imported archives can render archived message evidence."
  ),
  toolCallCapture: capabilityState(
    "supported",
    "Imported archives can render archived tool-call evidence."
  ),
  shellCommandCapture: capabilityState(
    "supported",
    "Imported archives can render archived shell-command evidence."
  ),
  outputArtifactCapture: capabilityState(
    "supported",
    "Imported archives can surface archived output-artifact metadata."
  ),
  fileMutationCapture: capabilityState(
    "supported",
    "Imported archives can render archived file-mutation evidence."
  ),
  sourceValidation: capabilityState(
    "unsupported",
    "Imported archives are validated when they are opened and imported."
  ),
  watchPlans: capabilityState(
    "unsupported",
    "Imported archives never watch host filesystem state."
  ),
  gitContextCapture: capabilityState(
    "unsupported",
    "Imported archives never run host-side git inspection."
  ),
  githubContextCapture: capabilityState(
    "unsupported",
    "Imported archives never run host-side GitHub inspection."
  ),
  verificationSignals: capabilityState(
    "unknown",
    "Verification states are rendered from archived derived data when available."
  )
};
