import type { HarnessDescriptor } from "../core/adapter-contract/index.js";
import type { NormalizedCacheRecord } from "../core/cache/file-backed-cache-store.js";
import { mergeNormalizedResults } from "../core/ingestion/index.js";
import type { CapabilityState, HarnessCapabilities } from "../core/model/capabilities.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import type { Session } from "../core/model/entities.js";
import {
  ALLOWED_IPC_CHANNELS,
  type CapabilityBadgeLabel,
  type GetSessionByIdRequest,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel,
  type ShellStateViewModel,
  sessionPreviewViewModelSchema,
  sessionSummaryViewModelSchema,
  shellStateViewModelSchema
} from "../ipc/index.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

const capabilityKeys = [
  "sessionDiscovery",
  "liveSessionObservation",
  "eventStreaming",
  "messageCapture",
  "toolCallCapture",
  "shellCommandCapture",
  "outputArtifactCapture",
  "fileMutationCapture",
  "sourceValidation",
  "watchPlans",
  "gitContextCapture",
  "githubContextCapture",
  "verificationSignals"
] as const satisfies readonly (keyof HarnessCapabilities)[];

export interface SessionViewModelService {
  getShellState(): ShellStateViewModel;
  listSessions(): Promise<SessionSummaryViewModel[]>;
  getSessionById(request: GetSessionByIdRequest): Promise<SessionPreviewViewModel | null>;
}

export interface SessionViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

interface LoadedSessionData {
  descriptors: Map<string, HarnessDescriptor>;
  records: NormalizedCacheRecord[];
  sessionsById: Map<string, Session>;
}

export function createSessionViewModelService(
  options: SessionViewModelServiceOptions = {}
): SessionViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    getShellState() {
      return shellStateViewModelSchema.parse({
        appName: "Agent Workbench",
        readOnly: true,
        allowedOperations: ALLOWED_IPC_CHANNELS,
        adapters: runtime.adapterRegistry.listDescriptors().map((descriptor) => ({
          adapterId: descriptor.id,
          displayName: descriptor.displayName
        }))
      });
    },

    async listSessions() {
      const data = await loadSessionData(runtime);

      return [...data.sessionsById.values()].map((session) =>
        sessionSummaryViewModelSchema.parse(toSessionSummary(data, session))
      );
    },

    async getSessionById(request) {
      const data = await loadSessionData(runtime);
      const session = data.sessionsById.get(request.sessionId);

      if (!session) {
        return null;
      }

      return sessionPreviewViewModelSchema.parse(toSessionPreview(data, session));
    }
  };
}

async function loadSessionData(runtime: WorkbenchRuntime): Promise<LoadedSessionData> {
  const records = await runtime.cacheStore.listLatestRecords();
  const merged = mergeNormalizedResults(records.map((record) => record.normalized));
  const sessions = merged?.sessions ?? [];

  return {
    descriptors: new Map(
      runtime
        .adapterRegistry
        .listDescriptors()
        .map((descriptor) => [descriptor.id, descriptor] as const)
    ),
    records,
    sessionsById: new Map(sessions.map((session) => [session.id, session] as const))
  };
}

function toSessionSummary(data: LoadedSessionData, session: Session): SessionSummaryViewModel {
  const descriptor = data.descriptors.get(session.adapterId);
  const capabilityEnvelope = getCapabilityEnvelope(data.records, session);
  const diagnostics = getDiagnosticsForSession(data.records, session);

  return {
    adapterId: session.adapterId,
    adapterDisplayName: descriptor?.displayName ?? session.adapterId,
    sourceId: session.sourceId,
    sessionId: session.id,
    nativeSessionId: session.nativeId,
    title: session.title ?? session.nativeId,
    lifecycleStatus: session.lifecycleState,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    capabilityBadges: capabilityKeys.map((key) =>
      toCapabilityBadge(key, capabilityEnvelope?.capabilities[key] ?? { status: "unknown" })
    ),
    diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
      .length,
    evidenceSummary: {
      messages: countBySession(data.records, session.id, "messages"),
      toolCalls: countBySession(data.records, session.id, "toolCalls"),
      shellCommands: countBySession(data.records, session.id, "shellCommands"),
      outputArtifacts: countBySession(data.records, session.id, "outputArtifacts"),
      fileMutations: countBySession(data.records, session.id, "fileMutations"),
      diagnostics: diagnostics.length
    }
  };
}

function toSessionPreview(data: LoadedSessionData, session: Session): SessionPreviewViewModel {
  const summary = toSessionSummary(data, session);
  const projectName = getProjectName(data.records, session);

  return {
    ...summary,
    ...(projectName ? { projectName } : {}),
    diagnostics: getDiagnosticsForSession(data.records, session).map(toDiagnosticViewModel)
  };
}

function getCapabilityEnvelope(records: NormalizedCacheRecord[], session: Session) {
  for (const record of records) {
    const sessionCapability = record.normalized.capabilities.sessions.find(
      (candidate) => candidate.sessionId === session.id
    );

    if (sessionCapability) {
      return sessionCapability;
    }
  }

  const sourceRecord = records.find((record) => record.sourceId === session.sourceId);

  if (sourceRecord) {
    return sourceRecord.normalized.capabilities.source;
  }

  return records.find((record) => record.adapterId === session.adapterId)?.normalized.capabilities.adapter;
}

function getDiagnosticsForSession(records: NormalizedCacheRecord[], session: Session): Diagnostic[] {
  const diagnostics = records
    .filter((record) => record.sourceId === session.sourceId)
    .flatMap((record) => record.normalized.diagnostics)
    .filter((diagnostic) =>
      diagnostic.sourceId === session.sourceId ||
      diagnostic.relatedEntityIds?.includes(session.id) === true
    );

  return dedupeDiagnostics(diagnostics);
}

function countBySession(
  records: NormalizedCacheRecord[],
  sessionId: string,
  key: "messages" | "toolCalls" | "shellCommands" | "outputArtifacts" | "fileMutations"
): number {
  return records.reduce((total, record) => {
    const collection = record.normalized[key];
    return total + collection.filter((item) => item.sessionId === sessionId).length;
  }, 0);
}

function getProjectName(records: NormalizedCacheRecord[], session: Session): string | undefined {
  if (!session.projectId) {
    return undefined;
  }

  for (const record of records) {
    const project = record.normalized.projects.find((candidate) => candidate.id === session.projectId);

    if (project) {
      return project.name;
    }
  }

  return undefined;
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();

  for (const diagnostic of diagnostics) {
    seen.set(diagnostic.id, diagnostic);
  }

  return [...seen.values()];
}

function toCapabilityBadge(key: keyof HarnessCapabilities, state: CapabilityState) {
  return {
    key,
    label: humanizeCapabilityKey(key),
    state: toCapabilityLabel(state.status),
    ...(state.reason ? { reason: state.reason } : {})
  };
}

function toCapabilityLabel(status: CapabilityState["status"]): CapabilityBadgeLabel {
  switch (status) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

function humanizeCapabilityKey(key: keyof HarnessCapabilities): string {
  return key.replace(/([A-Z])/gu, " $1").replace(/^./u, (first) => first.toUpperCase());
}

function toDiagnosticViewModel(diagnostic: Diagnostic) {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message
  };
}
