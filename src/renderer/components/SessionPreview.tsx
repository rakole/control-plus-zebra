import { CapabilityBadge } from "./CapabilityBadge.js";

type GetSessionByIdResponse = Awaited<ReturnType<Window["agentWorkbench"]["getSessionById"]>>;
export type SessionPreviewView = NonNullable<
  Extract<GetSessionByIdResponse, { ok: true }>["session"]
>;

interface SessionPreviewProps {
  session: SessionPreviewView | null;
  isLoading?: boolean;
}

const evidenceLabels: Array<{
  key: keyof SessionPreviewView["evidenceSummary"];
  label: string;
}> = [
  { key: "messages", label: "Messages" },
  { key: "toolCalls", label: "Tool calls" },
  { key: "shellCommands", label: "Shell command evidence" },
  { key: "outputArtifacts", label: "Output artifacts" },
  { key: "fileMutations", label: "File mutations" },
  { key: "diagnostics", label: "Diagnostics" }
];

export function SessionPreview({ session, isLoading = false }: SessionPreviewProps) {
  if (isLoading) {
    return (
      <aside className="preview-panel skeleton-preview" aria-label="Selected session preview loading">
        <span className="skeleton-line skeleton-line-meta" />
        <span className="skeleton-line skeleton-line-heading" />
        <span className="skeleton-line skeleton-line-wide" />
        <span className="skeleton-line skeleton-line-wide" />
      </aside>
    );
  }

  if (!session) {
    return (
      <aside className="preview-panel preview-empty" aria-label="Selected session preview">
        <p className="preview-label">Selected preview</p>
        <h2>Select a session to inspect its summary.</h2>
      </aside>
    );
  }

  const capabilityWarnings = session.capabilityBadges.filter(
    (badge) => badge.state !== "Supported"
  );

  return (
    <aside className="preview-panel" aria-label="Selected session preview">
      <div className="preview-heading">
        <div>
          <p className="preview-label">{session.adapterDisplayName}</p>
          <h2>{session.title}</h2>
        </div>
        <span className="status-badge">{formatLifecycle(session.lifecycleStatus)}</span>
      </div>

      <dl className="preview-meta-grid">
        <div>
          <dt>Harness</dt>
          <dd>{session.adapterDisplayName}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(session.startedAt) ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Ended</dt>
          <dd>{formatTimestamp(session.endedAt) ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Diagnostics</dt>
          <dd>{session.diagnosticWarningCount}</dd>
        </div>
      </dl>

      <section className="preview-section" aria-labelledby="capability-heading">
        <h3 id="capability-heading">Capability Warnings</h3>
        <div className="capability-list">
          {(capabilityWarnings.length > 0 ? capabilityWarnings : session.capabilityBadges.slice(0, 1)).map(
            (badge) => (
              <div className="capability-row" key={badge.key}>
                <span>{badge.label}</span>
                <CapabilityBadge label={badge.label} state={badge.state} {...(badge.reason ? { reason: badge.reason } : {})} />
              </div>
            )
          )}
        </div>
      </section>

      <section className="preview-section" aria-labelledby="evidence-heading">
        <h3 id="evidence-heading">Evidence Summary</h3>
        <dl className="evidence-grid">
          {evidenceLabels.map((item) => (
            <div key={item.key}>
              <dt>{item.label}</dt>
              <dd>{session.evidenceSummary[item.key]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}

function formatLifecycle(status: SessionPreviewView["lifecycleStatus"]): string {
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
