import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rendererRoot = path.join(repoRoot, "src", "renderer");
const appComponentsRoot = path.join(rendererRoot, "components", "app");

const requiredAppComposites = [
  { exportName: "WorkbenchShell", file: "workbench-shell.tsx" },
  { exportName: "WorkbenchSidebar", file: "workbench-sidebar.tsx" },
  { exportName: "WorkbenchTopbar", file: "workbench-topbar.tsx" },
  { exportName: "ModeToggle", file: "mode-toggle.tsx" },
  { exportName: "RoutePage", file: "route-page.tsx" },
  { exportName: "PageHeader", file: "page-header.tsx" },
  { exportName: "PageActions", file: "page-actions.tsx" },
  { exportName: "GradientDots", file: "gradient-dots.tsx" },
  { exportName: "MasterDetailLayout", file: "master-detail-layout.tsx" },
  { exportName: "EmptyState", file: "empty-state.tsx" },
  { exportName: "ErrorState", file: "error-state.tsx" },
  { exportName: "LoadingState", file: "loading-state.tsx" },
  { exportName: "StatusBadge", file: "status-badge.tsx" },
  { exportName: "TruthStateBadge", file: "truth-state-badge.tsx" },
  { exportName: "CapabilityBadge", file: "capability-badge.tsx" },
  { exportName: "SourceStateBadge", file: "source-state-badge.tsx" },
  { exportName: "MetricCard", file: "metric-card.tsx" },
  { exportName: "MetricGrid", file: "metric-grid.tsx" },
  { exportName: "MetadataGrid", file: "metadata-grid.tsx" },
  { exportName: "DiagnosticsList", file: "diagnostics-list.tsx" },
  { exportName: "Timeline", file: "timeline.tsx" },
  { exportName: "Toolbar", file: "toolbar.tsx" },
  { exportName: "SectionCard", file: "section-card.tsx" }
] as const;

const statusToneMappings = [
  ["neutral", "status-neutral"],
  ["success", "status-success"],
  ["warning", "status-warning"],
  ["danger", "status-danger"],
  ["info", "status-info"],
  ["unsupported", "status-unsupported"],
  ["destructive", "destructive"]
] as const;

const componentLoaders = {
  WorkbenchShell: () => importRendererModule("src/renderer/components/app/workbench-shell.js"),
  RoutePage: () => importRendererModule("src/renderer/components/app/route-page.js"),
  PageHeader: () => importRendererModule("src/renderer/components/app/page-header.js"),
  MasterDetailLayout: () =>
    importRendererModule("src/renderer/components/app/master-detail-layout.js"),
  EmptyState: () => importRendererModule("src/renderer/components/app/empty-state.js"),
  ErrorState: () => importRendererModule("src/renderer/components/app/error-state.js"),
  LoadingState: () => importRendererModule("src/renderer/components/app/loading-state.js"),
  StatusBadge: () => importRendererModule("src/renderer/components/app/status-badge.js"),
  MetricCard: () => importRendererModule("src/renderer/components/app/metric-card.js"),
  MetadataGrid: () => importRendererModule("src/renderer/components/app/metadata-grid.js"),
  DiagnosticsList: () => importRendererModule("src/renderer/components/app/diagnostics-list.js")
} as const;

afterEach(() => {
  cleanup();
});

