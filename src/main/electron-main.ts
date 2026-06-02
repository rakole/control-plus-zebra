import { app, BrowserWindow, dialog, ipcMain, nativeTheme, utilityProcess } from "electron";
import path from "node:path";

import { createArchiveImportService } from "./app/archive-import-service.js";
import { createArchiveExportService } from "./app/archive-export-service.js";
import { createDiagnosticsViewModelService } from "./app/diagnostics-view-model-service.js";
import { createDataSourcesViewModelService } from "./app/data-sources-view-model-service.js";
import { createElectronUtilityScanJobRunner } from "./app/electron-utility-scan-job-runner.js";
import { createOutputArtifactViewModelService } from "./app/output-artifact-view-model-service.js";
import { createRunAuditViewModelService } from "./app/run-audit-view-model-service.js";
import { createSessionViewModelService } from "./app/session-view-model-service.js";
import { createSessionDetailViewModelService } from "./app/session-detail-view-model-service.js";
import { createTriageViewModelService } from "./app/triage-view-model-service.js";
import { createWorkbenchRuntime } from "./app/workbench-runtime.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { createThemePreferenceStore } from "./theme/theme-preference-store.js";
import { createThemeService } from "./theme/theme-service.js";
import { createMainWindow } from "./window.js";

async function bootstrap(): Promise<void> {
  await app.whenReady();
  applyDockIcon();

  const appDataDir = app.getPath("userData");
  const runtime = createWorkbenchRuntime({ appDataDir });
  runtime.scanJobRunner = createElectronUtilityScanJobRunner({
    appDataDir: runtime.appDataDir,
    forkUtilityProcess(modulePath, args, options) {
      return utilityProcess.fork(modulePath, args, options);
    },
    projectDir: runtime.projectDir,
    sourceRegistry: runtime.sourceRegistry
  });
  const themePreferenceStore = createThemePreferenceStore(appDataDir);
  const themeService = createThemeService({
    nativeTheme,
    loadPreference: themePreferenceStore.loadPreference,
    savePreference: themePreferenceStore.savePreference
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
    outputArtifactService: createOutputArtifactViewModelService({ runtime }),
    runAuditService: createRunAuditViewModelService({ runtime }),
    triageService: createTriageViewModelService({ runtime }),
    diagnosticsService: createDiagnosticsViewModelService({ runtime }),
    dataSourcesService: createDataSourcesViewModelService({ runtime }),
    themeService
  });
  registerThemeWindow(themeService, createMainWindow());
  void runtime.backgroundScanScheduler.runStartupRefresh();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      registerThemeWindow(themeService, createMainWindow());
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

void bootstrap();

function applyDockIcon(): void {
  if (process.platform !== "darwin" || app.isPackaged || !app.dock) {
    return;
  }

  const dockIconPath = path.join(app.getAppPath(), "build", "icons", "zebra-icon.png");
  app.dock.setIcon(dockIconPath);
}

function registerThemeWindow(
  themeService: ReturnType<typeof createThemeService>,
  window: BrowserWindow
): BrowserWindow {
  themeService.registerWindow(window);
  window.once("closed", () => {
    themeService.unregisterWindow(window);
  });

  return window;
}
