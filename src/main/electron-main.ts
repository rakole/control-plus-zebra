import { app, BrowserWindow, ipcMain } from "electron";

import { createDataSourcesViewModelService } from "./app/data-sources-view-model-service.js";
import { createSessionViewModelService } from "./app/session-view-model-service.js";
import { createWorkbenchRuntime } from "./app/workbench-runtime.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { createMainWindow } from "./window.js";

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const runtime = createWorkbenchRuntime({
    appDataDir: app.getPath("userData")
  });

  registerIpcHandlers(ipcMain, {
    sessionService: createSessionViewModelService({ runtime }),
    dataSourcesService: createDataSourcesViewModelService({ runtime })
  });
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
