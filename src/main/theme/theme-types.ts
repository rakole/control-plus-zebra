export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export interface ThemeState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  shouldUseHighContrastColors: boolean;
}
