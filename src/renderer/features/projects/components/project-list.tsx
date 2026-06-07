import { Badge } from "../../../components/ui/badge.js";
import { StatusChipTooltip } from "../../../components/app/status-chip-tooltip.js";
import {
  getFieldTooltip,
  getTruthTooltip
} from "../../../components/app/status-chip-tooltips.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { isGithubUiEnabled } from "../../../../shared/feature-flags.js";
import { TooltipProvider } from "../../../components/ui/tooltip.js";
import { cn } from "../../../lib/utils.js";

type ProjectsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listProjects"]>>;
type ProjectSummary = Extract<ProjectsResponse, { ok: true }>["projects"][number];
type ProjectTruthState = ProjectSummary["latestRunAudit"];
type ProjectFieldValue = ProjectSummary["branch"];

interface ProjectListProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  onSelect(projectId: string): void;
}

function shouldShowTruthState(state: ProjectTruthState): boolean {
  return state.label !== "Unknown";
}

function shouldShowFieldValue(field: ProjectFieldValue): boolean {
  return field.status !== "unknown" && field.displayValue !== "Unknown";
}

function getDirtyFieldValue(state: ProjectTruthState): ProjectFieldValue {
  const status =
    state.label === "Unknown" ? "unknown" : state.label === "Unsupported" ? "unsupported" : "value";

  return {
    status,
    displayValue: state.label,
    ...(state.reason ? { reason: state.reason } : {})
  };
}

const githubUiEnabled = isGithubUiEnabled();

export function ProjectList({
  projects,
  selectedProjectId,
  onSelect
}: ProjectListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Projects</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Compare shared repository truth, recent harness coverage, and current archive scope.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-2 p-3">
          <TooltipProvider>
            {projects.map((project) => {
              const isSelected = project.projectId === selectedProjectId;
              const truthBadges = [
                { key: "run-audit", label: "Run audit status", state: project.latestRunAudit },
                {
                  key: "verification",
                  label: "Verification status",
                  state: project.latestVerification
                },
                { key: "git", label: "Git status", state: project.gitStatus },
                ...(githubUiEnabled
                  ? [{ key: "github", label: "GitHub status", state: project.githubStatus }]
                  : [])
              ].filter(({ state }) => shouldShowTruthState(state));
              const metadataBadges = [
                {
                  key: "branch",
                  label: "Branch",
                  field: project.branch,
                  content: `Branch ${project.branch.displayValue}`
                },
                {
                  key: "dirty",
                  label: "Dirty state",
                  field: getDirtyFieldValue(project.dirtyState),
                  content: `Dirty ${project.dirtyState.label}`
                },
                ...(githubUiEnabled
                  ? [
                      {
                        key: "pull-request",
                        label: "Pull request",
                        field: project.pullRequest,
                        content: `PR ${project.pullRequest.displayValue}`
                      }
                    ]
                  : [])
              ].filter(({ field }) => shouldShowFieldValue(field));

              return (
                <button
                  key={project.projectId}
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:bg-muted/30"
                  )}
                  onClick={() => onSelect(project.projectId)}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {project.projectDisplayName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {project.primaryRootPath.displayValue}
                        </p>
                        <p className="text-xs/relaxed text-muted-foreground">
                          {project.observedHarnesses.join(", ")} · {project.sessionCount} session
                          {project.sessionCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      {truthBadges.length > 0 ? (
                        <div className="flex max-w-[18rem] flex-wrap justify-end gap-1">
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

                    {metadataBadges.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {metadataBadges.map(({ key, label, field, content }) => {
                          const tooltip = getFieldTooltip(label, field);

                          return (
                            <StatusChipTooltip key={key} tooltip={tooltip}>
                              <Badge variant="outline" title={tooltip}>
                                {content}
                              </Badge>
                            </StatusChipTooltip>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}
