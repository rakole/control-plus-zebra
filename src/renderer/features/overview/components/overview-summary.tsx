import { Link } from "react-router";

import { MetricCard } from "../../../components/app/metric-card.js";
import { MetricGrid } from "../../../components/app/metric-grid.js";
import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { Button } from "../../../components/ui/button.js";

type OverviewResponse = Awaited<ReturnType<Window["agentWorkbench"]["getOverview"]>>;
type OverviewView = Extract<OverviewResponse, { ok: true }>["overview"];

interface OverviewSummaryProps {
  overview: OverviewView;
}

export function OverviewSummary({ overview }: OverviewSummaryProps) {
  return (
    <>
      <MetricGrid aria-label="Overview metrics">
        <MetricCard label="Projects" value={overview.metrics.totalProjects.displayValue} />
        <MetricCard label="Sessions" value={overview.metrics.totalSessions.displayValue} />
        <MetricCard
          label="Active / Recent"
          value={overview.metrics.activeOrRecentSessions.displayValue}
        />
        <MetricCard
          label="Failed Verification"
          value={overview.metrics.failedVerification.displayValue}
        />
        <MetricCard
          label="Needs Attention"
          value={overview.metrics.needsAttentionSessions.displayValue}
        />
        <MetricCard label="Tool Activity" value={overview.metrics.toolActivity.displayValue} />
      </MetricGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-label="Observed Harnesses">
          <SectionCard
            title={<h2>Observed Harnesses</h2>}
            description="Keep the current harness mix visible without assuming every source reports the same evidence."
            contentClassName="space-y-4"
          >
            <MetadataGrid
              items={overview.harnessFilters.map((filter) => ({
                label: filter.label,
                value: formatCount(filter.sessionCount, "session")
              }))}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="outline">
                <Link to="/projects">Open Projects</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/sessions">Open Sessions</Link>
              </Button>
            </div>
          </SectionCard>
        </section>

        <section aria-label="Recent Activity">
          <SectionCard
            title={<h2>Recent Activity</h2>}
            description="Track recent session volume and explicit attention counts over time."
          >
            <MetadataGrid
              items={
                overview.activity.length > 0
                  ? overview.activity.flatMap((point) => [
                      {
                        label: point.day,
                        value: formatCount(point.sessionCount, "session")
                      },
                      {
                        label: `${point.day} Needs Attention`,
                        value: `${point.needsAttentionCount} need attention`
                      }
                    ])
                  : [{ label: "Activity", value: "No recent session activity" }]
              }
            />
          </SectionCard>
        </section>
      </div>
    </>
  );
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
