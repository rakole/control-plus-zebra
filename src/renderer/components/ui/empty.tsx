import * as React from "react";

import { cn } from "../../lib/utils.js";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center text-foreground",
        className
      )}
      {...props}
    />
  );
}

function EmptyVisual({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-visual"
      className={cn(
        "flex size-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="empty-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("max-w-prose text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function EmptyActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-actions"
      className={cn("flex flex-wrap items-center justify-center gap-2", className)}
      {...props}
    />
  );
}

export { Empty, EmptyActions, EmptyDescription, EmptyTitle, EmptyVisual };
