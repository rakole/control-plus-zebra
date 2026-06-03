import * as React from "react";

import zebraLogoUrl from "../../assets/zebra-logo.png";
import { cn } from "../../lib/utils.js";

export interface WorkbenchBrandProps extends React.ComponentProps<"div"> {
  minimized?: boolean | undefined;
  showCaption?: boolean | undefined;
}

export function WorkbenchBrand({
  minimized = false,
  showCaption = true,
  className,
  ...props
}: WorkbenchBrandProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        minimized && "justify-center",
        className
      )}
      {...props}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[1.15rem] border border-border/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] shadow-[0_10px_24px_-18px_rgba(15,23,42,0.8)] ring-1 ring-white/70 dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(248,250,252,0.98),rgba(226,232,240,0.95))] dark:ring-white/5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1.5 top-1.5 h-2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.95),transparent_72%)] opacity-80"
        />
        <img
          alt="Ctr + Zebra logo"
          className="relative z-10 size-8 object-contain"
          src={zebraLogoUrl}
        />
      </span>
      {!minimized ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-[0.01em] text-foreground">
            Ctr + Zebra
          </p>
          {showCaption ? (
            <p className="truncate text-xs text-muted-foreground">Local agent evidence</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
