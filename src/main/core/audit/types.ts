import type { ConfidenceScore } from "../model/confidence.js";

export type CompletionClaimStatus = "claimed" | "not-claimed" | "unknown";

export interface CompletionClaim {
  status: CompletionClaimStatus;
  claimedAt?: string;
  messageId?: string;
  postClaimEventIds: string[];
}

export type RunAuditStatus =
  | "active"
  | "cancelled"
  | "verification-failed"
  | "incomplete"
  | "needs-review"
  | "clean"
  | "unknown";

export type AttentionReasonCode =
  | "failed-verification"
  | "no-verification"
  | "pending-tool-calls"
  | "post-claim-activity"
  | "dirty-after-claim"
  | "missing-sidecar"
  | "parser-warning"
  | "capability-missing"
  | "claim-uncertain";

export interface RunAuditResult {
  status: RunAuditStatus;
  attentionReasons: AttentionReasonCode[];
  confidence: ConfidenceScore;
  completionClaim: CompletionClaimStatus;
  supportingCommandIds: string[];
  supportingToolCallIds: string[];
  supportingMessageIds: string[];
  diagnosticIds?: string[];
}
