type DetailResponse = Awaited<ReturnType<Window["agentWorkbench"]["getSessionDetail"]>>;
type TimelineEventView = NonNullable<
  Extract<DetailResponse, { ok: true }>["detail"]
>["timeline"][number];

interface TimelineEventCardProps {
  event: TimelineEventView;
}

export function TimelineEventCard({ event }: TimelineEventCardProps) {
  return (
    <article className="timeline-card">
      <div className="timeline-heading">
        <div>
          <p className="route-kicker">{event.kind}</p>
          <h3>{event.title}</h3>
        </div>
        {event.timestamp ? <span className="timeline-time">{event.timestamp}</span> : null}
      </div>
      {event.summary ? <p className="timeline-summary">{event.summary}</p> : null}
      <dl className="timeline-meta">
        {event.metadata.map((entry) => (
          <div key={`${event.id}-${entry.label}`}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
