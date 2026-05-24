import * as React from "react";

import { ScrollArea } from "../ui/scroll-area.js";
import { StatusBadge } from "./status-badge.js";
import { type StatusTone } from "./status.js";

export interface TimelineItem {
  id: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  timestamp?: React.ReactNode;
  description?: React.ReactNode;
  metadata?: Array<{
    label: React.ReactNode;
    value: React.ReactNode;
  }>;
  tone?: StatusTone | undefined;
}

export interface TimelineProps {
  title?: React.ReactNode;
  items: TimelineItem[];
}

export function Timeline({ title, items }: TimelineProps) {
  return (
    <section className="space-y-3">
      {title ? (
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      ) : null}
      <ScrollArea className="max-h-[26rem] pr-3">
        <ol className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-border bg-card px-3 py-3 text-card-foreground"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  {item.eyebrow ? (
                    <p className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                      {item.eyebrow}
                    </p>
                  ) : null}
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.timestamp ? (
                    <p className="text-[0.6875rem] uppercase text-muted-foreground">
                      {item.timestamp}
                    </p>
                  ) : null}
                  {item.description ? (
                    <p className="text-xs/relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                  {item.metadata?.length ? (
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                      {item.metadata.map((entry, index) => (
                        <div
                          key={typeof entry.label === "string" ? entry.label : index}
                          className="space-y-1 rounded-md border border-border bg-muted/20 px-2.5 py-2"
                        >
                          <dt className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                            {entry.label}
                          </dt>
                          <dd className="text-xs text-foreground">{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                {item.tone ? (
                  <StatusBadge tone={item.tone}>{item.tone}</StatusBadge>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </section>
  );
}
