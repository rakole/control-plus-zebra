import type { ReactNode } from "react";
import { Link } from "react-router";

import { MetricCard } from "../../../components/app/metric-card.js";
import { MetricGrid } from "../../../components/app/metric-grid.js";
import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { Button } from "../../../components/ui/button.js";

type OverviewResponse = Awaited<ReturnType<Window["agentWorkbench"]["getDashboardStats"]>>;
type OverviewView = Extract<OverviewResponse, { ok: true }>["stats"];

interface OverviewSummaryProps {
  activityPanel: ReactNode;
  overview: OverviewView;
  selectedAdapterId?: string;
}

export function OverviewSummary({
  activityPanel,
  overview,
  selectedAdapterId = "all"
}: OverviewSummaryProps) {
  const adapterQuery =
    selectedAdapterId === "all"
      ? ""
      : `?adapterId=${encodeURIComponent(selectedAdapterId)}`;

  return (
    <>
      <MetricGrid aria-label="Overview metrics">
        <MetricCard
          customSize
          glowColor="blue"
          label="Projects"
          value={overview.metrics.totalProjects.displayValue}
          variant="glow"
        />
        <MetricCard
          customSize
          glowColor="green"
          label="Sessions"
          value={overview.metrics.totalSessions.displayValue}
          variant="glow"
        />
        <MetricCard
          customSize
          glowColor="orange"
          label="Active / Recent"
          value={overview.metrics.activeOrRecentSessions.displayValue}
          variant="glow"
        />
        <MetricCard
          customSize
          glowColor="red"
          label="Failed Verification"
          value={overview.metrics.failedVerification.displayValue}
          variant="glow"
        />
        <MetricCard
          customSize
          glowColor="purple"
          label="Needs Attention"
          value={overview.metrics.needsAttentionSessions.displayValue}
          variant="glow"
        />
        <MetricCard
          customSize
          glowColor="blue"
          label="Tool Activity"
          value={overview.metrics.toolActivity.displayValue}
          variant="glow"
        />
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
              <Button asChild>
                <Link to={`/projects${adapterQuery}`}>Open Projects</Link>
              </Button>
              <Button asChild>
                <Link to={`/sessions${adapterQuery}`}>Open Sessions</Link>
              </Button>
            </div>
          </SectionCard>
        </section>
        {activityPanel}
      </div>
    </>
  );
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
