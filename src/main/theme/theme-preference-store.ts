import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ThemePreference } from "./theme-types.js";

interface ThemePreferenceStore {
  loadPreference(): ThemePreference | undefined;
  savePreference(preference: ThemePreference): void;
}

export function createThemePreferenceStore(appDataDir: string): ThemePreferenceStore {
  const filePath = path.join(appDataDir, "theme-preference.json");

  return {
    loadPreference() {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
          preference?: unknown;
        };

        return normalizeThemePreference(parsed.preference);
      } catch {
        return undefined;
      }
    },
    savePreference(preference) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify({ preference }, null, 2)}\n`);
    }
  };
}

function normalizeThemePreference(preference: unknown): ThemePreference | undefined {
  return preference === "system" || preference === "light" || preference === "dark"
    ? preference
    : undefined;
}
