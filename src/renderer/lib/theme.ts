export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export interface ThemeState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
}

export interface AgentWorkbenchThemeBridge {
  getThemeState(): Promise<ThemeState>;
  setThemePreference(preference: ThemePreference): Promise<void>;
  onThemeStateChanged(callback: (state: ThemeState) => void): () => void;
}
