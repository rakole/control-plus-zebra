import {
  Activity,
  AlertCircle,
  Database,
  FolderKanban,
  LayoutDashboard
} from "lucide-react";
import { NavLink, useLocation } from "react-router";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

const disabledNavigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Projects", icon: FolderKanban },
  { label: "Diagnostics", icon: AlertCircle }
] as const;

const routeTitles: Record<string, string> = {
  "/data-sources": "Data Sources",
  "/sessions": "Sessions"
};

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const routeTitle = routeTitles[location.pathname] ?? "Sessions";

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
          <NavLink
            className={({ isActive }) =>
              isActive ? "nav-item nav-item-active" : "nav-item"
            }
            to="/data-sources"
          >
            <Database size={18} aria-hidden="true" />
            Data Sources
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "nav-item nav-item-active" : "nav-item"
            }
            to="/sessions"
          >
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
          <p>{routeTitle}</p>
        </header>
        {children}
      </div>
    </div>
  );
}
