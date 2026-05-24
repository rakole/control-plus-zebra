import { CapabilityWarningPanel } from "./CapabilityWarningPanel.js";
import { TruthStateBadge } from "./TruthStateBadge.js";

type DetailResponse = Awaited<ReturnType<Window["agentWorkbench"]["getSessionDetail"]>>;
type SessionDetailView = NonNullable<Extract<DetailResponse, { ok: true }>["detail"]>;

interface SessionDetailSummaryRailProps {
  detail: SessionDetailView;
}

export function SessionDetailSummaryRail({ detail }: SessionDetailSummaryRailProps) {
  const session = detail.session;

  return (
    <aside className="triage-panel summary-rail" aria-label="Session detail summary">
      <div className="panel-header">
        <div>
          <p className="route-kicker">{session.adapterDisplayName}</p>
          <h2>{session.title}</h2>
        </div>
        <TruthStateBadge state={session.lifecycleState} />
      </div>

      <dl className="detail-meta-grid">
        <div>
          <dt>Project</dt>
          <dd>{session.projectName ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Session ID</dt>
          <dd>{session.sessionId}</dd>
        </div>
        <div>
          <dt>Native Session ID</dt>
          <dd>{session.nativeSessionId ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Attention Reasons</dt>
          <dd>{session.attentionReasons.join(", ") || "None"}</dd>
        </div>
      </dl>

      <div className="state-row">
        <div>
          <span className="triage-note">Verification</span>
          <TruthStateBadge state={session.verificationState} />
        </div>
        <div>
          <span className="triage-note">Run Audit</span>
          <TruthStateBadge state={session.runAuditState} />
        </div>
      </div>

      <section className="preview-section" aria-labelledby="detail-capabilities">
        <h3 id="detail-capabilities">Capability Warnings</h3>
        <CapabilityWarningPanel badges={session.capabilityBadges} />
      </section>
    </aside>
  );
}
