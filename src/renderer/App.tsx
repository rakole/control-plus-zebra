import {
  Activity,
  AlertCircle,
  Database,
  FolderKanban,
  LayoutDashboard
} from "lucide-react";
import { HashRouter, NavLink, useLocation } from "react-router";

import { ModeToggle } from "./components/app/mode-toggle.js";
import { WorkbenchShell } from "./components/app/workbench-shell.js";
import { WorkbenchTopbar } from "./components/app/workbench-topbar.js";
import { cn } from "./lib/utils.js";
import { RouteRegistry } from "./routes/route-registry.js";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, to: "/overview" },
  { label: "Projects", icon: FolderKanban, to: "/projects" },
  { label: "Data Sources", icon: Database, to: "/data-sources" },
  { label: "Sessions", icon: Activity, to: "/sessions" },
  { label: "Diagnostics", icon: AlertCircle, to: "/diagnostics" }
] as const;

export function App() {
  return (
    <HashRouter>
      <WorkbenchApp />
    </HashRouter>
  );
}

function WorkbenchApp() {
  const location = useLocation();
  const routeTitle = getRouteTitle(location.pathname);

  return (
    <WorkbenchShell
      navigation={
        <nav aria-label="Workbench navigation" className="flex flex-col gap-1">
          {navigation.map((item) => (
            <NavLink
              key={item.label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )
              }
              to={item.to}
            >
              <item.icon aria-hidden="true" className="size-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      }
      topbar={<WorkbenchTopbar actions={<ModeToggle />} title={routeTitle} />}
    >
      <RouteRegistry />
    </WorkbenchShell>
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
