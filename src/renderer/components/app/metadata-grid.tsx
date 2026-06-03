import * as React from "react";

import { cn } from "../../lib/utils.js";

type MetadataTone = "danger" | "info" | "neutral" | "positive" | "warning";

export interface MetadataItem {
  label: React.ReactNode;
  tone?: MetadataTone;
  value: React.ReactNode;
}

export interface MetadataGridProps extends React.ComponentProps<"section"> {
  title?: string | undefined;
  items: MetadataItem[];
}

export function MetadataGrid({
  title,
  items,
  className,
  ...props
}: MetadataGridProps) {
  const content = (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item, index) => (
        <div
          key={typeof item.label === "string" ? item.label : index}
          className={cn(
            "space-y-1 rounded-md border px-3 py-2",
            getMetadataToneClassName(item.tone)
          )}
        >
          <dt className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
            {item.label}
          </dt>
          <dd className="break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );

  if (!title) {
    return <div className={className}>{content}</div>;
  }

  return (
    <section
      aria-label={title}
      className={cn("space-y-3", className)}
      {...props}
    >
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {content}
    </section>
  );
}

function getMetadataToneClassName(tone?: MetadataTone): string {
  switch (tone) {
    case "danger":
      return "border-red-500/40 bg-red-500/8";
    case "warning":
      return "border-amber-500/40 bg-amber-500/8";
    case "positive":
      return "border-emerald-500/40 bg-emerald-500/8";
    case "info":
      return "border-sky-500/40 bg-sky-500/8";
    case "neutral":
    default:
      return "border-border bg-muted/20";
  }
}
