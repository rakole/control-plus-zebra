import * as React from "react";

import { cn } from "../../lib/utils.js";
import { GradientDots } from "./gradient-dots.js";
import { WorkbenchSidebar } from "./workbench-sidebar.js";

export interface WorkbenchShellProps extends React.ComponentProps<"div"> {
  navigation: React.ReactNode;
  topbar?: React.ReactNode;
  sidebarHeader?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  sidebarMinimized?: boolean | undefined;
  onSidebarMinimizedChange?: ((minimized: boolean) => void) | undefined;
  mainClassName?: string;
}

export function WorkbenchShell({
  navigation,
  topbar,
  sidebarHeader,
  sidebarFooter,
  sidebarMinimized = false,
  onSidebarMinimizedChange,
  mainClassName,
  className,
  children,
  ...props
}: WorkbenchShellProps) {
  return (
    <div
      data-slot="workbench-shell"
      className={cn(
        "grid min-h-screen bg-background text-foreground transition-[grid-template-columns] duration-300 md:grid-cols-[18rem_minmax(0,1fr)]",
        sidebarMinimized && "md:grid-cols-[5rem_minmax(0,1fr)]",
        className
      )}
      {...props}
    >
      <WorkbenchSidebar
        navigation={navigation}
        header={sidebarHeader}
        footer={sidebarFooter}
        minimized={sidebarMinimized}
        onMinimizedChange={onSidebarMinimizedChange}
      />
      <div className="relative flex min-w-0 flex-col overflow-hidden">
        <GradientDots
          className="pointer-events-none opacity-20 [mask-image:radial-gradient(circle_at_top,black_0%,transparent_72%)]"
          dotSize={6}
          spacing={12}
          duration={36}
          colorCycleDuration={10}
        />
        {topbar}
        <main className={cn("relative z-10 min-w-0 flex-1", mainClassName)}>{children}</main>
      </div>
    </div>
  );
}
