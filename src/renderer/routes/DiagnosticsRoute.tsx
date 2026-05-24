import { useEffect, useMemo, useState } from "react";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { DiagnosticGroup } from "../components/triage/DiagnosticGroup.js";

type DiagnosticsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listDiagnostics"]>>;
type DiagnosticsView = Extract<DiagnosticsResponse, { ok: true }>["diagnostics"];

const ERROR_COPY =
  "Diagnostics could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function DiagnosticsRoute() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsView | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    window.agentWorkbench
      .listDiagnostics()
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
  }, []);

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
    <main className="route-shell" aria-labelledby="diagnostics-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Operator console</p>
          <h1 id="diagnostics-title">Diagnostics</h1>
        </div>
        <label className="filter-control">
          Severity
          <select
            onChange={(event) => setSelectedSeverity(event.target.value)}
            value={selectedSeverity}
          >
            <option value="all">All</option>
            {diagnostics?.severityFilters.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </label>
      </section>

      {isLoading ? <LoadingSkeleton /> : null}

      {!isLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
        </section>
      ) : null}

      {!isLoading && !loadFailed && groups.length === 0 ? (
        <section className="state-panel">
          <h2>No diagnostics match the current filters</h2>
        </section>
      ) : null}

      {!isLoading && !loadFailed && groups.length > 0 ? (
        <section className="triage-grid triage-grid-2" aria-label="Diagnostics route">
          {groups.map((group) => (
            <DiagnosticGroup group={group} key={group.groupId} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
