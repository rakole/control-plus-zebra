import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { SessionDetailSummaryRail } from "../components/triage/SessionDetailSummaryRail.js";
import { SessionTimeline } from "../components/triage/SessionTimeline.js";

type SessionDetailResponse = Awaited<ReturnType<Window["agentWorkbench"]["getSessionDetail"]>>;
type SessionDetailView = NonNullable<Extract<SessionDetailResponse, { ok: true }>["detail"]>;

const ERROR_COPY =
  "Session detail could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function SessionDetailRoute() {
  const { sessionId } = useParams();
  const [detail, setDetail] = useState<SessionDetailView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }

    let isCurrent = true;

    window.agentWorkbench
      .getSessionDetail({ sessionId })
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
  }, [sessionId]);

  return (
    <main className="route-shell" aria-labelledby="session-detail-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Chronological evidence</p>
          <h1 id="session-detail-title">Session Detail</h1>
        </div>
        {sessionId ? (
          <Link className="secondary-button" to={`/sessions/${sessionId}/run-audit`}>
            Open Run Audit
          </Link>
        ) : null}
      </section>

      {isLoading ? <LoadingSkeleton /> : null}

      {!isLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
        </section>
      ) : null}

      {!isLoading && !loadFailed && detail ? (
        <section className="triage-grid triage-grid-detail" aria-label="Session detail route">
          <SessionDetailSummaryRail detail={detail} />
          <SessionTimeline detail={detail} />
        </section>
      ) : null}
    </main>
  );
}
