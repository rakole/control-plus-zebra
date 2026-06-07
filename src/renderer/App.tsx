import {
  Activity,
  AlertCircle,
  Database,
  FolderKanban,
  LayoutDashboard,
  Settings
} from "lucide-react";
import * as React from "react";
import { HashRouter, useLocation } from "react-router";

import {
  getRetentionJobStatus,
  onRetentionJobStatusDispatched,
  onRetentionJobChanged,
  type RetentionJobStatus
} from "./bridge/settings.js";
import { AnimatedWorkbenchMenu } from "./components/app/animated-workbench-menu.js";
import { ModeToggle } from "./components/app/mode-toggle.js";
import { Spinner } from "./components/ui/spinner.js";
import { WorkbenchBrand } from "./components/app/workbench-brand.js";
import { WorkbenchShell } from "./components/app/workbench-shell.js";
import { WorkbenchTopbar } from "./components/app/workbench-topbar.js";
import { RouteRegistry } from "./routes/route-registry.js";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, to: "/overview" },
  { label: "Projects", icon: FolderKanban, to: "/projects" },
  { label: "Data Sources", icon: Database, to: "/data-sources" },
  { label: "Sessions", icon: Activity, to: "/sessions" },
  { label: "Diagnostics", icon: AlertCircle, to: "/diagnostics" },
  { label: "Settings", icon: Settings, to: "/settings" }
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
  const [retentionJob, setRetentionJob] = React.useState<RetentionJobStatus | null>(null);
  const [retentionJobHydrated, setRetentionJobHydrated] = React.useState(false);
  const routeTitle = getRouteTitle(location.pathname);
  const isMaintenanceBlocking = !retentionJobHydrated || isActiveRetentionJob(retentionJob);

  React.useEffect(() => {
    let mounted = true;

    void getRetentionJobStatus()
      .then((response) => {
        if (!mounted) {
          return;
        }

        if (response.ok) {
          setRetentionJob(response.job);
        }

        setRetentionJobHydrated(true);
      })
      .catch(() => {
        if (mounted) {
          setRetentionJobHydrated(true);
        }
      });

    const unsubscribe = onRetentionJobChanged((status) => {
      setRetentionJob(status);
      setRetentionJobHydrated(true);
    });
    const unsubscribeDispatched = onRetentionJobStatusDispatched((status) => {
      setRetentionJob(status);
      setRetentionJobHydrated(true);
    });

    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeDispatched();
    };
  }, []);

  return (
    <div className="relative" aria-busy={isMaintenanceBlocking}>
      <WorkbenchShell
        blocked={isMaintenanceBlocking}
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
                <ModeToggle disabled={isMaintenanceBlocking} />
              </div>
            </>
          </WorkbenchTopbar>
        }
      >
        <RouteRegistry />
      </WorkbenchShell>
      {isMaintenanceBlocking ? <RetentionMaintenanceOverlay job={retentionJob} hydrated={retentionJobHydrated} /> : null}
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
    case "/settings":
      return "Settings";
    default:
      return "Overview";
  }
}

function RetentionMaintenanceOverlay({
  job,
  hydrated
}: {
  job: RetentionJobStatus | null;
  hydrated: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const title = !hydrated
    ? "Checking Retention Status"
    : job?.state === "trimming"
      ? "Trimming Session Data"
      : "Refreshing Session Data";
  const message = !hydrated
    ? "Confirming whether session maintenance is already running."
    : job?.message ?? "Updating app-owned storage for the selected timeframe.";

  return (
    <div
      ref={containerRef}
      aria-labelledby="retention-maintenance-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-grayscale backdrop-blur-[2px]"
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-border/70 bg-card p-5 shadow-lg">
        <Spinner size="lg" className="mt-0.5" />
        <div className="min-w-0">
          <p id="retention-maintenance-title" className="text-sm font-semibold text-foreground">
            {title}
          </p>
          <p className="mt-1 text-xs/relaxed text-muted-foreground">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

function isActiveRetentionJob(job: RetentionJobStatus | null): boolean {
  return job?.state === "trimming" || job?.state === "clearing" || job?.state === "rescanning";
}
