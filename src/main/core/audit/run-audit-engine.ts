import {
  HIGH_CONFIDENCE,
  LOW_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  type ConfidenceScore
} from "../model/confidence.js";
import type { CapabilityEnvelope } from "../model/capabilities.js";
import type {
  FileMutationEvidence,
  Session,
  SessionEvent,
  SessionMessage,
  ToolCall
} from "../model/entities.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { ProjectGitSnapshot } from "../git/git-snapshot-provider.js";
import type { ParsedShellCommand } from "../shell/types.js";
import type { VerificationResult } from "../verification/types.js";

import { deriveCompletionClaim } from "./claim-completion.js";
import type { AttentionReasonCode, RunAuditResult, RunAuditStatus } from "./types.js";

export function deriveRunAuditForSession(args: {
  adapterCapabilities: CapabilityEnvelope;
  diagnostics: Diagnostic[];
  parsedShellCommands: ParsedShellCommand[];
  projectGitSnapshot?: ProjectGitSnapshot;
  session: Session;
  sessionCapabilities?: CapabilityEnvelope;
  sessionEvents: SessionEvent[];
  sessionFileMutations: FileMutationEvidence[];
  sessionMessages: SessionMessage[];
  sessionToolCalls: ToolCall[];
  sourceCapabilities?: CapabilityEnvelope;
  verification: VerificationResult;
}): RunAuditResult {
  const completionClaim = deriveCompletionClaim({
    session: args.session,
    sessionEvents: args.sessionEvents,
    sessionMessages: args.sessionMessages
  });
  const attentionReasons = new Set<AttentionReasonCode>();
  const pendingToolCalls = args.sessionToolCalls.filter(
    (toolCall) => toolCall.statusNormalized === "pending"
  );

  if (args.verification.status === "failed") {
    attentionReasons.add("failed-verification");
  }

  if (args.verification.status === "not-run") {
    attentionReasons.add("no-verification");
  }

  if (pendingToolCalls.length > 0) {
    attentionReasons.add("pending-tool-calls");
  }

  if (completionClaim.postClaimEventIds.length > 0) {
    attentionReasons.add("post-claim-activity");
  }

  if (completionClaim.status === "unknown") {
    attentionReasons.add("claim-uncertain");
  }

  if (hasDirtyProjectStateAfterClaim(completionClaim.status, args.projectGitSnapshot)) {
    attentionReasons.add("dirty-after-claim");
  }

  if (
    isVerificationCapabilityBlocked(args.verification) ||
    isSharedGitAssessmentUnavailable(completionClaim.status, args.projectGitSnapshot)
  ) {
    attentionReasons.add("capability-missing");
  }

  if (args.diagnostics.some((diagnostic) => diagnostic.severity !== "info")) {
    attentionReasons.add("parser-warning");
  }

  if (args.diagnostics.some((diagnostic) => isMissingSidecarDiagnostic(diagnostic.code))) {
    attentionReasons.add("missing-sidecar");
  }

  const status = deriveStatus({
    attentionReasons,
    completionClaimStatus: completionClaim.status,
    hasPendingToolCalls: pendingToolCalls.length > 0,
    hasPostClaimActivity: completionClaim.postClaimEventIds.length > 0,
    sessionLifecycleState: args.session.lifecycleStatus,
    verificationStatus: args.verification.status
  });
  const diagnosticIds = dedupeStrings(args.diagnostics.map((diagnostic) => diagnostic.id));
  const supportingMessageIds = completionClaim.messageId ? [completionClaim.messageId] : [];

  return {
    status,
    attentionReasons: [...attentionReasons],
    confidence: deriveAuditConfidence(status, attentionReasons),
    completionClaim: completionClaim.status,
    supportingCommandIds: args.verification.commandIds,
    supportingToolCallIds: pendingToolCalls.map((toolCall) => toolCall.id),
    supportingMessageIds,
    ...(diagnosticIds.length > 0 ? { diagnosticIds } : {})
  };
}

function deriveStatus(args: {
  attentionReasons: Set<AttentionReasonCode>;
  completionClaimStatus: "claimed" | "not-claimed" | "unknown";
  hasPendingToolCalls: boolean;
  hasPostClaimActivity: boolean;
  sessionLifecycleState: Session["lifecycleStatus"];
  verificationStatus: VerificationResult["status"];
}): RunAuditStatus {
  if (args.sessionLifecycleState === "active") {
    return "active";
  }

  if (args.sessionLifecycleState === "cancelled") {
    return "cancelled";
  }

  if (args.verificationStatus === "failed") {
    return "verification-failed";
  }

  if (
    args.completionClaimStatus === "claimed" &&
    (args.hasPendingToolCalls || args.hasPostClaimActivity)
  ) {
    return "incomplete";
  }

  if (args.sessionLifecycleState === "unknown" && args.verificationStatus === "unknown") {
    return "unknown";
  }

  if (
    args.attentionReasons.size > 0 &&
    !(
      args.attentionReasons.size === 1 &&
      args.attentionReasons.has("failed-verification")
    )
  ) {
    return "needs-review";
  }

  if (args.verificationStatus === "passed" && args.attentionReasons.size === 0) {
    return "clean";
  }

  return "unknown";
}

function deriveAuditConfidence(
  status: RunAuditStatus,
  attentionReasons: Set<AttentionReasonCode>
): ConfidenceScore {
  if (status === "clean") {
    return HIGH_CONFIDENCE;
  }

  if (status === "unknown") {
    return LOW_CONFIDENCE;
  }

  if (attentionReasons.size > 0) {
    return MEDIUM_CONFIDENCE;
  }

  return HIGH_CONFIDENCE;
}

function isVerificationCapabilityBlocked(verification: VerificationResult) {
  if (verification.status === "unsupported") {
    return true;
  }

  return verification.reasonCodes.some(
    (reasonCode) => reasonCode === "capability-unsupported" || reasonCode === "capability-unknown"
  );
}

function hasDirtyProjectStateAfterClaim(
  completionClaimStatus: "claimed" | "not-claimed" | "unknown",
  projectGitSnapshot?: ProjectGitSnapshot
): boolean {
  if (completionClaimStatus !== "claimed" || projectGitSnapshot?.status !== "available") {
    return false;
  }

  return Boolean(
    projectGitSnapshot.snapshot &&
      (projectGitSnapshot.snapshot.dirty || projectGitSnapshot.snapshot.untrackedFiles > 0)
  );
}

function isSharedGitAssessmentUnavailable(
  completionClaimStatus: "claimed" | "not-claimed" | "unknown",
  projectGitSnapshot?: ProjectGitSnapshot
): boolean {
  if (completionClaimStatus !== "claimed") {
    return false;
  }

  return projectGitSnapshot?.status !== "available";
}

function isMissingSidecarDiagnostic(code: string): boolean {
  return code.includes("missing-sidecar") || code.startsWith("shell.output-artifact.");
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
