import * as React from "react";

import { type StatusTone } from "./status.js";
import { StatusBadge } from "./status-badge.js";

export interface SourceStateBadgeProps {
  label: string;
  title?: string | undefined;
  tone?: StatusTone | undefined;
  className?: string | undefined;
}

export function SourceStateBadge({
  label,
  title,
  tone = "neutral",
  className
}: SourceStateBadgeProps) {
  return (
    <StatusBadge tone={tone} className={className} title={title ?? label}>
      {label}
    </StatusBadge>
  );
}
