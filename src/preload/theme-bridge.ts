import { ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../main/ipc/channels.js";
import type {
  AgentWorkbenchThemeBridge,
  ThemePreference,
  ThemeState
} from "./types.js";

export const agentWorkbenchTheme: AgentWorkbenchThemeBridge = Object.freeze({
  getThemeState() {
    return ipcRenderer.invoke(IPC_CHANNELS.getThemeState) as Promise<ThemeState>;
  },
  setThemePreference(preference: ThemePreference) {
    return ipcRenderer.invoke(IPC_CHANNELS.setThemePreference, preference) as Promise<void>;
  },
  onThemeStateChanged(callback: (state: ThemeState) => void) {
    const listener = (_event: unknown, state: ThemeState) => {
      callback(state);
    };

    ipcRenderer.on(IPC_CHANNELS.themeStateChanged, listener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.themeStateChanged, listener);
    };
  }
});
