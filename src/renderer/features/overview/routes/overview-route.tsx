import { useEffect, useState } from "react";

import { getOverview } from "../../../bridge/agent-workbench.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { OverviewSummary } from "../components/overview-summary.js";

type OverviewResponse = Awaited<ReturnType<typeof getOverview>>;
type OverviewView = Extract<OverviewResponse, { ok: true }>["overview"];

const ERROR_COPY =
  "Overview could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function OverviewRoute() {
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    getOverview()
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
    <RoutePage aria-label="Overview route">
      <PageHeader
        eyebrow="Triage dashboard"
        title="Overview"
        description="Review top-level workbench volume, harness coverage, and attention trends without flattening unsupported evidence."
      />

      {isLoading ? (
        <LoadingState
          title="Loading overview"
          description="Reading top-level metrics, observed harnesses, and recent activity."
        />
      ) : null}

      {!isLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isLoading && !loadFailed && overview ? <OverviewSummary overview={overview} /> : null}
    </RoutePage>
  );
}
