import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { ThemeProvider } from "../../src/renderer/providers/theme-provider.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

type ThemePreference = "system" | "light" | "dark";
type EffectiveTheme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
}

type ThemeListener = (state: ThemeState) => void;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appPath = path.join(repoRoot, "src", "renderer", "App.tsx");

const routeTitleCases = [
  {
    routePath: "/overview",
    title: "Overview"
  },
  {
    routePath: "/sessions/session-1",
    title: "Session Detail"
  },
  {
    routePath: "/sessions/session-1/run-audit",
    title: "Run Audit"
  }
] as const;

let currentThemeState: ThemeState;
let themeListeners: Set<ThemeListener>;

beforeEach(() => {
  installBridgeMocks();
  currentThemeState = makeThemeState({});
  themeListeners = new Set();

  Object.defineProperty(window, "agentWorkbenchTheme", {
    configurable: true,
    value: createMockThemeBridge()
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  themeListeners.clear();
  Reflect.deleteProperty(window, "agentWorkbench");
  Reflect.deleteProperty(window, "agentWorkbenchTheme");
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("renderer shell migration navigation contracts", () => {
  it("renders accessible workbench navigation links for the primary routes", async () => {
    renderWorkbench("/overview");

    const navigation = await screen.findByLabelText("Workbench navigation");

    expect(within(navigation).getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Data Sources" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Sessions" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Diagnostics" })).toBeInTheDocument();
  });

  it("exposes the active route through aria-current on the current navigation link", async () => {
    renderWorkbench("/sessions");

    const navigation = await screen.findByLabelText("Workbench navigation");

    expect(within(navigation).getByRole("link", { name: "Sessions" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(navigation).getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(within(navigation).getByRole("link", { name: "Projects" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});

describe("renderer shell migration topbar contracts", () => {
  it.each(routeTitleCases)(
    "renders $title through the new workbench topbar for $routePath",
    async ({ routePath, title }) => {
      const { container } = renderWorkbench(routePath);

      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();

      const topbar = container.querySelector<HTMLElement>('[data-slot="workbench-topbar"]');

      expect(topbar).not.toBeNull();

      if (topbar) {
        expect(within(topbar).getByText(title)).toBeInTheDocument();
      }
    }
  );
});

describe("renderer shell migration theme contracts", () => {
  it("places the theme mode control inside the workbench shell and exposes system, light, and dark options", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkbench("/overview");

    const themeButton = await screen.findByRole("button", {
      name: "Theme mode: System"
    });

    expect(
      themeButton.closest('[data-slot="workbench-topbar"], [data-slot="workbench-sidebar"]')
    ).not.toBeNull();

    await user.click(themeButton);

    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: "System" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Light" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Dark" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="workbench-shell"]')).not.toBeNull();
  });
});

describe("renderer App shell migration source ratchets", () => {
  it("composes app shell components instead of importing the legacy AppShell wrapper", async () => {
    const source = await readFile(appPath, "utf8");

    expect(source).toMatch(/components\/app\//u);
    expect(source).not.toMatch(/components\/AppShell\.js/u);
    expect(source).not.toMatch(/\bAppShell\b/u);
  });
});

function renderWorkbench(routePath: string) {
  loadHashRoute(routePath);

  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

function loadHashRoute(routePath: string) {
  window.history.replaceState({}, "", `/#${routePath}`);
}

function createMockThemeBridge() {
  return {
    getThemeState: vi.fn(async () => currentThemeState),
    setThemePreference: vi.fn(async (preference: ThemePreference) => {
      emitThemeState(resolveThemeState(preference));
    }),
    onThemeStateChanged: vi.fn((callback: ThemeListener) => {
      themeListeners.add(callback);

      return () => {
        themeListeners.delete(callback);
      };
    })
  };
}

function makeThemeState(overrides: Partial<ThemeState>): ThemeState {
  return {
    preference: "system",
    effectiveTheme: "light",
    shouldUseHighContrastColors: false,
    ...overrides
  };
}

function resolveThemeState(preference: ThemePreference): ThemeState {
  if (preference === "dark") {
    return makeThemeState({ preference, effectiveTheme: "dark" });
  }

  return makeThemeState({ preference, effectiveTheme: "light" });
}

function emitThemeState(nextState: ThemeState) {
  currentThemeState = nextState;

  for (const listener of themeListeners) {
    listener(nextState);
  }
}
