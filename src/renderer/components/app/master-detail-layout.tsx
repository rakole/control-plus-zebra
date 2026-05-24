import * as React from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "../ui/resizable.js";
import { cn } from "../../lib/utils.js";

export interface MasterDetailLayoutProps extends React.ComponentProps<"div"> {
  masterLabel: string;
  detailLabel: string;
  master: React.ReactNode;
  detail: React.ReactNode;
  defaultMasterSize?: string | undefined;
}

export function MasterDetailLayout({
  masterLabel,
  detailLabel,
  master,
  detail,
  defaultMasterSize = "38%",
  className,
  ...props
}: MasterDetailLayoutProps) {
  const supportsResizablePanels =
    typeof window !== "undefined" &&
    typeof window.ResizeObserver === "function";

  if (!supportsResizablePanels) {
    return (
      <div
        data-slot="master-detail-layout"
        className={cn("grid min-h-[24rem] gap-4 lg:grid-cols-[minmax(16rem,38%)_minmax(0,1fr)]", className)}
        {...props}
      >
        <section
          aria-label={masterLabel}
          className="min-h-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
        >
          {master}
        </section>
        <section
          aria-label={detailLabel}
          className="min-h-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
        >
          {detail}
        </section>
      </div>
    );
  }

  return (
    <div
      data-slot="master-detail-layout"
      className={cn("min-h-0", className)}
      {...props}
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-[24rem]">
        <ResizablePanel defaultSize={defaultMasterSize} minSize="24%">
          <section
            aria-label={masterLabel}
            className="h-full min-h-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
          >
            {master}
          </section>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel minSize="30%">
          <section
            aria-label={detailLabel}
            className="h-full min-h-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
          >
            {detail}
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
