import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appPath = path.join(repoRoot, "src", "renderer", "App.tsx");
const routeRegistryPath = path.join(repoRoot, "src", "renderer", "routes", "route-registry.tsx");

describe("renderer route registry contract", () => {
  beforeEach(() => {
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("centralizes renderer route registration in src/renderer/routes/route-registry.tsx", async () => {
    expect(await fileExists(routeRegistryPath)).toBe(true);

    if (!(await fileExists(routeRegistryPath))) {
      return;
    }

    const source = await readFile(routeRegistryPath, "utf8");

    expect(source).toMatch(routePathPattern("/"));
    expect(source).toMatch(routePathPattern("/overview"));
    expect(source).toMatch(routePathPattern("/projects"));
    expect(source).toMatch(routePathPattern("/data-sources"));
    expect(source).toMatch(routePathPattern("/sessions"));
    expect(source).toMatch(routePathPattern("/sessions/:sessionId"));
    expect(source).toMatch(routePathPattern("/sessions/:sessionId/run-audit"));
    expect(source).toMatch(routePathPattern("/diagnostics"));
    expect(source).toMatch(routePathPattern("*"));
    expect(source).toMatch(/to\s*[:=]\s*["']\/overview["']/u);
  });

  it("keeps App focused on HashRouter wiring instead of owning the route table", async () => {
    const source = await readFile(appPath, "utf8");

    expect(source).toMatch(/HashRouter/u);
    expect(source).toMatch(/route-registry/u);
    expect(source).not.toMatch(
      /(?:OverviewRoute|ProjectsRoute|DataSourcesRoute|SessionsRoute|SessionDetailRoute|RunAuditRoute|DiagnosticsRoute)\.js/u
    );
  });

  it("renders the session detail route from a deep link when App boots under HashRouter", async () => {
    loadHashRoute("/sessions/session-1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
    expect(screen.getByLabelText("Session detail route")).toBeInTheDocument();
  });

  it("renders the run audit route from a deep link when App boots under HashRouter", async () => {
    loadHashRoute("/sessions/session-1/run-audit");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByLabelText("Run audit route")).toBeInTheDocument();
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function routePathPattern(routePath: string): RegExp {
  const escaped = escapeRegExp(routePath);

  return new RegExp(`path\\s*[:=]\\s*["']${escaped}["']`, "u");
}

function loadHashRoute(routePath: string) {
  window.history.replaceState({}, "", `/#${routePath}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
