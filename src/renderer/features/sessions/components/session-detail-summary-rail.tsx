import { CapabilityBadge } from "../../../components/app/capability-badge.js";
import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { flattenSessionCapabilities, type SessionDetailView } from "../types.js";

interface SessionDetailSummaryRailProps {
  detail: SessionDetailView;
}

export function SessionDetailSummaryRail({ detail }: SessionDetailSummaryRailProps) {
  const session = detail.session;
  const capabilityGaps = flattenSessionCapabilities(session.capabilityGroups).filter(
    (badge) => badge.state !== "Supported"
  );

  return (
    <SectionCard
      aria-label="Session detail summary"
      title={session.title}
      description={session.adapterDisplayName}
      actions={<TruthStateBadge state={session.lifecycleState} />}
      contentClassName="space-y-4"
    >
      <MetadataGrid
        items={[
          { label: "Project", value: session.projectDisplayName ?? "Unknown" },
          { label: "Session ID", value: session.sessionId },
          { label: "Native Session ID", value: session.nativeSessionId ?? "Unknown" },
          { label: "Models", value: session.usageSummary.models.displayValue },
          { label: "Tokens", value: session.usageSummary.tokenCount.displayValue },
          {
            label: "Attention Reasons",
            value: session.attentionReasons.join(", ") || "None"
          }
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <TruthStateBadge state={session.verificationState} />
        <TruthStateBadge state={session.runAuditState} />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Capability Coverage</h3>
        <div className="flex flex-wrap gap-2">
          {(capabilityGaps.length > 0
            ? capabilityGaps
            : [{ key: "supported", label: "Capabilities", state: "Supported" as const }]
          ).map((badge) => (
            <div
              key={badge.key}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <span className="text-xs text-muted-foreground">{badge.label}</span>
              <CapabilityBadge
                label={badge.label}
                state={badge.state}
                {...(badge.reason ? { reason: badge.reason } : {})}
              />
            </div>
          ))}
        </div>
      </section>
    </SectionCard>
  );
}
