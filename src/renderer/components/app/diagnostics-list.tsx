import * as React from "react";

import { StatusBadge } from "./status-badge.js";

export interface DiagnosticListItem {
  id: string;
  severity: "info" | "warning" | "error" | "success" | "unsupported";
  message: React.ReactNode;
  detail?: React.ReactNode;
}

export interface DiagnosticsListProps {
  title: string;
  diagnostics: DiagnosticListItem[];
}

const toneBySeverity = {
  info: "info",
  warning: "warning",
  error: "danger",
  success: "success",
  unsupported: "unsupported"
} as const;

export function DiagnosticsList({
  title,
  diagnostics
}: DiagnosticsListProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <StatusBadge tone={diagnostics.length ? "warning" : "neutral"}>
          {diagnostics.length} item{diagnostics.length === 1 ? "" : "s"}
        </StatusBadge>
      </div>
      <ul
        aria-label={title}
        className="space-y-2"
      >
        {diagnostics.map((diagnostic) => (
          <li
            key={diagnostic.id}
            className="rounded-lg border border-border bg-card px-3 py-3 text-card-foreground"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm">{diagnostic.message}</p>
                {diagnostic.detail ? (
                  <p className="text-xs/relaxed text-muted-foreground">
                    {diagnostic.detail}
                  </p>
                ) : null}
              </div>
              <StatusBadge tone={toneBySeverity[diagnostic.severity]}>
                {diagnostic.severity}
              </StatusBadge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
