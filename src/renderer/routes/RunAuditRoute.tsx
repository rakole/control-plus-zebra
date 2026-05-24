import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { TruthStateBadge } from "../components/triage/TruthStateBadge.js";

type CreateArchiveResponse = Awaited<ReturnType<Window["agentWorkbench"]["createArchive"]>>;
type RunAuditResponse = Awaited<ReturnType<Window["agentWorkbench"]["getRunAudit"]>>;
type RunAuditView = NonNullable<Extract<RunAuditResponse, { ok: true }>["runAudit"]>;

const ERROR_COPY =
  "Run audit could not load. Check the preload bridge and IPC handler, then reload triage data.";
const EXPORT_ERROR_COPY =
  "Archive export could not complete. Check the archive destination, current source data, and privacy options, then try the export again.";
const PRIVACY_WARNING_BODY =
  "Transcripts, sidecars, repo paths, and command output may contain sensitive local information. Export raw artifacts only when that data is intentionally shareable.";

export function RunAuditRoute() {
  const { sessionId } = useParams();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [includeRawArtifacts, setIncludeRawArtifacts] = useState(false);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  async function handleExportSession() {
    if (!runAudit) {
      return;
    }

    setExportError(null);
    setExportMessage(null);
    setIsExporting(true);

    try {
      const response: CreateArchiveResponse = await window.agentWorkbench.createArchive({
        scope: { kind: "session", sessionId: runAudit.archiveExport.scopeId },
        includeRawArtifacts,
        privacyWarningAcknowledged: true
      });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      if (response.archive.status === "exported") {
        setExportMessage(`Archive saved to ${response.archive.archivePath}`);
        setIsExportPanelOpen(false);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : EXPORT_ERROR_COPY);
    } finally {
      setIsExporting(false);
    }
  }

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
                <p className="detail-summary">
                  {runAudit.archiveExport.scopeLabel} · {runAudit.archiveExport.sessionCount} session
                  {runAudit.archiveExport.sessionCount === 1 ? "" : "s"} across{" "}
                  {runAudit.archiveExport.sourceCount} source
                  {runAudit.archiveExport.sourceCount === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="state-row">
                <TruthStateBadge state={runAudit.session.runAuditState} />
                <TruthStateBadge state={runAudit.session.verificationState} />
              </div>
            </div>
            <div className="detail-actions export-action-row">
              <button
                className={isExportPanelOpen ? "secondary-button" : "primary-button"}
                onClick={() => setIsExportPanelOpen((current) => !current)}
                type="button"
              >
                Export Session Archive
              </button>
            </div>

            {exportMessage ? <p className="detail-summary">{exportMessage}</p> : null}

            {isExportPanelOpen ? (
              <div className="export-panel">
                <div className="pill-list">
                  <span className="metric-pill">Normalized Only</span>
                  {runAudit.archiveExport.rawArtifactsAvailable ? (
                    <span className="metric-pill">
                      {runAudit.archiveExport.rawArtifactCount} indexed raw artifacts
                    </span>
                  ) : null}
                </div>

                <label
                  className={`export-checkbox-row${
                    runAudit.archiveExport.rawArtifactsAvailable
                      ? ""
                      : " export-checkbox-row-disabled"
                  }`}
                >
                  <input
                    checked={includeRawArtifacts}
                    disabled={!runAudit.archiveExport.rawArtifactsAvailable}
                    onChange={(event) => setIncludeRawArtifacts(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Include Raw Artifacts</span>
                </label>

                <p className="detail-helper">
                  {runAudit.archiveExport.rawArtifactsAvailable
                    ? `${runAudit.archiveExport.rawArtifactCount} indexed raw artifacts are available for this archive scope.`
                    : runAudit.archiveExport.rawArtifactsReason}
                </p>

                <section className="export-warning" aria-label="Export privacy warning">
                  <h4>Raw artifacts may include sensitive local data</h4>
                  <p>{PRIVACY_WARNING_BODY}</p>
                </section>

                {exportError ? (
                  <div className="detail-alert" role="alert">
                    <p>{exportError}</p>
                  </div>
                ) : null}

                <div className="detail-actions">
                  <button
                    className="primary-button"
                    disabled={isExporting}
                    onClick={() => void handleExportSession()}
                    type="button"
                  >
                    {isExporting ? "Exporting..." : "Export Session Archive"}
                  </button>
                </div>
              </div>
            ) : null}
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
                      {item.hint ? <p className="detail-helper">{item.hint}</p> : null}
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
