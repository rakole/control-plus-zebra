import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { listDiagnostics } from "../../../bridge/agent-workbench.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { Toolbar } from "../../../components/app/toolbar.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { DiagnosticsGroups } from "../components/diagnostics-groups.js";

type DiagnosticsResponse = Awaited<ReturnType<typeof listDiagnostics>>;
type DiagnosticsView = Extract<DiagnosticsResponse, { ok: true }>["diagnostics"];

const ERROR_COPY =
  "Diagnostics could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function DiagnosticsRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAdapterId = searchParams.get("adapterId") ?? "all";
  const [diagnostics, setDiagnostics] = useState<DiagnosticsView | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setLoadFailed(false);
    setDiagnostics(null);

    listDiagnostics(selectedAdapterId === "all" ? {} : { adapterId: selectedAdapterId })
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setDiagnostics(response.diagnostics);
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
  }, [selectedAdapterId]);

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

  const groups = useMemo(() => {
    if (!diagnostics) {
      return [];
    }

    if (selectedSeverity === "all") {
      return diagnostics.groups;
    }

    return diagnostics.groups.filter((group) => group.severity === selectedSeverity);
  }, [diagnostics, selectedSeverity]);

  return (
    <RoutePage aria-label="Diagnostics route">
      <PageHeader
        eyebrow="Operator console"
        title="Diagnostics"
        description="Group shared adapter, source, normalization, cache, and capability findings without collapsing unsupported states."
        actions={
          <Toolbar ariaLabel="Diagnostics filters" className="justify-end">
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Harness</span>
              <NativeSelect
                aria-label="Harness"
                onChange={(event) => handleAdapterChange(event.target.value)}
                value={selectedAdapterId}
              >
                <option value="all">All Harnesses</option>
                {diagnostics?.harnessFilters.map((filter) => (
                  <option key={filter.adapterId} value={filter.adapterId}>
                    {filter.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Severity</span>
              <NativeSelect
                aria-label="Severity"
                onChange={(event) => setSelectedSeverity(event.target.value)}
                value={selectedSeverity}
              >
                <option value="all">All</option>
                {diagnostics?.severityFilters.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </Toolbar>
        }
      />

      {isLoading ? (
        <LoadingState
          title="Loading diagnostics"
          description="Reading grouped findings and current severity filters."
        />
      ) : null}

      {!isLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isLoading && !loadFailed && groups.length === 0 ? (
        <EmptyState title="No diagnostics match the current filters" />
      ) : null}

      {!isLoading && !loadFailed && groups.length > 0 ? (
        <DiagnosticsGroups groups={groups} />
      ) : null}
    </RoutePage>
  );
}
