type DiagnosticsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listDiagnostics"]>>;
type DiagnosticGroupView = Extract<DiagnosticsResponse, { ok: true }>["diagnostics"]["groups"][number];

interface DiagnosticGroupProps {
  group: DiagnosticGroupView;
}

export function DiagnosticGroup({ group }: DiagnosticGroupProps) {
  return (
    <section className="triage-panel" aria-labelledby={group.groupId}>
      <div className="panel-header">
        <div>
          <p className="route-kicker">{group.sourceArea}</p>
          <h2 id={group.groupId}>{group.title}</h2>
        </div>
        <span className="metric-pill">{group.count}</span>
      </div>

      <div className="diagnostic-list">
        {group.diagnostics.map((diagnostic) => (
          <article className="diagnostic-row" key={`${diagnostic.code}-${diagnostic.message}`}>
            <div>
              <strong>{diagnostic.code}</strong>
              <p>{diagnostic.message}</p>
            </div>
            <div className="diagnostic-meta">
              <span>{diagnostic.adapterDisplayName}</span>
              {diagnostic.sessionTitle ? <span>{diagnostic.sessionTitle}</span> : null}
              <span>{diagnostic.severity}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
