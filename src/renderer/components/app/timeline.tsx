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
  summaryDetail?: React.ReactNode;
  metadata?: Array<{
    label: React.ReactNode;
    value: React.ReactNode;
  }>;
  actions?: React.ReactNode;
  detail?: React.ReactNode;
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
      <ScrollArea type="always" className="h-[min(42rem,calc(100vh-16rem))] pr-4">
        <ol className="space-y-3 pr-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="min-w-0 rounded-lg border border-border bg-card px-3 py-3 text-card-foreground"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {item.eyebrow ? (
                    <p className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                      {item.eyebrow}
                    </p>
                  ) : null}
                  <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                    {item.title}
                  </p>
                  {item.timestamp ? (
                    <p className="text-[0.6875rem] uppercase text-muted-foreground">
                      {item.timestamp}
                    </p>
                  ) : null}
                  {item.description ? (
                    <p className="break-words text-xs/relaxed text-muted-foreground [overflow-wrap:anywhere]">
                      {item.description}
                    </p>
                  ) : null}
                  {item.summaryDetail}
                  {item.metadata?.length ? (
                    <dl className="mt-3 grid gap-2 2xl:grid-cols-2">
                      {item.metadata.map((entry, index) => (
                        <div
                          key={typeof entry.label === "string" ? entry.label : index}
                          className="min-w-0 space-y-1 rounded-md border border-border bg-muted/20 px-2.5 py-2"
                        >
                          <dt className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                            {entry.label}
                          </dt>
                          <dd className="break-all text-xs text-foreground">{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.actions}
                  {item.tone ? (
                    <StatusBadge tone={item.tone}>{item.tone}</StatusBadge>
                  ) : null}
                </div>
              </div>
              {item.detail ? <div className="mt-3">{item.detail}</div> : null}
            </li>
          ))}
        </ol>
      </ScrollArea>
    </section>
  );
}
