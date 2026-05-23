import { useEffect, useRef, type KeyboardEvent } from "react";

import { CapabilityBadge } from "./CapabilityBadge.js";

type ListSessionsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listSessions"]>>;
export type SessionSummary = Extract<ListSessionsResponse, { ok: true }>["sessions"][number];

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
    <div className="session-list" aria-label="Session summaries" onKeyDown={handleKeyDown}>
      {sessions.map((session, index) => {
        const isSelected = session.sessionId === selectedSessionId;
        const capabilityWarnings = session.capabilityBadges.filter(
          (badge) => badge.state !== "Supported"
        );

        return (
          <button
            className={isSelected ? "session-row session-row-selected" : "session-row"}
            key={session.sessionId}
            onClick={() => onSelect(session.sessionId)}
            onFocus={() => onFocusIndexChange(index)}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            type="button"
            aria-current={isSelected ? "true" : undefined}
          >
            <span className="session-row-main">
              <span className="session-title">{session.title}</span>
              <span className="session-meta">
                {session.adapterDisplayName} · {formatLifecycle(session.lifecycleStatus)} ·{" "}
                {formatSessionRange(session)}
              </span>
              <span className="session-warning-summary">
                {capabilityWarnings.length > 0
                  ? `${capabilityWarnings.length} capability warning${capabilityWarnings.length === 1 ? "" : "s"}`
                  : "Capabilities supported"}
              </span>
            </span>
            <span className="session-row-badges">
              {capabilityWarnings.slice(0, 2).map((badge) => (
                <CapabilityBadge key={badge.key} label={badge.label} state={badge.state} {...(badge.reason ? { reason: badge.reason } : {})} />
              ))}
              {capabilityWarnings.length === 0 ? (
                <CapabilityBadge state="Supported" label="Capabilities" />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatLifecycle(status: SessionSummary["lifecycleStatus"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "unknown":
      return "Unknown";
  }
}

function formatSessionRange(session: SessionSummary): string {
  const startedAt = formatTimestamp(session.startedAt);
  const endedAt = formatTimestamp(session.endedAt);

  if (startedAt && endedAt) {
    return `${startedAt} - ${endedAt}`;
  }

  return startedAt ?? endedAt ?? "Time Unknown";
}

function formatTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
