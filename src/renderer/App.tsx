import {
  Activity,
  AlertCircle,
  FolderKanban,
  LayoutDashboard
} from "lucide-react";
import { HashRouter, Navigate, NavLink, Route, Routes } from "react-router";

const disabledNavigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Projects", icon: FolderKanban },
  { label: "Diagnostics", icon: AlertCircle }
] as const;

function SessionsRoute() {
  return (
    <main className="route-shell" aria-labelledby="sessions-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Local desktop shell</p>
          <h1 id="sessions-title">Sessions</h1>
        </div>
        <span className="status-badge">Bridge pending</span>
      </section>

      <section className="sessions-grid" aria-label="Sessions route preview">
        <div className="session-list" aria-label="Session summaries">
          <div className="session-row session-row-selected">
            <div>
              <p className="session-title">Session summaries route</p>
              <p className="session-meta">View-model data lands in a later plan</p>
            </div>
            <span className="truth-badge">Unknown</span>
          </div>
          <div className="session-row">
            <div>
              <p className="session-title">Harness capability state</p>
              <p className="session-meta">Unsupported evidence remains explicit</p>
            </div>
            <span className="truth-badge">Unsupported</span>
          </div>
        </div>

        <aside className="preview-panel" aria-label="Selected session preview">
          <p className="preview-label">Selected preview</p>
          <h2>Select a session to inspect its summary.</h2>
          <p>
            The secure desktop shell is ready for the typed bridge and sanitized
            Sessions view models.
          </p>
        </aside>
      </section>
    </main>
  );
}

function WorkbenchChrome() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workbench navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            AW
          </span>
          <span>Agent Workbench</span>
        </div>
        <nav className="nav-list">
          {disabledNavigation.slice(0, 2).map((item) => (
            <span
              key={item.label}
              className="nav-item nav-item-disabled"
              aria-disabled="true"
              title="Available in a later phase"
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label}
            </span>
          ))}
          <NavLink className="nav-item nav-item-active" to="/sessions">
            <Activity size={18} aria-hidden="true" />
            Sessions
          </NavLink>
          {disabledNavigation.slice(2).map((item) => (
            <span
              key={item.label}
              className="nav-item nav-item-disabled"
              aria-disabled="true"
              title="Available in a later phase"
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </nav>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <p>Sessions</p>
        </header>
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsRoute />} />
        </Routes>
      </div>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <WorkbenchChrome />
    </HashRouter>
  );
}
