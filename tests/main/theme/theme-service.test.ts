import { describe, expect, it, vi } from "vitest";

const themePreferences = ["system", "light", "dark"] as const;

type ThemePreference = (typeof themePreferences)[number];
type EffectiveTheme = "light" | "dark";
type ThemeState = {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
};

type ThemeListener = (state: ThemeState) => void;
type SendMock = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
type ThemeWindowLike = {
  webContents: {
    send: SendMock;
    isDestroyed?: () => boolean;
  };
};

describe("theme service", () => {
  it.each(themePreferences)(
    "hydrates the persisted %s preference into nativeTheme.themeSource",
    async (preference) => {
      const { createThemeService } = await import(
        "../../../src/main/theme/theme-service.js"
      );
      const nativeTheme = createNativeThemeHarness({
        shouldUseDarkColors: false,
        shouldUseHighContrastColors: false
      });
      const service = createThemeService({
        nativeTheme,
        loadPreference: () => preference,
        savePreference: vi.fn()
      });

      expect(nativeTheme.themeSource).toBe(preference);
      expect(readThemeState(service)).toEqual({
        preference,
        effectiveTheme: "light",
        shouldUseHighContrastColors: false
      });
    }
  );

  it.each(themePreferences)("persists the %s preference when updated", async (preference) => {
    const { createThemeService } = await import("../../../src/main/theme/theme-service.js");
    let storedPreference: ThemePreference | undefined;
    const nativeTheme = createNativeThemeHarness({
      shouldUseDarkColors: true,
      shouldUseHighContrastColors: false
    });
    const savePreference = vi.fn((nextPreference: ThemePreference) => {
      storedPreference = nextPreference;
    });
    const service = createThemeService({
      nativeTheme,
      loadPreference: () => storedPreference,
      savePreference
    });

    await service.setThemePreference(preference);

    expect(savePreference).toHaveBeenCalledWith(preference);
    expect(storedPreference).toBe(preference);
    expect(nativeTheme.themeSource).toBe(preference);
    expect(readThemeState(service).preference).toBe(preference);
  });

  it.each([
    { shouldUseDarkColors: false, expected: "light" },
    { shouldUseDarkColors: true, expected: "dark" }
  ] as const)(
    "derives %s effective theme from nativeTheme.shouldUseDarkColors",
    async ({ shouldUseDarkColors, expected }) => {
      const { createThemeService } = await import(
        "../../../src/main/theme/theme-service.js"
      );
      const nativeTheme = createNativeThemeHarness({
        shouldUseDarkColors,
        shouldUseHighContrastColors: false
      });
      const service = createThemeService({
        nativeTheme,
        loadPreference: () => "system",
        savePreference: vi.fn()
      });

      expect(readThemeState(service).effectiveTheme).toBe(expected);
    }
  );

  it.each([false, true])(
    "passes through shouldUseHighContrastColors=%s from nativeTheme into ThemeState",
    async (shouldUseHighContrastColors) => {
      const { createThemeService } = await import(
        "../../../src/main/theme/theme-service.js"
      );
      const nativeTheme = createNativeThemeHarness({
        shouldUseDarkColors: false,
        shouldUseHighContrastColors
      });
      const service = createThemeService({
        nativeTheme,
        loadPreference: () => "system",
        savePreference: vi.fn()
      });

      expect(readThemeState(service).shouldUseHighContrastColors).toBe(
        shouldUseHighContrastColors
      );
    }
  );

  it("notifies subscribed listeners and registered windows when nativeTheme updates", async () => {
    const { createThemeService } = await import("../../../src/main/theme/theme-service.js");
    const nativeTheme = createNativeThemeHarness({
      shouldUseDarkColors: false,
      shouldUseHighContrastColors: false
    });
    const window = createThemeWindowHarness();
    const listener = vi.fn<ThemeListener>();
    const service = createThemeService({
      nativeTheme,
      loadPreference: () => "system",
      savePreference: vi.fn()
    });

    const unsubscribe = service.onThemeStateChanged(listener);
    service.registerWindow(window);
    listener.mockClear();
    window.webContents.send.mockClear();

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.shouldUseHighContrastColors = true;
    nativeTheme.emitUpdated();

    const expectedState: ThemeState = {
      preference: "system",
      effectiveTheme: "dark",
      shouldUseHighContrastColors: true
    };

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expectedState);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(
      "theme:stateChanged",
      expectedState
    );

    unsubscribe();
    service.unregisterWindow(window);

    nativeTheme.shouldUseDarkColors = false;
    nativeTheme.shouldUseHighContrastColors = false;
    nativeTheme.emitUpdated();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("drops destroyed windows before broadcasting theme updates", async () => {
    const { createThemeService } = await import("../../../src/main/theme/theme-service.js");
    const nativeTheme = createNativeThemeHarness({
      shouldUseDarkColors: false,
      shouldUseHighContrastColors: false
    });
    const destroyedWindow = createThemeWindowHarness({ isDestroyed: true });
    const liveWindow = createThemeWindowHarness();
    const service = createThemeService({
      nativeTheme,
      loadPreference: () => "system",
      savePreference: vi.fn()
    });

    service.registerWindow(destroyedWindow);
    service.registerWindow(liveWindow);

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emitUpdated();

    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
    expect(liveWindow.webContents.send).toHaveBeenCalledTimes(1);

    liveWindow.webContents.send.mockClear();
    nativeTheme.shouldUseDarkColors = false;
    nativeTheme.emitUpdated();

    expect(liveWindow.webContents.send).toHaveBeenCalledTimes(1);
  });
});

function createNativeThemeHarness(initialState: {
  shouldUseDarkColors: boolean;
  shouldUseHighContrastColors: boolean;
}) {
  const updatedListeners = new Set<() => void>();

  return {
    themeSource: "system" as ThemePreference,
    shouldUseDarkColors: initialState.shouldUseDarkColors,
    shouldUseHighContrastColors: initialState.shouldUseHighContrastColors,
    on(event: string, listener: () => void) {
      if (event === "updated") {
        updatedListeners.add(listener);
      }
    },
    removeListener(event: string, listener: () => void) {
      if (event === "updated") {
        updatedListeners.delete(listener);
      }
    },
    emitUpdated() {
      for (const listener of updatedListeners) {
        listener();
      }
    }
  };
}

function createThemeWindowHarness(options?: { isDestroyed?: boolean }): ThemeWindowLike {
  return {
    webContents: {
      send: vi.fn<(...args: unknown[]) => void>(),
      isDestroyed: () => options?.isDestroyed ?? false
    }
  };
}

function readThemeState(service: {
  getThemeState: () => ThemeState;
  setThemePreference: (preference: ThemePreference) => Promise<void> | void;
  onThemeStateChanged: (listener: ThemeListener) => () => void;
  registerWindow: (window: ThemeWindowLike) => void;
  unregisterWindow: (window: ThemeWindowLike) => void;
}): ThemeState {
  return service.getThemeState();
}
