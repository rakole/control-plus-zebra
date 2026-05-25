import * as React from "react";

import { type TruthBadgeTone, mapTruthBadgeTone } from "./status.js";
import { StatusBadge } from "./status-badge.js";

export interface TruthStateView {
  label: string;
  tone: TruthBadgeTone;
  reason?: string | undefined;
}

export interface TruthStateBadgeProps {
  state: TruthStateView;
  className?: string | undefined;
  tooltip?: string | undefined;
}

export function TruthStateBadge({
  state,
  className,
  tooltip
}: TruthStateBadgeProps) {
  return (
    <StatusBadge
      tone={mapTruthBadgeTone(state.tone)}
      className={className}
      title={tooltip ?? state.reason ?? state.label}
      aria-label={state.label}
    >
      {state.label}
    </StatusBadge>
  );
}
