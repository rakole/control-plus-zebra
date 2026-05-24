import * as React from "react";

import { cn } from "../../lib/utils.js";

export interface MetadataItem {
  label: React.ReactNode;
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
          className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2"
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
