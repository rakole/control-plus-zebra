import { Badge } from "../../../components/ui/badge.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { cn } from "../../../lib/utils.js";

type ProjectsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listProjects"]>>;
type ProjectSummary = Extract<ProjectsResponse, { ok: true }>["projects"][number];

interface ProjectListProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  onSelect(projectId: string): void;
}

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
          {projects.map((project) => {
            const isSelected = project.projectId === selectedProjectId;

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
                    <div className="flex max-w-[18rem] flex-wrap justify-end gap-1">
                      <TruthStateBadge state={project.latestRunAudit} />
                      <TruthStateBadge state={project.latestVerification} />
                      <TruthStateBadge state={project.gitStatus} />
                      <TruthStateBadge state={project.githubStatus} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">Branch {project.branch.displayValue}</Badge>
                    <Badge variant="outline">Dirty {project.dirtyState.label}</Badge>
                    <Badge variant="outline">PR {project.pullRequest.displayValue}</Badge>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
