import { TimelineEventCard } from "./TimelineEventCard.js";

type DetailResponse = Awaited<ReturnType<Window["agentWorkbench"]["getSessionDetail"]>>;
type SessionDetailView = NonNullable<Extract<DetailResponse, { ok: true }>["detail"]>;

interface SessionTimelineProps {
  detail: SessionDetailView;
}

export function SessionTimeline({ detail }: SessionTimelineProps) {
  return (
    <section className="triage-panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-header">
        <div>
          <p className="route-kicker">Chronology</p>
          <h2 id="timeline-title">Session Timeline</h2>
        </div>
        <span className="metric-pill">{detail.timeline.length}</span>
      </div>

      <div className="timeline-stack">
        {detail.timeline.map((event) => (
          <TimelineEventCard event={event} key={event.id} />
        ))}
      </div>
    </section>
  );
}
