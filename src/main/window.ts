import { BrowserWindow, session } from "electron";
import path from "node:path";

import { buildContentSecurityPolicy } from "./security/content-security-policy.js";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const preloadPath = path.join(__dirname, "preload.cjs");
let contentSecurityPolicyRegistered = false;

export function createMainWindow(): BrowserWindow {
  registerContentSecurityPolicy();

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 800,
    minHeight: 680,
    title: "Ctr + Zebra",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  return window;
}

function registerContentSecurityPolicy(): void {
  if (contentSecurityPolicyRegistered) {
    return;
  }

  const contentSecurityPolicy = buildContentSecurityPolicy({
    mode: MAIN_WINDOW_VITE_DEV_SERVER_URL ? "development" : "production",
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy]
      }
    });
  });

  contentSecurityPolicyRegistered = true;
}
