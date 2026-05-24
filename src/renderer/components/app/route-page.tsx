import * as React from "react";

import { cn } from "../../lib/utils.js";

export function RoutePage({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="route-page"
      className={cn(
        "flex min-w-0 flex-col gap-6 px-5 py-5 sm:px-8 sm:py-6",
        className
      )}
      {...props}
    />
  );
}
