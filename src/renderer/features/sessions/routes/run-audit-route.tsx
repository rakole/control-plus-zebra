import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { createArchive, getRunAudit } from "../../../bridge/agent-workbench.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { Button } from "../../../components/ui/button.js";
import { RunAuditSections } from "../components/run-audit-sections.js";
import { RunAuditSummary } from "../components/run-audit-summary.js";
import type { RunAuditView, CreateArchiveResponse } from "../types.js";

const ERROR_COPY =
  "Run audit could not load. Check the preload bridge and IPC handler, then reload triage data.";
const EXPORT_ERROR_COPY =
  "Archive export could not complete. Check the archive destination, current source data, and privacy options, then try the export again.";

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

    getRunAudit({ sessionId })
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
      const response: CreateArchiveResponse = await createArchive({
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
    <RoutePage aria-label="Run audit route">
      <PageHeader
        actions={
          sessionId ? (
            <Button asChild type="button" variant="outline">
              <Link to={`/sessions/${sessionId}`}>Open Session Detail</Link>
            </Button>
          ) : null
        }
        eyebrow="Claim vs evidence"
        title="Run Audit"
      />

      {isLoading ? (
        <LoadingState
          title="Loading run audit"
          description="Reading claim-vs-evidence sections and archive export state."
        />
      ) : null}

      {!isLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isLoading && !loadFailed && runAudit ? (
        <div className="space-y-4">
          <RunAuditSummary
            runAudit={runAudit}
            exportError={exportError}
            exportMessage={exportMessage}
            includeRawArtifacts={includeRawArtifacts}
            isExportPanelOpen={isExportPanelOpen}
            isExporting={isExporting}
            onIncludeRawArtifactsChange={setIncludeRawArtifacts}
            onToggleExportPanel={() => setIsExportPanelOpen((current) => !current)}
            onExport={() => void handleExportSession()}
          />
          <RunAuditSections sections={runAudit.sections} />
        </div>
      ) : null}
    </RoutePage>
  );
}
