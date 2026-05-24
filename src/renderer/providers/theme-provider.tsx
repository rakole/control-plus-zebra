import * as React from "react";

import {
  getThemeState,
  onThemeStateChanged,
  setThemePreference as setThemePreferenceBridge
} from "../bridge/theme.js";
import type { ThemePreference, ThemeState } from "../lib/theme.js";

interface ThemeContextValue extends ThemeState {
  setThemePreference(preference: ThemePreference): Promise<void>;
}

const defaultThemeState: ThemeState = {
  preference: "system",
  effectiveTheme: "light",
  shouldUseHighContrastColors: false
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children?: React.ReactNode }) {
  const [themeState, setThemeState] = React.useState<ThemeState>(defaultThemeState);

  React.useEffect(() => {
    let isMounted = true;

    void getThemeState()
      .then((state) => {
        if (isMounted) {
          setThemeState(state);
        }
      })
      .catch(() => {
        // Keep the default renderer-owned fallback when the preload bridge is unavailable.
      });

    const unsubscribe = onThemeStateChanged((state) => {
      setThemeState(state);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", themeState.effectiveTheme === "dark");
  }, [themeState.effectiveTheme]);

  const setThemePreference = React.useCallback(async (preference: ThemePreference) => {
    await setThemePreferenceBridge(preference);
  }, []);

  const value = React.useMemo(
    () => ({
      ...themeState,
      setThemePreference
    }),
    [setThemePreference, themeState]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}
