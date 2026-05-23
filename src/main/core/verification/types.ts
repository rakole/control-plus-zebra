import type { CapabilityState } from "../model/capabilities.js";
import type { ConfidenceScore } from "../model/confidence.js";
import type { ParsedShellCommand } from "../shell/types.js";

export type VerificationIntent = "test" | "build" | "typecheck" | "lint";

export type VerificationIntentStatus = "passed" | "failed" | "unknown";

export type VerificationStatus = "passed" | "failed" | "not-run" | "unknown" | "unsupported";

export type VerificationReasonCode =
  | "capability-unknown"
  | "capability-unsupported"
  | "no-qualifying-commands"
  | "output-missing"
  | "parser-warning";

export interface VerificationIntentResult {
  intent: VerificationIntent;
  latestCommandId: string;
  latestStatus: VerificationIntentStatus;
  commandIds: string[];
  confidence: ConfidenceScore;
  diagnosticIds?: string[];
}

export interface VerificationResult {
  status: VerificationStatus;
  confidence: ConfidenceScore;
  commandIds: string[];
  intentResults: VerificationIntentResult[];
  reasonCodes: VerificationReasonCode[];
  diagnosticIds?: string[];
}

export interface VerificationCapabilityContext {
  adapter: CapabilityState;
  session?: CapabilityState;
  source?: CapabilityState;
}

export interface VerificationSessionContext {
  completedWithAssistantResponse: boolean;
  parsedShellCommands: ParsedShellCommand[];
  shellCapability: VerificationCapabilityContext;
}
