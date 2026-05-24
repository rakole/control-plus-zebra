import * as React from "react";

import { cn } from "../../lib/utils.js";

export function PageActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-actions"
      className={cn(
        "flex flex-wrap items-center justify-start gap-2 sm:justify-end",
        className
      )}
      {...props}
    />
  );
}
