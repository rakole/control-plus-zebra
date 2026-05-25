import {
  ALLOWED_IPC_CHANNELS,
  type GetSessionByIdRequest,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel,
  type ShellStateViewModel,
  shellStateViewModelSchema
} from "../ipc/index.js";
import {
  buildSessionPreviewViewModel,
  buildSessionSummaryViewModel,
  filterSessions,
  loadTriageData
} from "./triage-view-model-service.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

export interface SessionViewModelService {
  getShellState(): ShellStateViewModel;
  listSessions(): Promise<SessionSummaryViewModel[]>;
  getSessionById(request: GetSessionByIdRequest): Promise<SessionPreviewViewModel | null>;
}

export interface SessionViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createSessionViewModelService(
  options: SessionViewModelServiceOptions = {}
): SessionViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    getShellState() {
      return shellStateViewModelSchema.parse({
        appName: "Ctr + Zebra",
        readOnly: true,
        allowedOperations: ALLOWED_IPC_CHANNELS,
        adapters: runtime.adapterRegistry.listDescriptors().map((descriptor) => ({
          adapterId: descriptor.id,
          displayName: descriptor.displayName
        }))
      });
    },

    async listSessions() {
      const data = await loadTriageData(runtime);

      return filterSessions(data).map((session) => buildSessionSummaryViewModel(data, session));
    },

    async getSessionById(request) {
      const data = await loadTriageData(runtime);
      const session = data.sessionsById.get(request.sessionId);

      if (!session) {
        return null;
      }

      return buildSessionPreviewViewModel(data, session);
    }
  };
}
