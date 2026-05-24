import * as React from "react";

import { Skeleton } from "../ui/skeleton.js";
import { Spinner } from "../ui/spinner.js";

export interface LoadingStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
}

export function LoadingState({
  title,
  description
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card px-4 py-4 text-card-foreground"
    >
      <div className="flex items-start gap-3">
        <Spinner size="lg" className="mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          {description ? (
            <p className="text-xs/relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
