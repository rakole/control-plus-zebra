import { useEffect, useState } from "react";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { TruthStateBadge } from "../components/triage/TruthStateBadge.js";

type ProjectsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listProjects"]>>;
type ProjectSummary = Extract<ProjectsResponse, { ok: true }>["projects"][number];

const ERROR_COPY =
  "Projects could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function ProjectsRoute() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    window.agentWorkbench
      .listProjects()
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setProjects(response.projects);
        setSelectedProjectId((current) => {
          if (current && response.projects.some((project) => project.projectId === current)) {
            return current;
          }

          return response.projects[0]?.projectId ?? null;
        });
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

  const selectedProject =
    projects.find((project) => project.projectId === selectedProjectId) ?? projects[0] ?? null;

  return (
    <main className="route-shell" aria-labelledby="projects-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Repository context</p>
          <h1 id="projects-title">Projects</h1>
        </div>
      </section>

      {isLoading ? <LoadingSkeleton /> : null}

      {!isLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
        </section>
      ) : null}

      {!isLoading && !loadFailed ? (
        <>
          {projects.length > 0 ? (
            <section className="sessions-grid" aria-label="Projects route">
              <section className="session-list" aria-label="Projects list">
                {projects.map((project) => {
                  const selected = project.projectId === selectedProject?.projectId;

                  return (
                    <button
                      className={`session-row${selected ? " session-row-selected" : ""}`}
                      key={project.projectId}
                      onClick={() => setSelectedProjectId(project.projectId)}
                      type="button"
                    >
                      <div className="session-row-main">
                        <h2 className="session-title">{project.projectName}</h2>
                        <p className="session-meta">{project.repoPath.displayValue}</p>
                        <p className="session-meta">
                          {project.observedHarnesses.join(", ")} · {project.sessionCount} sessions
                        </p>
                      </div>
                      <div className="session-row-badges">
                        <TruthStateBadge state={project.latestRunAudit} />
                        <TruthStateBadge state={project.latestVerification} />
                        <TruthStateBadge state={project.gitStatus} />
                        <span className="metric-pill">Branch {project.branch.displayValue}</span>
                        <span className="metric-pill">Dirty {project.dirtyState.label}</span>
                        <span className="metric-pill">PR {project.pullRequest.displayValue}</span>
                      </div>
                    </button>
                  );
                })}
              </section>

              <section className="preview-panel" aria-label="Selected project details">
                {selectedProject ? (
                  <>
                    <div className="preview-heading">
                      <div>
                        <p className="route-kicker">Repository context</p>
                        <h2>{selectedProject.projectName}</h2>
                      </div>
                      <div className="state-row">
                        <TruthStateBadge state={selectedProject.gitStatus} />
                        <TruthStateBadge state={selectedProject.dirtyState} />
                      </div>
                    </div>

                    <dl className="preview-meta-grid">
                      <div>
                        <dt>Repo Path</dt>
                        <dd>{selectedProject.repoPath.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Validated Repo Root</dt>
                        <dd>{selectedProject.validatedRepoRoot.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Branch</dt>
                        <dd>{selectedProject.branch.displayValue}</dd>
                      </div>
                      <div>
                        <dt>HEAD</dt>
                        <dd>{selectedProject.head.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Changed Files</dt>
                        <dd>{selectedProject.changedFiles.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Untracked Files</dt>
                        <dd>{selectedProject.untrackedFiles.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Additions</dt>
                        <dd>{selectedProject.additions.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Deletions</dt>
                        <dd>{selectedProject.deletions.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Remote URL</dt>
                        <dd>{selectedProject.remoteUrl.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Pull Request</dt>
                        <dd>{selectedProject.pullRequest.displayValue}</dd>
                      </div>
                    </dl>
                  </>
                ) : null}
              </section>
            </section>
          ) : (
            <section className="state-panel">
              <div className="preview-empty">
                <h2>No project context available yet</h2>
                <p className="detail-helper">
                  Scan a local harness source or import an archive to populate project-level git,
                  GitHub, and audit summaries.
                </p>
              </div>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
