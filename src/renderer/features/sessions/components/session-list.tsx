import { useEffect, useRef, type KeyboardEvent } from "react";

import { Badge } from "../../../components/ui/badge.js";
import { ScrollArea } from "../../../components/ui/scroll-area.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { cn } from "../../../lib/utils.js";
import { formatSessionRange } from "../format.js";
import {
  getSessionPrimaryVerdict,
  getSessionReason,
  getSessionRiskRank
} from "../session-triage-helpers.js";
import type { SessionSummary } from "../types.js";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  focusedIndex: number;
  onFocusIndexChange(index: number): void;
  onSelect(sessionId: string): void;
}

function getSeverityRailClassName(session: SessionSummary): string {
  switch (getSessionRiskRank(session)) {
    case 0:
      return "bg-sky-400";
    case 1:
      return "bg-rose-400";
    case 2:
    case 3:
      return "bg-amber-400";
    case 4:
      return "bg-violet-400";
    case 5:
      return "bg-slate-400";
    default:
      return "bg-emerald-400";
  }
}

function getMetricLabel(value: string, singular: string, plural = `${singular}s`): string {
  return value === "1" ? singular : plural;
}

function shouldRenderFailedCommandBadge(
  metric: SessionSummary["triageMetrics"]["failedCommands"]
): boolean {
  const numericValue =
    typeof metric.numericValue === "number" && Number.isFinite(metric.numericValue)
      ? metric.numericValue
      : Number.parseInt(metric.displayValue, 10);

  return metric.status === "value" && Number.isFinite(numericValue) && numericValue > 0;
}

export function SessionList({
  sessions,
  selectedSessionId,
  focusedIndex,
  onFocusIndexChange,
  onSelect
}: SessionListProps) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    rowRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onFocusIndexChange(Math.min(focusedIndex + 1, sessions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onFocusIndexChange(Math.max(focusedIndex - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const focusedSession = sessions[focusedIndex];

      if (focusedSession) {
        onSelect(focusedSession.sessionId);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={handleKeyDown}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Session inbox</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Review visible runs by triage risk and keep missing evidence explicit.
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {sessions.map((session, index) => {
            const isSelected = session.sessionId === selectedSessionId;
            const primaryVerdict = getSessionPrimaryVerdict(session);
            const sessionReason = getSessionReason(session);

            return (
              <button
                key={session.sessionId}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                type="button"
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "w-full rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-muted/30"
                )}
                onClick={() => onSelect(session.sessionId)}
                onFocus={() => onFocusIndexChange(index)}
              >
                <div className="flex min-w-0 gap-3 px-3 py-3">
                  <div
                    aria-hidden="true"
                    className={cn(
                      "w-1 shrink-0 self-stretch rounded-full",
                      getSeverityRailClassName(session)
                    )}
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="line-clamp-2 text-sm font-medium text-foreground">
                          {session.title}
                        </p>
                        <p className="line-clamp-1 text-xs/relaxed text-muted-foreground">
                          {session.firstUserPrompt ?? "No user prompt captured"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {session.adapterDisplayName} · {session.projectDisplayName ?? "Unknown Project"} ·{" "}
                          {formatSessionRange(session)}
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-start justify-start gap-1 lg:max-w-[18rem] lg:justify-end">
                        <TruthStateBadge state={primaryVerdict} />
                        <TruthStateBadge state={session.verificationState} />
                        <TruthStateBadge state={session.runAuditState} />
                      </div>
                    </div>

                    <p className="line-clamp-1 text-xs font-medium text-muted-foreground">
                      {sessionReason}
                    </p>

                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">
                        {session.triageMetrics.commands.displayValue}{" "}
                        {getMetricLabel(session.triageMetrics.commands.displayValue, "cmd")}
                      </Badge>
                      <Badge variant="outline">
                        {session.triageMetrics.toolCalls.displayValue}{" "}
                        {getMetricLabel(session.triageMetrics.toolCalls.displayValue, "tool")}
                      </Badge>
                      <Badge variant="outline">
                        {session.triageMetrics.fileMutations.displayValue}{" "}
                        {getMetricLabel(session.triageMetrics.fileMutations.displayValue, "file")}
                      </Badge>
                      <Badge variant="outline">
                        {session.evidenceMetrics.diagnostics.displayValue}{" "}
                        {getMetricLabel(
                          session.evidenceMetrics.diagnostics.displayValue,
                          "diag"
                        )}
                      </Badge>
                      {shouldRenderFailedCommandBadge(session.triageMetrics.failedCommands) ? (
                        <Badge variant="outline">
                          {session.triageMetrics.failedCommands.displayValue} failed
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
