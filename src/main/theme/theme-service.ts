import { IPC_CHANNELS } from "../ipc/channels.js";
import type { ThemePreference, ThemeState } from "./theme-types.js";

type ThemeListener = (state: ThemeState) => void;

interface NativeThemeLike {
  themeSource: ThemePreference;
  shouldUseDarkColors: boolean;
  shouldUseHighContrastColors: boolean;
  on(event: "updated", listener: () => void): void;
  removeListener(event: "updated", listener: () => void): void;
}

interface ThemeWindowLike {
  webContents: {
    send(...args: unknown[]): void;
    isDestroyed?(): boolean;
  };
}

export interface ThemeService {
  getThemeState(): ThemeState;
  setThemePreference(preference: ThemePreference): void | Promise<void>;
  onThemeStateChanged(listener: ThemeListener): () => void;
  registerWindow(window: ThemeWindowLike): void;
  unregisterWindow(window: ThemeWindowLike): void;
  dispose(): void;
}

export interface ThemeServiceOptions {
  nativeTheme: NativeThemeLike;
  loadPreference(): ThemePreference | undefined;
  savePreference(preference: ThemePreference): void | Promise<void>;
}

export function createThemeService({
  nativeTheme,
  loadPreference,
  savePreference
}: ThemeServiceOptions): ThemeService {
  let preference = normalizeThemePreference(loadPreference());
  const listeners = new Set<ThemeListener>();
  const windows = new Set<ThemeWindowLike>();

  nativeTheme.themeSource = preference;

  function getThemeState(): ThemeState {
    return {
      preference,
      effectiveTheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
      shouldUseHighContrastColors: nativeTheme.shouldUseHighContrastColors
    };
  }

  function notifyThemeStateChanged() {
    const state = getThemeState();

    for (const listener of listeners) {
      listener(state);
    }

    for (const window of windows) {
      if (window.webContents.isDestroyed?.()) {
        windows.delete(window);
        continue;
      }

      try {
        window.webContents.send(IPC_CHANNELS.themeStateChanged, state);
      } catch {
        windows.delete(window);
      }
    }
  }

  const nativeThemeUpdated = () => {
    notifyThemeStateChanged();
  };

  nativeTheme.on("updated", nativeThemeUpdated);

  return {
    getThemeState,
    async setThemePreference(nextPreference) {
      preference = normalizeThemePreference(nextPreference);
      nativeTheme.themeSource = preference;
      await savePreference(preference);
      notifyThemeStateChanged();
    },
    onThemeStateChanged(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    registerWindow(window) {
      windows.add(window);
    },
    unregisterWindow(window) {
      windows.delete(window);
    },
    dispose() {
      listeners.clear();
      windows.clear();
      nativeTheme.removeListener("updated", nativeThemeUpdated);
    }
  };
}

function normalizeThemePreference(preference: ThemePreference | undefined): ThemePreference {
  return preference === "light" || preference === "dark" ? preference : "system";
}
