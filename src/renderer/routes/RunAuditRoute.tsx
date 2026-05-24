import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { TruthStateBadge } from "../components/triage/TruthStateBadge.js";

type RunAuditResponse = Awaited<ReturnType<Window["agentWorkbench"]["getRunAudit"]>>;
type RunAuditView = NonNullable<Extract<RunAuditResponse, { ok: true }>["runAudit"]>;

const ERROR_COPY =
  "Run audit could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function RunAuditRoute() {
  const { sessionId } = useParams();
  const [runAudit, setRunAudit] = useState<RunAuditView | null>(null);
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
      .getRunAudit({ sessionId })
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setRunAudit(response.runAudit);
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
    <main className="route-shell" aria-labelledby="run-audit-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Claim vs evidence</p>
          <h1 id="run-audit-title">Run Audit</h1>
        </div>
        {sessionId ? (
          <Link className="secondary-button" to={`/sessions/${sessionId}`}>
            Open Session Detail
          </Link>
        ) : null}
      </section>

      {isLoading ? <LoadingSkeleton /> : null}

      {!isLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
        </section>
      ) : null}

      {!isLoading && !loadFailed && runAudit ? (
        <>
          <section className="triage-panel audit-hero" aria-label="Run audit summary">
            <div className="panel-header">
              <div>
                <p className="route-kicker">{runAudit.session.adapterDisplayName}</p>
                <h2>{runAudit.session.title}</h2>
              </div>
              <div className="state-row">
                <TruthStateBadge state={runAudit.session.runAuditState} />
                <TruthStateBadge state={runAudit.session.verificationState} />
              </div>
            </div>
          </section>

          <section className="triage-grid triage-grid-2" aria-label="Run audit route">
            {runAudit.sections.map((section) => (
              <section className="triage-panel" aria-labelledby={section.id} key={section.id}>
                <div className="panel-header">
                  <div>
                    <p className="route-kicker">Audit section</p>
                    <h2 id={section.id}>{section.title}</h2>
                  </div>
                </div>
                {section.summary ? <p className="triage-note">{section.summary}</p> : null}
                <dl className="detail-meta-grid">
                  {section.items.map((item) => (
                    <div key={`${section.id}-${item.label}`}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
