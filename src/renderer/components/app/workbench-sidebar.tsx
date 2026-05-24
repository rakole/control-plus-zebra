import * as React from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PanelsTopLeftIcon } from "lucide-react";

import { Separator } from "../ui/separator.js";
import { cn } from "../../lib/utils.js";

export interface WorkbenchSidebarProps extends React.ComponentProps<"aside"> {
  header?: React.ReactNode;
  navigation: React.ReactNode;
  footer?: React.ReactNode;
  minimized?: boolean | undefined;
  onMinimizedChange?: ((minimized: boolean) => void) | undefined;
}

export function WorkbenchSidebar({
  header,
  navigation,
  footer,
  minimized = false,
  onMinimizedChange,
  className,
  ...props
}: WorkbenchSidebarProps) {
  const toggleLabel = minimized ? "Expand menu" : "Minimise menu";

  return (
    <aside
      data-slot="workbench-sidebar"
      data-state={minimized ? "minimized" : "expanded"}
      className={cn(
        "flex min-h-full flex-col gap-4 border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground transition-[padding] duration-300",
        minimized ? "px-2" : "px-4",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "flex items-center gap-3",
          minimized ? "flex-col" : "justify-between"
        )}
      >
        {header ?? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-3",
              minimized && "justify-center"
            )}
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <PanelsTopLeftIcon className="size-4" />
            </span>
            <div className={cn("min-w-0", minimized && "sr-only")}>
              <p className="text-sm font-semibold">Agent Workbench</p>
              <p className="text-xs text-muted-foreground">
                Local agent evidence
              </p>
            </div>
          </div>
        )}
        {onMinimizedChange ? (
          <button
            type="button"
            aria-label={toggleLabel}
            title={toggleLabel}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border/70 text-sidebar-foreground/70 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
            onClick={() => {
              onMinimizedChange(!minimized);
            }}
          >
            {minimized ? (
              <PanelLeftOpenIcon aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftCloseIcon aria-hidden="true" className="size-4" />
            )}
          </button>
        ) : null}
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
