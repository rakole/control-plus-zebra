import type { SessionSummary } from "./types.js";

export function formatTimestamp(value?: string): string | null {
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

export function formatSessionRange(session: Pick<SessionSummary, "startedAt" | "endedAt">): string {
  const startedAt = formatTimestamp(session.startedAt);
  const endedAt = formatTimestamp(session.endedAt);

  if (startedAt && endedAt) {
    return `${startedAt} - ${endedAt}`;
  }

  return startedAt ?? endedAt ?? "Time Unknown";
}
