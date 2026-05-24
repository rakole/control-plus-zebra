import { useEffect, useRef, type KeyboardEvent } from "react";

import { Badge } from "../../../components/ui/badge.js";
import { ScrollArea } from "../../../components/ui/scroll-area.js";
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
        <div className="space-y-2 p-3">
          {sessions.map((session, index) => {
            const isSelected = session.sessionId === selectedSessionId;
            const capabilityWarnings = flattenSessionCapabilities(session.capabilityGroups).filter(
              (badge) => badge.state !== "Supported"
            );

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
                      <TruthStateBadge state={session.runAuditState} />
                      <TruthStateBadge state={session.verificationState} />
                      <TruthStateBadge state={session.lifecycleState} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">
                      {session.triageMetrics.commands.displayValue} commands
                    </Badge>
                    <Badge variant="outline">
                      {session.triageMetrics.toolCalls.displayValue} tools
                    </Badge>
                    <Badge variant="outline">
                      {session.triageMetrics.fileMutations.displayValue} files
                    </Badge>
                    <Badge variant="outline">
                      {session.triageMetrics.failedCommands.displayValue} failed
                    </Badge>
                    {(capabilityWarnings.length > 0
                      ? capabilityWarnings.slice(0, 2)
                      : [{ key: "supported", label: "Capabilities", state: "Supported" as const }]
                    ).map((badge) => (
                      <CapabilityBadge
                        key={`${session.sessionId}-${badge.key}`}
                        label={badge.label}
                        state={badge.state}
                        {...(badge.reason ? { reason: badge.reason } : {})}
                      />
                    ))}
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
