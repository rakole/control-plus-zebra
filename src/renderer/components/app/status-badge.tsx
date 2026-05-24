import * as React from "react";

import { Badge } from "../ui/badge.js";
import { cn } from "../../lib/utils.js";
import { type StatusTone, statusToneClassNames } from "./status.js";

export interface StatusBadgeProps
  extends Omit<React.ComponentProps<typeof Badge>, "variant"> {
  tone: StatusTone;
}

export function StatusBadge({
  tone,
  className,
  ...props
}: StatusBadgeProps) {
  const toneClassNames = {
    neutral: statusToneClassNames.neutral,
    success: statusToneClassNames.success,
    warning: statusToneClassNames.warning,
    danger: statusToneClassNames.danger,
    info: statusToneClassNames.info,
    unsupported: statusToneClassNames.unsupported,
    destructive: statusToneClassNames.destructive
  } satisfies Record<StatusTone, string>;

  return (
    <Badge
      variant="outline"
      className={cn(
        "border px-2 py-0.5 font-medium shadow-none",
        toneClassNames[tone],
        className
      )}
      {...props}
    />
  );
}
