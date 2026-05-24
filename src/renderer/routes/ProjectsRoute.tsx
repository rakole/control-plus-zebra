import { useEffect, useState } from "react";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { TruthStateBadge } from "../components/triage/TruthStateBadge.js";

type CreateArchiveResponse = Awaited<ReturnType<Window["agentWorkbench"]["createArchive"]>>;
type ProjectsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listProjects"]>>;
type ProjectSummary = Extract<ProjectsResponse, { ok: true }>["projects"][number];

const ERROR_COPY =
  "Projects could not load. Check the preload bridge and IPC handler, then reload triage data.";
const EXPORT_ERROR_COPY =
  "Archive export could not complete. Check the archive destination, current source data, and privacy options, then try the export again.";
const PRIVACY_WARNING_BODY =
  "Transcripts, sidecars, repo paths, and command output may contain sensitive local information. Export raw artifacts only when that data is intentionally shareable.";

export function ProjectsRoute() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [includeRawArtifacts, setIncludeRawArtifacts] = useState(false);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  async function handleExportProject() {
    if (!selectedProject) {
      return;
    }

    setExportError(null);
    setExportMessage(null);
    setIsExporting(true);

    try {
      const response: CreateArchiveResponse = await window.agentWorkbench.createArchive({
        scope:
          selectedProject.archiveExport.scopeKind === "project"
            ? { kind: "project", projectId: selectedProject.archiveExport.scopeId }
            : { kind: "session", sessionId: selectedProject.archiveExport.scopeId },
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

  function resetExportState() {
    setExportError(null);
    setExportMessage(null);
    setIncludeRawArtifacts(false);
    setIsExportPanelOpen(false);
    setIsExporting(false);
  }

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
                      onClick={() => {
                        resetExportState();
                        setSelectedProjectId(project.projectId);
                      }}
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
                        <TruthStateBadge state={project.githubStatus} />
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
                        <p className="detail-summary">
                          {selectedProject.observedHarnesses.join(", ")} · {selectedProject.sessionCount}{" "}
                          sessions
                        </p>
                      </div>
                      <div className="state-row">
                        <TruthStateBadge state={selectedProject.gitStatus} />
                        <TruthStateBadge state={selectedProject.githubStatus} />
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
                      <div>
                        <dt>Checks</dt>
                        <dd>{selectedProject.checks.displayValue}</dd>
                      </div>
                      <div>
                        <dt>Review / Merge</dt>
                        <dd>{selectedProject.reviewStatus.displayValue}</dd>
                      </div>
                    </dl>

                    <section className="preview-section" aria-labelledby="project-archive-export">
                      <div className="detail-heading">
                        <div>
                          <p className="route-kicker">Archive export</p>
                          <h3 id="project-archive-export">Archive Export</h3>
                        </div>
                        <button
                          className={isExportPanelOpen ? "secondary-button" : "primary-button"}
                          onClick={() => setIsExportPanelOpen((current) => !current)}
                          type="button"
                        >
                          Export Project Archive
                        </button>
                      </div>

                      <p className="detail-summary">
                        {selectedProject.archiveExport.scopeLabel} ·{" "}
                        {selectedProject.archiveExport.sessionCount} session
                        {selectedProject.archiveExport.sessionCount === 1 ? "" : "s"} across{" "}
                        {selectedProject.archiveExport.sourceCount} source
                        {selectedProject.archiveExport.sourceCount === 1 ? "" : "s"}.
                      </p>

                      {exportMessage ? <p className="detail-summary">{exportMessage}</p> : null}

                      {isExportPanelOpen ? (
                        <div className="export-panel">
                          <div className="pill-list">
                            <span className="metric-pill">Normalized Only</span>
                            {selectedProject.archiveExport.rawArtifactsAvailable ? (
                              <span className="metric-pill">
                                {selectedProject.archiveExport.rawArtifactCount} indexed raw artifacts
                              </span>
                            ) : null}
                          </div>

                          <label
                            className={`export-checkbox-row${
                              selectedProject.archiveExport.rawArtifactsAvailable
                                ? ""
                                : " export-checkbox-row-disabled"
                            }`}
                          >
                            <input
                              checked={includeRawArtifacts}
                              disabled={!selectedProject.archiveExport.rawArtifactsAvailable}
                              onChange={(event) => setIncludeRawArtifacts(event.target.checked)}
                              type="checkbox"
                            />
                            <span>Include Raw Artifacts</span>
                          </label>

                          <p className="detail-helper">
                            {selectedProject.archiveExport.rawArtifactsAvailable
                              ? `${selectedProject.archiveExport.rawArtifactCount} indexed raw artifacts are available for this archive scope.`
                              : selectedProject.archiveExport.rawArtifactsReason}
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
                              onClick={() => void handleExportProject()}
                              type="button"
                            >
                              {isExporting ? "Exporting..." : "Export Project Archive"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </section>
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