describe("renderer app composite inventory ratchets", () => {
  it("keeps the required app composite file inventory under src/renderer/components/app", async () => {
    const files = await readdir(appComponentsRoot);

    expect(files).toEqual(
      expect.arrayContaining(requiredAppComposites.map((component) => component.file))
    );
  });

  it("exports the required named app composites from their source modules", async () => {
    const missingExports: string[] = [];

    for (const component of requiredAppComposites) {
      const source = await readFile(path.join(appComponentsRoot, component.file), "utf8");

      if (!hasNamedExport(source, component.exportName)) {
        missingExports.push(`${component.file}:${component.exportName}`);
      }
    }

    expect(missingExports).toEqual([]);
  });

  it("maps StatusBadge tones through shared status token utilities", async () => {
    const statusBadgeSource = await readFile(path.join(appComponentsRoot, "status-badge.tsx"), "utf8");
    const utilitySources = await findStatusTokenUtilitySources();

    expect(statusBadgeSource).toMatch(/from\s+["'][^"']*status[^"']*["']/u);
    expect(utilitySources.map((source) => source.file)).not.toEqual([]);
    expect(statusBadgeSource).not.toMatch(
      /\b(?:capability-badge|source-status-badge|truth-badge|status-badge-neutral)\b/u
    );

    for (const [tone, token] of statusToneMappings) {
      expect(statusBadgeSource).toMatch(new RegExp(`\\b${tone}\\b`, "u"));

      const hasTokenUtility = utilitySources.some((source) => source.text.includes(token));
      expect(hasTokenUtility, `missing status token utility for ${token}`).toBe(true);
    }
  });
});

describe("renderer app composite behavior contracts", () => {
  it("renders WorkbenchShell as the accessible workbench frame", async () => {
    const WorkbenchShell = await loadComponent("WorkbenchShell");

    render(
      <WorkbenchShell
        navigation={
          <nav aria-label="Workbench navigation">
            <a href="#/overview">Overview</a>
            <a href="#/sessions" aria-current="page">
              Sessions
            </a>
          </nav>
        }
        topbar={<header aria-label="Workbench topbar">Ctr + Zebra</header>}
      >
        <section aria-label="Route content">
          <h1>Sessions</h1>
          <p>Observed local agent runs.</p>
        </section>
      </WorkbenchShell>
    );

    expect(screen.getByRole("banner", { name: "Workbench topbar" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Workbench navigation" });
    expect(within(navigation).getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Sessions" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("main")).toHaveTextContent("Observed local agent runs.");
  });

  it("wires the animated background into WorkbenchShell source", async () => {
    const source = await readFile(path.join(appComponentsRoot, "workbench-shell.tsx"), "utf8");

    expect(source).toMatch(/from\s+["'][^"']*gradient-dots[^"']*["']/u);
    expect(source).toMatch(/<GradientDots/u);
  });

  it("renders PageHeader with an eyebrow, heading, and actions", async () => {
    const PageHeader = await loadComponent("PageHeader");

    render(
      <PageHeader
        eyebrow="Local workbench"
        title="Sessions"
        description="Observe normalized sessions and their verification evidence."
        actions={<button type="button">Reload Triage Data</button>}
      />
    );

    expect(screen.getByText("Local workbench")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(
      screen.getByText("Observe normalized sessions and their verification evidence.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Triage Data" })).toBeInTheDocument();
  });

  it("renders RoutePage as a labeled route surface", async () => {
    const RoutePage = await loadComponent("RoutePage");

    render(
      <RoutePage aria-label="Sessions route">
        <h1>Sessions</h1>
        <p>Route content stays inside the reusable page shell.</p>
      </RoutePage>
    );

    const route = screen.getByRole("region", { name: "Sessions route" });
    expect(within(route).getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(within(route).getByText("Route content stays inside the reusable page shell.")).toBeInTheDocument();
  });

  it("renders MasterDetailLayout as labeled master/detail regions", async () => {
    const MasterDetailLayout = await loadComponent("MasterDetailLayout");

    render(
      <MasterDetailLayout
        masterLabel="Sessions list"
        detailLabel="Session detail"
        master={<div>Session 1</div>}
        detail={<div>Completion claim vs evidence</div>}
      />
    );

    expect(screen.getByRole("region", { name: "Sessions list" })).toHaveTextContent("Session 1");
    expect(screen.getByRole("region", { name: "Session detail" })).toHaveTextContent(
      "Completion claim vs evidence"
    );
  });

  it("keeps master-detail panel defaults expressed as percentages", async () => {
    const source = await readFile(path.join(appComponentsRoot, "master-detail-layout.tsx"), "utf8");

    expect(source).toMatch(/defaultMasterSize = "38%"/u);
    expect(source).toMatch(/minSize="24%"/u);
    expect(source).toMatch(/minSize="30%"/u);
  });

  it("renders EmptyState without using an alert role", async () => {
    const EmptyState = await loadComponent("EmptyState");

    render(
      <EmptyState
        title="No sessions available"
        description="Load a source to review local coding-agent runs."
        action={<button type="button">Open Data Sources</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "No sessions available" })).toBeInTheDocument();
    expect(screen.getByText("Load a source to review local coding-agent runs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Data Sources" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders ErrorState as an alert with recovery action", async () => {
    const ErrorState = await loadComponent("ErrorState");

    render(
      <ErrorState
        title="Unable to load sessions"
        description="Retry after the preload bridge recovers."
        action={<button type="button">Retry</button>}
      />
    );

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Unable to load sessions" })).toBeInTheDocument();
    expect(within(alert).getByText("Retry after the preload bridge recovers.")).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders LoadingState through an accessible status surface", async () => {
    const LoadingState = await loadComponent("LoadingState");

    render(
      <LoadingState
        title="Loading sessions"
        description="Reading the latest normalized session summaries."
      />
    );

    const status = screen.getByRole("status");
    expect(within(status).getByText("Loading sessions")).toBeInTheDocument();
    expect(within(status).getByText("Reading the latest normalized session summaries.")).toBeInTheDocument();
  });

  it("renders StatusBadge across every supported tone", async () => {
    const StatusBadge = await loadComponent("StatusBadge");

    for (const [tone] of statusToneMappings) {
      const label = `${tone} status`;
      const { unmount } = render(<StatusBadge tone={tone}>{label}</StatusBadge>);

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders MetricCard as a labeled metric surface", async () => {
    const MetricCard = await loadComponent("MetricCard");

    render(
      <MetricCard
        label="Completed Sessions"
        value="18"
        supportingText="6 runs still need review."
      />
    );

    const metric = screen.getByRole("group", { name: "Completed Sessions" });
    expect(within(metric).getByText("18")).toBeInTheDocument();
    expect(within(metric).getByText("6 runs still need review.")).toBeInTheDocument();
  });

  it("renders MetadataGrid as a labeled metadata region", async () => {
    const MetadataGrid = await loadComponent("MetadataGrid");

    render(
      <MetadataGrid
        title="Session metadata"
        items={[
          { label: "Harness", value: "Gemini CLI" },
          { label: "Branch", value: "main" }
        ]}
      />
    );

    const metadata = screen.getByRole("region", { name: "Session metadata" });
    expect(within(metadata).getByText("Harness")).toBeInTheDocument();
    expect(within(metadata).getByText("Gemini CLI")).toBeInTheDocument();
    expect(within(metadata).getByText("Branch")).toBeInTheDocument();
    expect(within(metadata).getByText("main")).toBeInTheDocument();
  });

  it("renders DiagnosticsList as a titled list of diagnostics", async () => {
    const DiagnosticsList = await loadComponent("DiagnosticsList");

    render(
      <DiagnosticsList
        title="Parser diagnostics"
        diagnostics={[
          {
            id: "warning-normalized",
            severity: "warning",
            message: "One transcript emitted a non-blocking parser warning."
          },
          {
            id: "error-missing-sidecar",
            severity: "error",
            message: "Missing sidecar metadata prevented classification."
          }
        ]}
      />
    );

    const list = screen.getByRole("list", { name: "Parser diagnostics" });
    expect(within(list).getByText("One transcript emitted a non-blocking parser warning.")).toBeInTheDocument();
    expect(within(list).getByText("Missing sidecar metadata prevented classification.")).toBeInTheDocument();
  });

  it("keeps Timeline evidence in a bounded scroll viewport", async () => {
    const source = await readFile(path.join(appComponentsRoot, "timeline.tsx"), "utf8");

    expect(source).toMatch(/<ScrollArea\s+type="always"/u);
    expect(source).toContain("h-[min(42rem,calc(100vh-16rem))]");
    expect(source).toMatch(/\bbreak-words\b/u);
  });
});

async function loadComponent(name: keyof typeof componentLoaders): Promise<ComponentType<any>> {
  const module = (await componentLoaders[name]()) as Record<string, unknown>;
  const component = module[name];

  expect(typeof component).toBe("function");

  return component as ComponentType<any>;
}

async function importRendererModule(modulePathFromRepoRoot: string): Promise<Record<string, unknown>> {
  return import(
    /* @vite-ignore */ pathToFileURL(path.join(repoRoot, modulePathFromRepoRoot)).href
  ) as Promise<Record<string, unknown>>;
}

async function findStatusTokenUtilitySources(): Promise<Array<{ file: string; text: string }>> {
  const files = await collectTypeScriptFiles(rendererRoot);
  const sources = await Promise.all(
    files.map(async (file) => ({
      file: normalizeRepoPath(file),
      text: await readFile(file, "utf8")
    }))
  );

  return sources.filter(
    (source) =>
      source.file !== "src/renderer/components/app/status-badge.tsx" &&
      /status/u.test(path.basename(source.file)) &&
      statusToneMappings.every(([, token]) => source.text.includes(token))
  );
}

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return collectTypeScriptFiles(resolved);
      }

      return resolved.endsWith(".ts") || resolved.endsWith(".tsx") ? [resolved] : [];
    })
  );

  return files.flat();
}

function hasNamedExport(source: string, exportName: string): boolean {
  return (
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\b`, "u").test(source) ||
    new RegExp(`export\\s+const\\s+${exportName}\\b`, "u").test(source) ||
    new RegExp(`export\\s+class\\s+${exportName}\\b`, "u").test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}`, "u").test(source)
  );
}

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}
