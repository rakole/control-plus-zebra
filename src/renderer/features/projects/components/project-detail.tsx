import { ArchiveExportPanel } from "../../../components/app/archive-export-panel.js";
import { formatArchiveScopeSummary } from "../../../components/app/archive-export-format.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { StatusChipTooltip } from "../../../components/app/status-chip-tooltip.js";
import { getTruthTooltip } from "../../../components/app/status-chip-tooltips.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { isGithubUiEnabled } from "../../../../shared/feature-flags.js";
import { isGitHubHostedRemoteUrl } from "../../../../shared/github-ui.js";
import { TooltipProvider } from "../../../components/ui/tooltip.js";

type ProjectsResponse = Awaited<
  ReturnType<Window["agentWorkbench"]["listProjects"]>
>;
type ProjectSummary = Extract<
  ProjectsResponse,
  { ok: true }
>["projects"][number];

interface ProjectDetailProps {
  project: ProjectSummary | null;
  exportError: string | null;
  exportMessage: string | null;
  includeRawArtifacts: boolean;
  isExportPanelOpen: boolean;
  isExporting: boolean;
  onIncludeRawArtifactsChange(nextValue: boolean): void;
  onToggleExportPanel(): void;
  onExport(): void;
}

export function ProjectDetail({
  project,
  exportError,
  exportMessage,
  includeRawArtifacts,
  isExportPanelOpen,
  isExporting,
  onIncludeRawArtifactsChange,
  onToggleExportPanel,
  onExport,
}: ProjectDetailProps) {
  const githubUiEnabled = isGithubUiEnabled();

  if (!project) {
    return (
      <div className="flex h-full items-center p-4">
        <EmptyState
          title="Select a project to inspect repository truth."
          description={
            githubUiEnabled
              ? "Review git, GitHub, and archive-export coverage for the selected project."
              : "Review git and archive-export coverage for the selected project."
          }
        />
      </div>
    );
  }

  const truthBadges = [
    { key: "git", label: "Git status", state: project.gitStatus },
    ...(githubUiEnabled
      ? [{ key: "github", label: "GitHub status", state: project.githubStatus }]
      : []),
    { key: "dirty", label: "Dirty state", state: project.dirtyState },
  ].filter(({ state }) => state.label !== "Unknown");
  const metadataItems = [
    { label: "Repo Path", value: project.primaryRootPath.displayValue },
    {
      label: "Validated Repo Root",
      value: project.validatedRepoRoot.displayValue,
    },
    { label: "Branch", value: project.branch.displayValue },
    { label: "HEAD", value: project.head.displayValue },
    { label: "Changed Files", value: project.changedFiles.displayValue },
    { label: "Untracked Files", value: project.untrackedFiles.displayValue },
    { label: "Additions", value: project.additions.displayValue },
    { label: "Deletions", value: project.deletions.displayValue },
    ...((githubUiEnabled ||
      !isGitHubHostedRemoteUrl(project.remoteUrl.displayValue)) &&
    project.remoteUrl.displayValue !== "Unknown"
      ? [{ label: "Remote URL", value: project.remoteUrl.displayValue }]
      : []),
    ...(githubUiEnabled
      ? [
          { label: "Pull Request", value: project.pullRequest.displayValue },
          { label: "Checks", value: project.checks.displayValue },
          { label: "Review / Merge", value: project.reviewStatus.displayValue },
        ]
      : []),
  ];

  return (
    <TooltipProvider>
      <div className="h-full overflow-auto">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                Repository context
              </p>
              <h2 className="break-words text-lg font-semibold text-foreground">
                {project.projectDisplayName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {project.observedHarnesses.join(", ")} · {project.sessionCount}{" "}
                session
                {project.sessionCount === 1 ? "" : "s"}
              </p>
            </div>
            {truthBadges.length > 0 ? (
              <div className="flex flex-wrap justify-end gap-2">
                {truthBadges.map(({ key, label, state }) => {
                  const tooltip = getTruthTooltip(label, state);

                  return (
                    <StatusChipTooltip key={key} tooltip={tooltip}>
                      <TruthStateBadge state={state} tooltip={tooltip} />
                    </StatusChipTooltip>
                  );
                })}
              </div>
            ) : null}
          </div>

          <section aria-label="Repository Metadata">
            <SectionCard title={<h3>Repository Metadata</h3>}>
              <MetadataGrid items={metadataItems} />
            </SectionCard>
          </section>

          <section aria-label="Archive Export">
            <SectionCard title={<h3>Archive Export</h3>}>
              <ArchiveExportPanel
                summary={formatArchiveScopeSummary(
                  project.archiveExport.scopeLabel,
                  project.archiveExport.sessionCount,
                  project.archiveExport.sourceCount,
                )}
                toggleLabel="Export Project Archive"
                exportLabel="Export Project Archive"
                includeRawArtifacts={includeRawArtifacts}
                onIncludeRawArtifactsChange={onIncludeRawArtifactsChange}
                isOpen={isExportPanelOpen}
                onToggle={onToggleExportPanel}
                onExport={onExport}
                isExporting={isExporting}
                exportMessage={exportMessage}
                errorMessage={exportError}
                rawArtifactsAvailable={
                  project.archiveExport.rawArtifactsAvailable
                }
                rawArtifactCount={project.archiveExport.rawArtifactCount}
                rawArtifactsReason={project.archiveExport.rawArtifactsReason}
              />
            </SectionCard>
          </section>
        </div>
      </div>
    </TooltipProvider>
  );
}
