import * as React from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";

export interface TimelineEvidencePreviewProps {
  id: string;
  label: string;
  value: string;
  defaultExpanded?: boolean;
}

export function TimelineEvidencePreview({
  id,
  label,
  value,
  defaultExpanded = false
}: TimelineEvidencePreviewProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);
  const reactId = React.useId();
  const contentId = `${reactId}-${id}-timeline-evidence`;

  return (
    <div
      role="group"
      aria-label={label}
      className="mt-2 w-full overflow-hidden rounded-md border border-border bg-muted/20"
    >
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
        <p className="min-w-0 truncate text-[0.6875rem] font-medium uppercase text-muted-foreground">
          {label}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? "Show less" : "Show more"}
          {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      </div>
      <div
        id={contentId}
        className={cn(
          "relative border-t border-border bg-card",
          !isExpanded && "max-h-[5.5rem] overflow-hidden"
        )}
      >
        <pre className="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-[0.6875rem]/relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {value}
        </pre>
        {!isExpanded ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-card"
          />
        ) : null}
      </div>
    </div>
  );
}
