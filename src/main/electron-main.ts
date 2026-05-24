import { app, BrowserWindow, dialog, ipcMain } from "electron";

import { createArchiveImportService } from "./app/archive-import-service.js";
import { createArchiveExportService } from "./app/archive-export-service.js";
import { createDiagnosticsViewModelService } from "./app/diagnostics-view-model-service.js";
import { createDataSourcesViewModelService } from "./app/data-sources-view-model-service.js";
import { createRunAuditViewModelService } from "./app/run-audit-view-model-service.js";
import { createSessionViewModelService } from "./app/session-view-model-service.js";
import { createSessionDetailViewModelService } from "./app/session-detail-view-model-service.js";
import { createTriageViewModelService } from "./app/triage-view-model-service.js";
import { createWorkbenchRuntime } from "./app/workbench-runtime.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { createMainWindow } from "./window.js";

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const runtime = createWorkbenchRuntime({
    appDataDir: app.getPath("userData")
  });

  registerIpcHandlers(ipcMain, {
    archiveImportService: createArchiveImportService({
      runtime,
      async selectArchivePath() {
        const result = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [
            {
              name: "Agent Workbench Archives",
              extensions: ["json"]
            }
          ]
        });

        return result.canceled ? null : result.filePaths[0] ?? null;
      }
    }),
    archiveExportService: createArchiveExportService({ runtime }),
    sessionService: createSessionViewModelService({ runtime }),
    sessionDetailService: createSessionDetailViewModelService({ runtime }),
    runAuditService: createRunAuditViewModelService({ runtime }),
    triageService: createTriageViewModelService({ runtime }),
    diagnosticsService: createDiagnosticsViewModelService({ runtime }),
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
