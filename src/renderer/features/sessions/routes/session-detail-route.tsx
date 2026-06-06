import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";

import {
  getSessionDetail,
  onSourceDataChanged
} from "../../../bridge/agent-workbench.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { Button } from "../../../components/ui/button.js";
import { SessionDetailSummaryRail } from "../components/session-detail-summary-rail.js";
import { SessionTimeline } from "../components/session-timeline.js";
import type { SessionDetailView } from "../types.js";

const ERROR_COPY =
  "Session detail could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function SessionDetailRoute() {
  const { sessionId } = useParams();
  const location = useLocation();
  const [detail, setDetail] = useState<SessionDetailView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }

    let isCurrent = true;
    const isLiveRefresh = refreshToken > 0;

    setIsLoading(!isLiveRefresh);
    setLoadFailed(false);

    getSessionDetail({ sessionId })
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setDetail(response.detail);
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
  }, [refreshToken, sessionId]);

  useEffect(() => {
    return onSourceDataChanged(() => {
      setRefreshToken((current) => current + 1);
    });
  }, []);

  return (
    <RoutePage aria-label="Session detail route">
      <PageHeader
        actions={
          sessionId ? (
            <Button asChild type="button" variant="outline">
              <Link to={`/sessions/${sessionId}/run-audit${location.search}`}>
                Open Run Audit
              </Link>
            </Button>
          ) : null
        }
        eyebrow="Chronological evidence"
        title="Session Detail"
      />

      {isLoading ? (
        <LoadingState
          title="Loading session detail"
          description="Reading the selected run and its chronological evidence."
        />
      ) : null}

      {!isLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isLoading && !loadFailed && detail ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(18rem,20rem)_minmax(0,1fr)]">
          <SessionDetailSummaryRail detail={detail} />
          <SessionTimeline detail={detail} />
        </section>
      ) : null}
    </RoutePage>
  );
}
