import { HashRouter, Navigate, Route, Routes } from "react-router";

import { AppShell } from "./components/AppShell.js";
import { DataSourcesRoute } from "./routes/DataSourcesRoute.js";
import { SessionsRoute } from "./routes/SessionsRoute.js";

export function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/data-sources" element={<DataSourcesRoute />} />
          <Route path="/sessions" element={<SessionsRoute />} />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
