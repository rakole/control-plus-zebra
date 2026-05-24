import { Navigate, Route, Routes } from "react-router";

import { DataSourcesRoute } from "../features/data-sources/routes/data-sources-route.js";
import { DiagnosticsRoute } from "../features/diagnostics/routes/diagnostics-route.js";
import { OverviewRoute } from "../features/overview/routes/overview-route.js";
import { ProjectsRoute } from "../features/projects/routes/projects-route.js";
import { RunAuditRoute } from "../features/sessions/routes/run-audit-route.js";
import { SessionDetailRoute } from "../features/sessions/routes/session-detail-route.js";
import { SessionsRoute } from "../features/sessions/routes/sessions-route.js";

export function RouteRegistry() {
  return (
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
  );
}
