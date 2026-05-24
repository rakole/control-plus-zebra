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

const navigation = [
  { label: "Overview", icon: LayoutDashboard, to: "/overview" },
  { label: "Projects", icon: FolderKanban, to: "/projects" },
  { label: "Data Sources", icon: Database, to: "/data-sources" },
  { label: "Sessions", icon: Activity, to: "/sessions" },
  { label: "Diagnostics", icon: AlertCircle, to: "/diagnostics" }
] as const;

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const routeTitle = getRouteTitle(location.pathname);

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
          {navigation.map((item) => (
            <NavLink
              key={item.label}
              className={({ isActive }) =>
                isActive ? "nav-item nav-item-active" : "nav-item"
              }
              to={item.to}
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label}
            </NavLink>
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

function getRouteTitle(pathname: string): string {
  if (pathname.startsWith("/sessions/") && pathname.endsWith("/run-audit")) {
    return "Run Audit";
  }

  if (pathname.startsWith("/sessions/")) {
    return "Session Detail";
  }

  switch (pathname) {
    case "/overview":
      return "Overview";
    case "/projects":
      return "Projects";
    case "/data-sources":
      return "Data Sources";
    case "/diagnostics":
      return "Diagnostics";
    case "/sessions":
      return "Sessions";
    default:
      return "Overview";
  }
}
