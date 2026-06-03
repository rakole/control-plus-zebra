import {
  Activity,
  AlertCircle,
  Database,
  FolderKanban,
  LayoutDashboard
} from "lucide-react";
import * as React from "react";
import { HashRouter, useLocation } from "react-router";

import { AnimatedWorkbenchMenu } from "./components/app/animated-workbench-menu.js";
import { ModeToggle } from "./components/app/mode-toggle.js";
import { WorkbenchBrand } from "./components/app/workbench-brand.js";
import { WorkbenchShell } from "./components/app/workbench-shell.js";
import { WorkbenchTopbar } from "./components/app/workbench-topbar.js";
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
  const [isMenuMinimized, setIsMenuMinimized] = React.useState(false);
  const routeTitle = getRouteTitle(location.pathname);

  return (
    <WorkbenchShell
      navigation={<AnimatedWorkbenchMenu items={navigation} minimized={isMenuMinimized} />}
      onSidebarMinimizedChange={setIsMenuMinimized}
      sidebarMinimized={isMenuMinimized}
      sidebarHeader={<WorkbenchBrand minimized={isMenuMinimized} />}
      topbar={
        <WorkbenchTopbar>
          <>
            <div className="flex min-w-0 items-center gap-3">
              <WorkbenchBrand aria-hidden="true" minimized showCaption={false} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{routeTitle}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Zebra mark preview in app chrome
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModeToggle />
            </div>
          </>
        </WorkbenchTopbar>
      }
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
