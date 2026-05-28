import type { SessionSummary } from "./types.js";

export interface VisibleSessionKpiSummary {
  visibleSessions: number;
  needsReview: number;
  failedCommands: number;
  notVerifiedOrNotRun: number;
  filesChanged: number;
  activeNow: number;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function getMetricNumericValue(
  metric:
    | SessionSummary["triageMetrics"]["failedCommands"]
    | SessionSummary["triageMetrics"]["fileMutations"]
): number {
  if (typeof metric.numericValue === "number" && Number.isFinite(metric.numericValue)) {
    return metric.numericValue;
  }

  const parsed = Number.parseInt(metric.displayValue, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSortTimestamp(session: SessionSummary): number {
  const endedAt = Date.parse(session.endedAt ?? "");
  const startedAt = Date.parse(session.startedAt ?? "");
  const latest = Math.max(
    Number.isFinite(endedAt) ? endedAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(startedAt) ? startedAt : Number.NEGATIVE_INFINITY
  );

  return Number.isFinite(latest) ? latest : 0;
}

function isVerificationFailure(session: SessionSummary): boolean {
  return normalizeLabel(session.verificationState.label) === "failed";
}

function isVerificationUnverified(session: SessionSummary): boolean {
  const label = normalizeLabel(session.verificationState.label);
  return label === "not run" || label === "unknown" || label === "unsupported";
}

function isRunAuditReviewState(session: SessionSummary): boolean {
  const label = normalizeLabel(session.runAuditState.label);
  return label === "needs review" || label === "incomplete";
}

function isSessionNeedingReview(session: SessionSummary): boolean {
  return getSessionRiskRank(session) < 6;
}

function toSentenceFragment(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function getSessionRiskRank(session: SessionSummary): number {
  if (session.lifecycleStatus === "active") {
    return 0;
  }

  if (
    getMetricNumericValue(session.triageMetrics.failedCommands) > 0 ||
    isVerificationFailure(session) ||
    normalizeLabel(session.runAuditState.label) === "failed verification"
  ) {
    return 1;
  }

  if (
    session.lifecycleStatus === "cancelled" ||
    normalizeLabel(session.runAuditState.label) === "cancelled"
  ) {
    return 2;
  }

  if (isRunAuditReviewState(session) || session.attentionReasons.length > 0) {
    return 3;
  }

  if (normalizeLabel(session.verificationState.label) === "not run") {
    return 4;
  }

  if (
    isVerificationUnverified(session) ||
    normalizeLabel(session.runAuditState.label) === "unknown" ||
    session.lifecycleStatus === "unknown"
  ) {
    return 5;
  }

  return 6;
}

export function compareSessionsByRiskThenNewest(
  left: SessionSummary,
  right: SessionSummary
): number {
  const riskDifference = getSessionRiskRank(left) - getSessionRiskRank(right);

  if (riskDifference !== 0) {
    return riskDifference;
  }

  const timestampDifference = getSortTimestamp(right) - getSortTimestamp(left);

  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.sessionId.localeCompare(right.sessionId);
}

export function getSessionReason(session: SessionSummary): string {
  if (session.lifecycleStatus === "active") {
    return "Session still active";
  }

  const failedCommands = getMetricNumericValue(session.triageMetrics.failedCommands);

  if (failedCommands > 0) {
    return `${failedCommands} failed command${failedCommands === 1 ? "" : "s"} recorded`;
  }

  const primaryAttentionReason = session.attentionReasons[0];

  if (primaryAttentionReason) {
    return toSentenceFragment(primaryAttentionReason);
  }

  if (normalizeLabel(session.verificationState.label) !== "passed") {
    return `Verification ${toSentenceFragment(session.verificationState.label)}`;
  }

  if (normalizeLabel(session.runAuditState.label) !== "clean") {
    return `Run audit ${toSentenceFragment(session.runAuditState.label)}`;
  }

  return `Lifecycle ${toSentenceFragment(session.lifecycleState.label)}`;
}

export function getSessionPrimaryVerdict(
  session: SessionSummary
): SessionSummary["runAuditState"] {
  switch (getSessionRiskRank(session)) {
    case 0:
      return session.lifecycleState;
    case 1:
      if (isVerificationFailure(session)) {
        return session.verificationState;
      }

      return session.runAuditState;
    case 2:
      return normalizeLabel(session.runAuditState.label) === "cancelled"
        ? session.runAuditState
        : session.lifecycleState;
    case 3:
      return session.runAuditState;
    case 4:
    case 5:
      return session.verificationState;
    default:
      return normalizeLabel(session.runAuditState.label) === "clean"
        ? session.runAuditState
        : session.verificationState;
  }
}

export function summarizeVisibleSessionKpis(
  sessions: SessionSummary[]
): VisibleSessionKpiSummary {
  return sessions.reduce<VisibleSessionKpiSummary>(
    (summary, session) => {
      summary.visibleSessions += 1;
      summary.failedCommands += getMetricNumericValue(session.triageMetrics.failedCommands);
      summary.filesChanged += getMetricNumericValue(session.triageMetrics.fileMutations);

      if (isSessionNeedingReview(session)) {
        summary.needsReview += 1;
      }

      if (isVerificationUnverified(session) || normalizeLabel(session.verificationState.label) === "not run") {
        summary.notVerifiedOrNotRun += 1;
      }

      if (session.lifecycleStatus === "active") {
        summary.activeNow += 1;
      }

      return summary;
    },
    {
      visibleSessions: 0,
      needsReview: 0,
      failedCommands: 0,
      notVerifiedOrNotRun: 0,
      filesChanged: 0,
      activeNow: 0
    }
  );
}
