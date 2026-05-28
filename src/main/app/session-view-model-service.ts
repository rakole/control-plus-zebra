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
  loadStoreTriageData
} from "./triage-view-model-service.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";
import {
  findStoreSessionLocation,
  listGlobalSessionPage,
  listProjectRollupsBySourceId
} from "./store-session-query.js";
import type { Session } from "../core/model/entities.js";

export interface SessionViewModelService {
  getShellState(): ShellStateViewModel;
  listSessions(): Promise<SessionSummaryViewModel[]>;
  listSessionsPage?(request?: SessionListPageRequest): Promise<{
    pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
    sessions: SessionSummaryViewModel[];
  }>;
  getSessionById(request: GetSessionByIdRequest): Promise<SessionPreviewViewModel | null>;
}

export interface SessionListPageRequest {
  adapterId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
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
      const data = await loadStoreTriageData(runtime, undefined, {
        includeSessionDiagnostics: true
      });

      return filterSessions(data).map((session) => buildSessionSummaryViewModel(data, session));
    },

    async listSessionsPage(request = {}) {
      const page = await listGlobalSessionPage(runtime, {
        ...(request.adapterId ? { adapterId: request.adapterId } : {}),
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {})
      });
      const degradedSourceIds = new Set(
        (await runtime.getEntityStoreHydrationState()).sourceStates
          .filter((state) => state.status === "cache-fallback")
          .map((state) => state.sourceId)
      );
      const degradedRows = page.rows.filter((row) => degradedSourceIds.has(row.session.sourceId));
      const fallbackData =
        degradedRows.length > 0
          ? await loadStoreTriageData(runtime, request.adapterId, {
              includeSessionDiagnostics: true
            })
          : undefined;

      return {
        sessions: await Promise.all(
          page.rows.map((row) => {
            if (!fallbackData || !degradedSourceIds.has(row.session.sourceId)) {
              return buildStoreSessionSummary(runtime, row.session, row.session.sourceId);
            }

            const fallbackSession = fallbackData.sessionsById.get(row.session.id) ?? row.session;
            return Promise.resolve(buildSessionSummaryViewModel(fallbackData, fallbackSession));
          })
        ),
        pageInfo: {
          hasMore: page.pageInfo.hasMore,
          ...(page.pageInfo.nextCursor ? { nextCursor: page.pageInfo.nextCursor } : {}),
          totalCount: page.pageInfo.totalCount
        }
      };
    },

    async getSessionById(request) {
      const location = await findStoreSessionLocation(runtime, request.sessionId);

      if (!location) {
        return null;
      }

      const degradedSourceIds = new Set(
        (await runtime.getEntityStoreHydrationState()).sourceStates
          .filter((state) => state.status === "cache-fallback")
          .map((state) => state.sourceId)
      );

      if (degradedSourceIds.has(location.source.sourceId)) {
        const data = await loadStoreTriageData(runtime, undefined, {
          includeSessionDiagnostics: true
        });
        const session = data.sessionsById.get(request.sessionId) ?? location.session;

        return buildSessionPreviewViewModel(data, session);
      }

      return buildStoreSessionPreview(runtime, location.session, location.source.sourceId);
    }
  };
}

async function buildStoreSessionSummary(
  runtime: WorkbenchRuntime,
  session: Session,
  sourceId: string
): Promise<SessionSummaryViewModel> {
  const data = await buildStoreSessionData(runtime, session, sourceId);
  return buildSessionSummaryViewModel(data, session);
}

async function buildStoreSessionPreview(
  runtime: WorkbenchRuntime,
  session: Session,
  sourceId: string
): Promise<SessionPreviewViewModel> {
  const data = await buildStoreSessionData(runtime, session, sourceId);
  return buildSessionPreviewViewModel(data, session);
}

async function buildStoreSessionData(
  runtime: WorkbenchRuntime,
  session: Session,
  sourceId: string
): Promise<Parameters<typeof buildSessionSummaryViewModel>[0]> {
  const [diagnostics, descriptors, projectRollups] = await Promise.all([
    runtime.entityStore.listDiagnostics({
      sourceId,
      sessionId: session.id
    }),
    Promise.resolve(runtime.adapterRegistry.listDescriptors()),
    listProjectRollupsBySourceId(runtime, sourceId)
  ]);
  const project = session.projectId ? projectRollups.get(session.projectId)?.project : undefined;

  const projectSnapshot =
    project && session.projectId
      ? {
          projectId: session.projectId,
          git:
            projectRollups.get(session.projectId)?.git ?? {
              status: "unknown",
              rootConfidence: "unknown",
              diagnosticIds: []
            },
          ...(projectRollups.get(session.projectId)?.github
            ? { github: projectRollups.get(session.projectId)!.github }
            : {})
        }
      : undefined;

  return {
    descriptors: new Map(
      descriptors.map((descriptor) => [descriptor.id, descriptor] as const)
    ),
    records: [],
    projectsById: new Map(
      project ? [[project.id, project] as const] : []
    ),
    sessionsById: new Map([[session.id, session] as const]),
    eventsBySessionId: new Map(),
    messagesBySessionId: new Map(),
    toolCallsBySessionId: new Map(),
    shellCommandsBySessionId: new Map(),
    outputArtifactsBySessionId: new Map(),
    fileMutationsBySessionId: new Map(),
    diagnosticsBySessionId: new Map([[session.id, diagnostics] as const]),
    derivedBySessionId: new Map(),
    projectSnapshotsByProjectId: new Map(
      projectSnapshot && session.projectId
        ? [[session.projectId, projectSnapshot] as const]
        : []
    ),
    sourceHydrationStatesBySourceId: new Map()
  };
}
