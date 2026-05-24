import * as React from "react";

import { cn } from "../../lib/utils.js";

export interface ToolbarProps extends React.ComponentProps<"div"> {
  ariaLabel?: string | undefined;
}

export function Toolbar({
  ariaLabel = "Toolbar",
  className,
  ...props
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      data-slot="toolbar"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
        className
      )}
      {...props}
    />
  );
}
