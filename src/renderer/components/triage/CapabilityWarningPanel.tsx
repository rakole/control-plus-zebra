import { CapabilityBadge } from "../CapabilityBadge.js";

interface CapabilityBadgeView {
  key: string;
  label: string;
  state: "Supported" | "Unsupported" | "Unknown";
  reason?: string | undefined;
}

interface CapabilityWarningPanelProps {
  badges: CapabilityBadgeView[];
  emptyLabel?: string;
}

export function CapabilityWarningPanel({
  badges,
  emptyLabel = "No capability warnings"
}: CapabilityWarningPanelProps) {
  const warnings = badges.filter((badge) => badge.state !== "Supported");

  if (warnings.length === 0) {
    return (
      <div className="capability-panel">
        <p className="triage-note">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="capability-panel">
      {warnings.map((badge) => (
        <div className="capability-row" key={badge.key}>
          <span>{badge.label}</span>
          <CapabilityBadge
            label={badge.label}
            state={badge.state}
            {...(badge.reason ? { reason: badge.reason } : {})}
          />
        </div>
      ))}
    </div>
  );
}
