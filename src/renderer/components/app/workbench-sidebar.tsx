import * as React from "react";
import { PanelsTopLeftIcon } from "lucide-react";

import { Separator } from "../ui/separator.js";
import { cn } from "../../lib/utils.js";

export interface WorkbenchSidebarProps extends React.ComponentProps<"aside"> {
  header?: React.ReactNode;
  navigation: React.ReactNode;
  footer?: React.ReactNode;
}

export function WorkbenchSidebar({
  header,
  navigation,
  footer,
  className,
  ...props
}: WorkbenchSidebarProps) {
  return (
    <aside
      data-slot="workbench-sidebar"
      className={cn(
        "flex min-h-full flex-col gap-4 border-r border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-3">
        {header ?? (
          <>
            <span className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <PanelsTopLeftIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Agent Workbench</p>
              <p className="text-xs text-muted-foreground">
                Local agent evidence
              </p>
            </div>
          </>
        )}
      </div>
      <Separator className="bg-sidebar-border/70" />
      <div className="min-h-0 flex-1">{navigation}</div>
      {footer ? (
        <>
          <Separator className="bg-sidebar-border/70" />
          <div>{footer}</div>
        </>
      ) : null}
    </aside>
  );
}
