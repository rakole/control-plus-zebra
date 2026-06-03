import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { createArchive, listHarnesses, listProjects } from "../../../bridge/agent-workbench.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { MasterDetailLayout } from "../../../components/app/master-detail-layout.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { Toolbar } from "../../../components/app/toolbar.js";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { ProjectDetail } from "../components/project-detail.js";
import { ProjectList } from "../components/project-list.js";

type CreateArchiveResponse = Awaited<ReturnType<typeof createArchive>>;
type ProjectsResponse = Awaited<ReturnType<typeof listProjects>>;
type ProjectSummary = Extract<ProjectsResponse, { ok: true }>["projects"][number];
type HarnessesResponse = Awaited<ReturnType<typeof listHarnesses>>;
type HarnessOption = Extract<HarnessesResponse, { ok: true }>["harnesses"][number];

const EMPTY_HEADING = "No projects available";
const EMPTY_BODY =
  "The workbench has not derived any project summaries yet. Scan a configured source, then reload triage data.";
const ERROR_COPY =
  "Projects could not load. Check the preload bridge and IPC handler, then reload triage data.";
const EXPORT_ERROR_COPY =
  "Archive export could not complete. Check the archive destination, current source data, and privacy options, then try the export again.";

export function ProjectsRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAdapterId = searchParams.get("adapterId") ?? "all";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [harnesses, setHarnesses] = useState<HarnessOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [includeRawArtifacts, setIncludeRawArtifacts] = useState(false);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);

    try {
      const [harnessResponse, response] = await Promise.all([
        listHarnesses(),
        listProjects(selectedAdapterId === "all" ? {} : { adapterId: selectedAdapterId })
      ]);

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      if (harnessResponse.ok) {
        setHarnesses(harnessResponse.harnesses);
      }
      setProjects(response.projects);
      setSelectedProjectId((current) => {
        if (current && response.projects.some((project) => project.projectId === current)) {
          return current;
        }

        return response.projects[0]?.projectId ?? null;
      });
    } catch {
      setProjects([]);
      setSelectedProjectId(null);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [selectedAdapterId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId]
  );

  function resetExportState() {
    setExportError(null);
    setExportMessage(null);
    setIncludeRawArtifacts(false);
    setIsExportPanelOpen(false);
    setIsExporting(false);
  }

  function handleAdapterChange(adapterId: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (adapterId === "all") {
        next.delete("adapterId");
      } else {
        next.set("adapterId", adapterId);
      }

      return next;
    });
  }

  async function handleExportProject() {
    if (!selectedProject) {
      return;
    }

    setExportError(null);
    setExportMessage(null);
    setIsExporting(true);

    try {
      const response: CreateArchiveResponse = await createArchive({
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

  return (
    <RoutePage aria-label="Projects route">
      <PageHeader
        eyebrow="Repository context"
        title="Projects"
        description="Keep shared git, GitHub, and archive-export truth visible across observed project summaries."
        actions={
          <div className="flex flex-wrap items-end justify-end gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Harness</span>
              <NativeSelect
                aria-label="Harness"
                onChange={(event) => handleAdapterChange(event.target.value)}
                value={selectedAdapterId}
              >
                <option value="all">All Harnesses</option>
                {harnesses.map((harness) => (
                  <option key={harness.adapterId} value={harness.adapterId}>
                    {harness.displayName}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button onClick={() => void loadProjects()} type="button" variant="outline">
              Reload Triage Data
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <LoadingState
          title="Loading projects"
          description="Reading project rollups, repository metadata, and archive-export coverage."
        />
      ) : null}

      {!isLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isLoading && !loadFailed && projects.length === 0 ? (
        <EmptyState title={EMPTY_HEADING} description={EMPTY_BODY} />
      ) : null}

      {!isLoading && !loadFailed && projects.length > 0 ? (
        <MasterDetailLayout
          masterLabel="Projects list"
          detailLabel="Selected project details"
          master={
            <ProjectList
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelect={(projectId) => {
                resetExportState();
                setSelectedProjectId(projectId);
              }}
            />
          }
          detail={
            <ProjectDetail
              project={selectedProject}
              exportError={exportError}
              exportMessage={exportMessage}
              includeRawArtifacts={includeRawArtifacts}
              isExportPanelOpen={isExportPanelOpen}
              isExporting={isExporting}
              onIncludeRawArtifactsChange={setIncludeRawArtifacts}
              onToggleExportPanel={() => setIsExportPanelOpen((current) => !current)}
              onExport={() => void handleExportProject()}
            />
          }
        />
      ) : null}
    </RoutePage>
  );
}
