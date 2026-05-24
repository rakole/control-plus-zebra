import { Badge } from "../../../components/ui/badge.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { Timeline } from "../../../components/app/timeline.js";
import type { SessionDetailView } from "../types.js";

interface SessionTimelineProps {
  detail: SessionDetailView;
}

export function SessionTimeline({ detail }: SessionTimelineProps) {
  return (
    <SectionCard
      title="Session Timeline"
      description="Chronological evidence for the selected local run."
      actions={<Badge variant="outline">{detail.timeline.length} events</Badge>}
    >
      <Timeline
        items={detail.timeline.map((event) => ({
          id: event.id,
          eyebrow: event.kind,
          title: event.title,
          timestamp: event.timestamp,
          description: event.summary,
          metadata: event.metadata
        }))}
      />
    </SectionCard>
  );
}
