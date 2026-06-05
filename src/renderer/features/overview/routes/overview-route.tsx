import { Suspense, lazy, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { getDashboardStats } from "../../../bridge/agent-workbench.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { Toolbar } from "../../../components/app/toolbar.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { OverviewSummary } from "../components/overview-summary.js";
import { UsageCoverageCards } from "../components/usage-coverage-cards.js";

type OverviewResponse = Awaited<ReturnType<typeof getDashboardStats>>;
type OverviewView = Extract<OverviewResponse, { ok: true }>["stats"];

const ERROR_COPY =
  "Overview could not load. Check the preload bridge and IPC handler, then reload triage data.";
const OverviewActivityHeatmap = lazy(
  () => import("../components/overview-activity-heatmap.js")
);

export function OverviewRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAdapterId = searchParams.get("adapterId") ?? "all";
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setLoadFailed(false);
    setOverview(null);

    getDashboardStats(selectedAdapterId === "all" ? {} : { adapterId: selectedAdapterId })
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setOverview(response.stats);
      })
      .catch(() => {
        if (isCurrent) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedAdapterId]);

  function handleAdapterChange(adapterId: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (adapterId === "all") {
        next.delete("adapterId");
      } else {
        next.set("adapterId", adapterId);
      }

      return next;
    });
  }

  return (
    <RoutePage aria-label="Overview route">
      <PageHeader
        eyebrow="Triage dashboard"
        title="Overview"
        description="Review top-level workbench volume, harness coverage, and attention trends without flattening unsupported evidence."
        actions={
          <Toolbar ariaLabel="Overview filters" className="justify-end">
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Harness</span>
              <NativeSelect
                aria-label="Harness"
                onChange={(event) => handleAdapterChange(event.target.value)}
                value={selectedAdapterId}
              >
                <option value="all">All Harnesses</option>
                {overview?.harnessFilters.map((filter) => (
                  <option key={filter.adapterId} value={filter.adapterId}>
                    {filter.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </Toolbar>
        }
      />

      {isLoading ? (
        <LoadingState
          title="Loading overview"
          description="Reading top-level metrics, observed harnesses, and recent activity."
        />
      ) : null}

      {!isLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isLoading && !loadFailed && overview ? (
        <>
          <section aria-label="Usage summary">
            <SectionCard
              title={<h2>Usage Coverage</h2>}
              description="Keep model and token visibility explicit before drilling into session-level chronology."
            >
              <UsageCoverageCards
                metrics={[
                  {
                    icon: "MD",
                    title: "Models",
                    value: (
                      <span className="break-words text-xl leading-tight">
                        {overview.usageSummary.models.displayValue}
                      </span>
                    )
                  },
                  {
                    icon: "TT",
                    title: "Total Tokens",
                    value: overview.usageSummary.tokenMetrics.totalTokens.displayValue
                  },
                  {
                    icon: "IN",
                    title: "Input",
                    value: overview.usageSummary.tokenMetrics.inputTokens.displayValue
                  },
                  {
                    icon: "OUT",
                    title: "Output",
                    value: overview.usageSummary.tokenMetrics.outputTokens.displayValue
                  },
                  {
                    icon: "TH",
                    title: "Thoughts",
                    value: overview.usageSummary.tokenMetrics.thoughtTokens.displayValue
                  },
                  {
                    icon: "CI",
                    title: "Cached Input",
                    value: overview.usageSummary.tokenMetrics.cacheReadTokens.displayValue,
                    change: "Subset of input tokens, not an extra additive bucket."
                  }
                ]}
              />
            </SectionCard>
          </section>
          <OverviewSummary
            activityPanel={
              <Suspense fallback={<OverviewActivityHeatmapFallback />}>
                <OverviewActivityHeatmap selectedAdapterId={selectedAdapterId} />
              </Suspense>
            }
            overview={overview}
            selectedAdapterId={selectedAdapterId}
          />
        </>
      ) : null}
    </RoutePage>
  );
}

function OverviewActivityHeatmapFallback() {
  return (
    <section aria-label="Overview Activity Heatmap">
      <SectionCard
        title={<h2>Activity Heatmap</h2>}
        description="Fixed last 30 days of session volume. Outlined cells mark explicit attention."
      >
        <LoadingState
          title="Loading activity heatmap"
          description="Reading the last 30 days of session activity without blocking the rest of Overview."
        />
      </SectionCard>
    </section>
  );
}
