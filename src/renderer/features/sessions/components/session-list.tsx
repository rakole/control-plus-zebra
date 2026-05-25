import { useEffect, useRef, type KeyboardEvent } from "react";

import { StatusChipTooltip } from "../../../components/app/status-chip-tooltip.js";
import {
  getCapabilityTooltip,
  getMetricTooltip,
  getTruthTooltip
} from "../../../components/app/status-chip-tooltips.js";
import { Badge } from "../../../components/ui/badge.js";
import { ScrollArea } from "../../../components/ui/scroll-area.js";
import { TooltipProvider } from "../../../components/ui/tooltip.js";
import { CapabilityBadge } from "../../../components/app/capability-badge.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { cn } from "../../../lib/utils.js";
import { formatSessionRange } from "../format.js";
import { flattenSessionCapabilities, type SessionSummary } from "../types.js";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  focusedIndex: number;
  onFocusIndexChange(index: number): void;
  onSelect(sessionId: string): void;
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
        <h2 className="text-sm font-medium text-foreground">Session summaries</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Review recent local runs and keep missing evidence explicit.
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <TooltipProvider>
          <div className="space-y-2 p-3">
            {sessions.map((session, index) => {
              const isSelected = session.sessionId === selectedSessionId;
              const capabilityWarnings = flattenSessionCapabilities(session.capabilityGroups).filter(
                (badge) => badge.state !== "Supported"
              );
              const truthBadges = [
                { key: "run-audit", label: "Run audit status", state: session.runAuditState },
                {
                  key: "verification",
                  label: "Verification status",
                  state: session.verificationState
                },
                { key: "lifecycle", label: "Session lifecycle", state: session.lifecycleState }
              ];
              const metricBadges = [
                {
                  key: "commands",
                  label: "Commands",
                  metric: session.triageMetrics.commands,
                  content: `${session.triageMetrics.commands.displayValue} commands`
                },
                {
                  key: "tools",
                  label: "Tool calls",
                  metric: session.triageMetrics.toolCalls,
                  content: `${session.triageMetrics.toolCalls.displayValue} tools`
                },
                {
                  key: "files",
                  label: "File mutations",
                  metric: session.triageMetrics.fileMutations,
                  content: `${session.triageMetrics.fileMutations.displayValue} files`
                },
                {
                  key: "failed",
                  label: "Failed commands",
                  metric: session.triageMetrics.failedCommands,
                  content: `${session.triageMetrics.failedCommands.displayValue} failed`
                }
              ];

              return (
                <button
                  key={session.sessionId}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:bg-muted/30"
                  )}
                  onClick={() => onSelect(session.sessionId)}
                  onFocus={() => onFocusIndexChange(index)}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {session.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {session.adapterDisplayName} · {session.projectDisplayName ?? "Unknown Project"} ·{" "}
                          {formatSessionRange(session)}
                        </p>
                        <p className="line-clamp-2 text-xs/relaxed text-muted-foreground">
                          {session.firstUserPrompt ?? "No user prompt captured"}
                        </p>
                      </div>
                      <div className="flex max-w-[18rem] flex-wrap justify-end gap-1">
                        {truthBadges.map(({ key, label, state }) => {
                          const tooltip = getTruthTooltip(label, state);

                          return (
                            <StatusChipTooltip key={key} tooltip={tooltip}>
                              <TruthStateBadge state={state} tooltip={tooltip} />
                            </StatusChipTooltip>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {metricBadges.map(({ key, label, metric, content }) => {
                        const tooltip = getMetricTooltip(label, metric);

                        return (
                          <StatusChipTooltip key={key} tooltip={tooltip}>
                            <Badge variant="outline" title={tooltip}>
                              {content}
                            </Badge>
                          </StatusChipTooltip>
                        );
                      })}
                      {(capabilityWarnings.length > 0
                        ? capabilityWarnings.slice(0, 2)
                        : [{ key: "supported", label: "Capabilities", state: "Supported" as const }]
                      ).map((badge) => {
                        const tooltip = getCapabilityTooltip(badge);

                        return (
                          <StatusChipTooltip key={`${session.sessionId}-${badge.key}`} tooltip={tooltip}>
                            <CapabilityBadge
                              label={badge.label}
                              state={badge.state}
                              tooltip={tooltip}
                              {...(badge.reason ? { reason: badge.reason } : {})}
                            />
                          </StatusChipTooltip>
                        );
                      })}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </TooltipProvider>
      </ScrollArea>
    </div>
  );
}
