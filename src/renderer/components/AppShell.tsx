import {
  Activity,
  AlertCircle,
  FolderKanban,
  LayoutDashboard
} from "lucide-react";
import { NavLink } from "react-router";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
  routeTitle?: string;
}

const disabledNavigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Projects", icon: FolderKanban },
  { label: "Diagnostics", icon: AlertCircle }
] as const;

export function AppShell({ children, routeTitle = "Sessions" }: AppShellProps) {
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
          <p>{routeTitle}</p>
        </header>
        {children}
      </div>
    </div>
  );
}
