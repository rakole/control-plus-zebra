import { useEffect, useState } from "react";
import { Link } from "react-router";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";

type OverviewResponse = Awaited<ReturnType<Window["agentWorkbench"]["getOverview"]>>;
type OverviewView = Extract<OverviewResponse, { ok: true }>["overview"];

const ERROR_COPY =
  "Overview could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function OverviewRoute() {
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    window.agentWorkbench
      .getOverview()
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setOverview(response.overview);
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
  }, []);

  return (
    <main className="route-shell" aria-labelledby="overview-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Triage dashboard</p>
          <h1 id="overview-title">Overview</h1>
        </div>
      </section>

      {isLoading ? <LoadingSkeleton /> : null}

      {!isLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
        </section>
      ) : null}

      {!isLoading && !loadFailed && overview ? (
        <>
          <section className="overview-metrics" aria-label="Overview metrics">
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
          </section>

          <section className="triage-grid triage-grid-2">
            <section className="triage-panel" aria-labelledby="overview-harnesses">
              <div className="panel-header">
                <div>
                  <p className="route-kicker">Harness filters</p>
                  <h2 id="overview-harnesses">Observed Harnesses</h2>
                </div>
              </div>
              <div className="pill-list">
                {overview.harnessFilters.map((filter) => (
                  <span className="metric-pill" key={filter.adapterId}>
                    {filter.label} · {filter.sessionCount}
                  </span>
                ))}
              </div>
              <div className="route-actions">
                <Link className="secondary-button" to="/projects">
                  Open Projects
                </Link>
                <Link className="secondary-button" to="/sessions">
                  Open Sessions
                </Link>
              </div>
            </section>

            <section className="triage-panel" aria-labelledby="overview-activity">
              <div className="panel-header">
                <div>
                  <p className="route-kicker">Activity over time</p>
                  <h2 id="overview-activity">Recent Activity</h2>
                </div>
              </div>
              <div className="timeline-meta">
                {overview.activity.map((point) => (
                  <div key={point.day}>
                    <dt>{point.day}</dt>
                    <dd>
                      {point.sessionCount} sessions · {point.needsAttentionCount} attention
                    </dd>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </>
      ) : null}
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <p className="route-kicker">{label}</p>
      <h2>{value}</h2>
    </article>
  );
}
