import * as React from "react";

import { cn } from "../../lib/utils.js";

export function MetricGrid({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="metric-grid"
      className={cn(
        "grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
        className
      )}
      {...props}
    />
  );
}
