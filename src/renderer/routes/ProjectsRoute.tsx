import { useEffect, useState } from "react";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { TruthStateBadge } from "../components/triage/TruthStateBadge.js";

type ProjectsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listProjects"]>>;
type ProjectSummary = Extract<ProjectsResponse, { ok: true }>["projects"][number];

const ERROR_COPY =
  "Projects could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function ProjectsRoute() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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

  return (
    <main className="route-shell" aria-labelledby="projects-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Cross-harness rollups</p>
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
        <section className="triage-table" aria-label="Projects table">
          {projects.map((project) => (
            <article className="triage-row" key={project.projectId}>
              <div>
                <h2>{project.projectName}</h2>
                <p className="session-meta">{project.repoPath.displayValue}</p>
                <p className="triage-note">
                  {project.observedHarnesses.join(", ")} · {project.sessionCount} sessions
                </p>
              </div>
              <div className="triage-row-side">
                <TruthStateBadge state={project.latestRunAudit} />
                <TruthStateBadge state={project.latestVerification} />
                <span className="metric-pill">Branch {project.branch.displayValue}</span>
                <span className="metric-pill">HEAD {project.head.displayValue}</span>
                <span className="metric-pill">Dirty {project.dirtyState.label}</span>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
