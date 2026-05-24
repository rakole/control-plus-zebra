import * as React from "react";

import { StatusBadge } from "./status-badge.js";

export type CapabilityState = "Supported" | "Unsupported" | "Unknown";

export interface CapabilityBadgeProps {
  label?: string | undefined;
  state: CapabilityState;
  reason?: string | undefined;
  className?: string | undefined;
}

const capabilityToneByState = {
  Supported: "success",
  Unsupported: "unsupported",
  Unknown: "neutral"
} as const;

export function CapabilityBadge({
  label,
  state,
  reason,
  className
}: CapabilityBadgeProps) {
  return (
    <StatusBadge
      tone={capabilityToneByState[state]}
      className={className}
      title={reason ?? label ?? state}
      aria-label={label ? `${label}: ${state}` : state}
    >
      {state}
    </StatusBadge>
  );
}
