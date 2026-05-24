import { HashRouter, Navigate, Route, Routes } from "react-router";

import { AppShell } from "./components/AppShell.js";
import { DataSourcesRoute } from "./routes/DataSourcesRoute.js";
import { DiagnosticsRoute } from "./routes/DiagnosticsRoute.js";
import { OverviewRoute } from "./routes/OverviewRoute.js";
import { ProjectsRoute } from "./routes/ProjectsRoute.js";
import { RunAuditRoute } from "./routes/RunAuditRoute.js";
import { SessionDetailRoute } from "./routes/SessionDetailRoute.js";
import { SessionsRoute } from "./routes/SessionsRoute.js";

export function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewRoute />} />
          <Route path="/projects" element={<ProjectsRoute />} />
          <Route path="/data-sources" element={<DataSourcesRoute />} />
          <Route path="/sessions" element={<SessionsRoute />} />
          <Route path="/sessions/:sessionId" element={<SessionDetailRoute />} />
          <Route path="/sessions/:sessionId/run-audit" element={<RunAuditRoute />} />
          <Route path="/diagnostics" element={<DiagnosticsRoute />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
