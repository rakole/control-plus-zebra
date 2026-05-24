import { ArchiveExportPanel } from "../../../components/app/archive-export-panel.js";
import { formatArchiveScopeSummary } from "../../../components/app/archive-export-format.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import type { RunAuditView } from "../types.js";

interface RunAuditSummaryProps {
  runAudit: RunAuditView;
  exportError: string | null;
  exportMessage: string | null;
  includeRawArtifacts: boolean;
  isExportPanelOpen: boolean;
  isExporting: boolean;
  onIncludeRawArtifactsChange(nextValue: boolean): void;
  onToggleExportPanel(): void;
  onExport(): void;
}

export function RunAuditSummary({
  runAudit,
  exportError,
  exportMessage,
  includeRawArtifacts,
  isExportPanelOpen,
  isExporting,
  onIncludeRawArtifactsChange,
  onToggleExportPanel,
  onExport
}: RunAuditSummaryProps) {
  return (
    <SectionCard
      aria-label="Run audit summary"
      title={runAudit.session.title}
      description={runAudit.session.adapterDisplayName}
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <TruthStateBadge state={runAudit.session.runAuditState} />
          <TruthStateBadge state={runAudit.session.verificationState} />
        </div>
      }
      contentClassName="space-y-4"
    >
      <ArchiveExportPanel
        summary={formatArchiveScopeSummary(
          runAudit.archiveExport.scopeLabel,
          runAudit.archiveExport.sessionCount,
          runAudit.archiveExport.sourceCount
        )}
        toggleLabel="Export Session Archive"
        exportLabel="Export Session Archive"
        includeRawArtifacts={includeRawArtifacts}
        onIncludeRawArtifactsChange={onIncludeRawArtifactsChange}
        isOpen={isExportPanelOpen}
        onToggle={onToggleExportPanel}
        onExport={onExport}
        isExporting={isExporting}
        exportMessage={exportMessage}
        errorMessage={exportError}
        rawArtifactsAvailable={runAudit.archiveExport.rawArtifactsAvailable}
        rawArtifactCount={runAudit.archiveExport.rawArtifactCount}
        rawArtifactsReason={runAudit.archiveExport.rawArtifactsReason}
      />
    </SectionCard>
  );
}
