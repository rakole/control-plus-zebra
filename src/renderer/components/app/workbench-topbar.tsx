import * as React from "react";

import { cn } from "../../lib/utils.js";

export interface WorkbenchTopbarProps
  extends Omit<React.ComponentProps<"header">, "title"> {
  title?: React.ReactNode;
  detail?: React.ReactNode;
  actions?: React.ReactNode;
}

export function WorkbenchTopbar({
  title,
  detail,
  actions,
  className,
  children,
  ...props
}: WorkbenchTopbarProps) {
  return (
    <header
      data-slot="workbench-topbar"
      className={cn(
        "flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background px-5 py-3 sm:px-6",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <div className="min-w-0">
            {title ? (
              <p className="truncate text-sm font-medium text-foreground">{title}</p>
            ) : null}
            {detail ? (
              <p className="truncate text-xs text-muted-foreground">{detail}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </>
      )}
    </header>
  );
}
