import { app, BrowserWindow } from "electron";

import { createMainWindow } from "./window.js";

async function bootstrap(): Promise<void> {
  await app.whenReady();

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

void bootstrap();
