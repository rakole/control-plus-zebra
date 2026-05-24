import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type ThemePreference = "system" | "light" | "dark";
type EffectiveTheme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
}

interface ThemeContextValue extends ThemeState {
  setThemePreference: (preference: ThemePreference) => Promise<void> | void;
}

type ThemeListener = (state: ThemeState) => void;

let currentThemeState: ThemeState;
let themeListeners: Set<ThemeListener>;
let mockThemeBridge: ReturnType<typeof createMockThemeBridge>;

beforeEach(() => {
  currentThemeState = makeThemeState({});
  themeListeners = new Set();
  mockThemeBridge = createMockThemeBridge();

  Object.defineProperty(window, "agentWorkbenchTheme", {
    configurable: true,
    value: mockThemeBridge
  });

  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  themeListeners.clear();
  Reflect.deleteProperty(window, "agentWorkbenchTheme");
  vi.restoreAllMocks();
});

describe("renderer theme provider contract", () => {
  it("falls back to the default theme state when the initial bridge fetch fails", async () => {
    mockThemeBridge.getThemeState.mockRejectedValueOnce(new Error("bridge unavailable"));
    const { ThemeProvider, useTheme } = await loadThemeProviderModule();

    function ThemeProbe() {
      const { preference, effectiveTheme } = useTheme();

      return (
        <div>
          <div>Preference: {preference}</div>
          <div>Effective theme: {effectiveTheme}</div>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    await screen.findByText("Preference: system");
    await screen.findByText("Effective theme: light");
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  });

  it("applies .dark to document.documentElement when effectiveTheme is dark", async () => {
    currentThemeState = makeThemeState({ preference: "dark", effectiveTheme: "dark" });
    mockThemeBridge.getThemeState.mockResolvedValue(currentThemeState);
    const { ThemeProvider } = await loadThemeProviderModule();

    render(
      <ThemeProvider>
        <div>Theme provider mounted</div>
      </ThemeProvider>
    );

    await screen.findByText("Theme provider mounted");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  });

  it("removes .dark from document.documentElement when effectiveTheme is light", async () => {
    document.documentElement.classList.add("dark");
    currentThemeState = makeThemeState({ preference: "light", effectiveTheme: "light" });
    mockThemeBridge.getThemeState.mockResolvedValue(currentThemeState);
    const { ThemeProvider } = await loadThemeProviderModule();

    render(
      <ThemeProvider>
        <div>Theme provider mounted</div>
      </ThemeProvider>
    );

    await screen.findByText("Theme provider mounted");
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  });

  it("routes setThemePreference through window.agentWorkbenchTheme instead of localStorage", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { ThemeProvider, useTheme } = await loadThemeProviderModule();
    const user = userEvent.setup();

    function ThemeSetterProbe() {
      const { setThemePreference } = useTheme();

      return (
        <div>
          <button type="button" onClick={() => void setThemePreference("system")}>
            Set system
          </button>
          <button type="button" onClick={() => void setThemePreference("light")}>
            Set light
          </button>
          <button type="button" onClick={() => void setThemePreference("dark")}>
            Set dark
          </button>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <ThemeSetterProbe />
      </ThemeProvider>
    );

    await user.click(await screen.findByRole("button", { name: "Set system" }));
    await user.click(screen.getByRole("button", { name: "Set light" }));
    await user.click(screen.getByRole("button", { name: "Set dark" }));

    await waitFor(() => expect(mockThemeBridge.setThemePreference).toHaveBeenCalledTimes(3));
    expect(mockThemeBridge.setThemePreference).toHaveBeenNthCalledWith(1, "system");
    expect(mockThemeBridge.setThemePreference).toHaveBeenNthCalledWith(2, "light");
    expect(mockThemeBridge.setThemePreference).toHaveBeenNthCalledWith(3, "dark");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("propagates bridge updates through React context and the document root class", async () => {
    const { ThemeProvider, useTheme } = await loadThemeProviderModule();

    function ThemeProbe() {
      const { preference, effectiveTheme } = useTheme();

      return (
        <div>
          <div>Preference: {preference}</div>
          <div>Effective theme: {effectiveTheme}</div>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    await screen.findByText("Preference: system");
    await screen.findByText("Effective theme: light");

    await act(async () => {
      emitThemeState(makeThemeState({ preference: "system", effectiveTheme: "dark" }));
    });

    await waitFor(() => expect(screen.getByText("Preference: system")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Effective theme: dark")).toBeInTheDocument());
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  });
});

describe("ModeToggle theme integration", () => {
  it("exposes system, light, and dark choices accessibly and drives the provider bridge", async () => {
    const { ThemeProvider, useTheme } = await loadThemeProviderModule();
    const ModeToggle = await loadModeToggleComponent();
    const user = userEvent.setup();

    function ThemeProbe() {
      const { preference, effectiveTheme } = useTheme();

      return (
        <div>
          <div>Preference: {preference}</div>
          <div>Effective theme: {effectiveTheme}</div>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <ModeToggle />
        <ThemeProbe />
      </ThemeProvider>
    );

    await screen.findByText("Preference: system");

    await user.click(screen.getByRole("button", { name: "Theme mode: System" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "System" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Light" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Dark" })).toBeInTheDocument();

    await user.click(within(menu).getByRole("menuitem", { name: "Dark" }));

    await waitFor(() => expect(mockThemeBridge.setThemePreference).toHaveBeenCalledWith("dark"));
    await waitFor(() => expect(screen.getByText("Preference: dark")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Effective theme: dark")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Theme mode: Dark" })).toBeInTheDocument()
    );
  });
});

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

async function loadThemeProviderModule(): Promise<{
  ThemeProvider: ComponentType<{ children?: ReactNode }>;
  useTheme: () => ThemeContextValue;
}> {
  const module = await importRendererModule("src/renderer/providers/theme-provider.js");

  expect(module.ThemeProvider).toBeTypeOf("function");
  expect(module.useTheme).toBeTypeOf("function");

  return {
    ThemeProvider: module.ThemeProvider as ComponentType<{ children?: ReactNode }>,
    useTheme: module.useTheme as () => ThemeContextValue
  };
}

async function loadModeToggleComponent(): Promise<ComponentType<any>> {
  const module = await importRendererModule("src/renderer/components/app/mode-toggle.js");

  expect(module.ModeToggle).toBeTypeOf("function");

  return module.ModeToggle as ComponentType<any>;
}

async function importRendererModule(modulePathFromRepoRoot: string): Promise<Record<string, unknown>> {
  return import(
    /* @vite-ignore */ pathToFileURL(path.join(repoRoot, modulePathFromRepoRoot)).href
  ) as Promise<Record<string, unknown>>;
}
