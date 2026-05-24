import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  }
}));

type ThemePreference = "system" | "light" | "dark";
type EffectiveTheme = "light" | "dark";
type ThemeState = {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
};

type ThemeBridge = {
  getThemeState(): Promise<ThemeState>;
  setThemePreference(preference: ThemePreference): Promise<void>;
  onThemeStateChanged(callback: (state: ThemeState) => void): () => void;
};

describe("theme preload bridge", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("routes theme requests through dedicated invoke channels only", async () => {
    const state: ThemeState = {
      preference: "system",
      effectiveTheme: "dark",
      shouldUseHighContrastColors: true
    };

    electronMocks.invoke.mockResolvedValueOnce(state).mockResolvedValueOnce(undefined);

    await import("../../src/preload/index.js");

    const bridge = getThemeBridge();

    await expect(bridge.getThemeState()).resolves.toEqual(state);
    await bridge.setThemePreference("dark");

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, "theme:getState");
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, "theme:setPreference", "dark");
    expect(electronMocks.on).not.toHaveBeenCalled();
  });

  it("subscribes to theme updates and removes the same listener on unsubscribe", async () => {
    await import("../../src/preload/index.js");

    const bridge = getThemeBridge();
    const callback = vi.fn<(state: ThemeState) => void>();
    const expectedState: ThemeState = {
      preference: "light",
      effectiveTheme: "light",
      shouldUseHighContrastColors: false
    };

    const unsubscribe = bridge.onThemeStateChanged(callback);

    expect(electronMocks.on).toHaveBeenCalledTimes(1);
    expect(electronMocks.on).toHaveBeenCalledWith("theme:stateChanged", expect.any(Function));

    const listener = electronMocks.on.mock.calls[0]?.[1];

    if (typeof listener !== "function") {
      throw new Error("Expected preload theme bridge to register an IPC listener.");
    }

    listener({}, expectedState);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expectedState);

    unsubscribe();

    expect(electronMocks.removeListener).toHaveBeenCalledTimes(1);
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      "theme:stateChanged",
      listener
    );
  });
});

function getThemeBridge(): ThemeBridge {
  const themeExposure = electronMocks.exposeInMainWorld.mock.calls.find(
    ([bridgeName]) => bridgeName === "agentWorkbenchTheme"
  );

  if (!themeExposure) {
    throw new Error("Expected preload to expose window.agentWorkbenchTheme.");
  }

  return themeExposure[1] as ThemeBridge;
}
