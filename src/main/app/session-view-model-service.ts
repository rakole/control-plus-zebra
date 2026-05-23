import path from "node:path";

import type {
  AdapterNormalizationResult,
  DiscoveredHarnessSource,
  RawArtifactRef,
  RawHarnessEvent
} from "../core/adapter-contract/index.js";
import type { CapabilityState, HarnessCapabilities } from "../core/model/capabilities.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { createBundledAdapterRegistry } from "../core/registry/register-bundled-adapters.js";
import {
  ALLOWED_IPC_CHANNELS,
  type GetSessionByIdRequest,
  type CapabilityBadgeLabel,
  type SessionPreviewViewModel,
  sessionPreviewViewModelSchema,
  type SessionSummaryViewModel,
  sessionSummaryViewModelSchema,
  type ShellStateViewModel,
  shellStateViewModelSchema
} from "../ipc/index.js";

const fakeFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);

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

export function createSessionViewModelService(): SessionViewModelService {
  const registry = createBundledAdapterRegistry();

  async function loadFakeNormalizedData(): Promise<AdapterNormalizationResult> {
    const adapter = registry.require("fake-test");
    const context = {
      projectDir: process.cwd(),
      platform: process.platform
    };
    const validation = await adapter.validateSourceRoot({ rootPath: fakeFixturePath }, context);

    if (!validation.ok) {
      throw new Error("Fake session fixture failed source validation.");
    }

    const [source] = await collectAsync(
      adapter.discoverSources({ rootPath: fakeFixturePath }, context)
    );

    if (!source) {
      throw new Error("Fake session fixture did not produce a source.");
    }

    const artifacts = await collectAsync(adapter.discoverArtifacts(source, context));
    const rawEvents = await collectRawEvents(adapter.parseArtifact, artifacts, context);

    return adapter.normalize(
      {
        source,
        artifacts,
        rawEvents
      },
      context
    );
  }

  return {
    getShellState() {
      return shellStateViewModelSchema.parse({
        appName: "Agent Workbench",
        readOnly: true,
        allowedOperations: ALLOWED_IPC_CHANNELS,
        adapters: registry.listDescriptors().map((descriptor) => ({
          adapterId: descriptor.id,
          displayName: descriptor.displayName
        }))
      });
    },

    async listSessions() {
      const normalized = await loadFakeNormalizedData();

      return normalized.sessions.map((session) =>
        sessionSummaryViewModelSchema.parse(toSessionSummary(normalized, session.id))
      );
    },

    async getSessionById(request) {
      const normalized = await loadFakeNormalizedData();
      const session = normalized.sessions.find((candidate) => candidate.id === request.sessionId);

      if (!session) {
        return null;
      }

      return sessionPreviewViewModelSchema.parse(toSessionPreview(normalized, session.id));
    }
  };
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

async function collectRawEvents(
  parseArtifact: (
    artifact: RawArtifactRef,
    context: { projectDir: string; platform: NodeJS.Platform }
  ) => AsyncIterable<RawHarnessEvent>,
  artifacts: RawArtifactRef[],
  context: { projectDir: string; platform: NodeJS.Platform }
): Promise<RawHarnessEvent[]> {
  const rawEvents: RawHarnessEvent[] = [];

  for (const artifact of artifacts) {
    rawEvents.push(...(await collectAsync(parseArtifact(artifact, context))));
  }

  return rawEvents;
}

function toSessionSummary(
  normalized: AdapterNormalizationResult,
  sessionId: string
): SessionSummaryViewModel {
  const session = normalized.sessions.find((candidate) => candidate.id === sessionId);

  if (!session) {
    throw new Error("Session summary mapping requires an existing session.");
  }

  const descriptor = createBundledAdapterRegistry().require(session.adapterId).descriptor;
  const capabilityEnvelope =
    normalized.capabilities.sessions.find((candidate) => candidate.sessionId === sessionId) ??
    normalized.capabilities.source;

  return {
    adapterId: session.adapterId,
    adapterDisplayName: descriptor.displayName,
    sourceId: session.sourceId,
    sessionId: session.id,
    nativeSessionId: session.nativeId,
    title: session.title ?? session.nativeId,
    lifecycleStatus: session.lifecycleState,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    capabilityBadges: capabilityKeys.map((key) =>
      toCapabilityBadge(key, capabilityEnvelope.capabilities[key])
    ),
    diagnosticWarningCount: normalized.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning"
    ).length,
    evidenceSummary: {
      messages: normalized.messages.filter((item) => item.sessionId === sessionId).length,
      toolCalls: normalized.toolCalls.filter((item) => item.sessionId === sessionId).length,
      shellCommands: normalized.shellCommands.filter((item) => item.sessionId === sessionId)
        .length,
      outputArtifacts: normalized.outputArtifacts.filter((item) => item.sessionId === sessionId)
        .length,
      fileMutations: normalized.fileMutations.filter((item) => item.sessionId === sessionId)
        .length,
      diagnostics: normalized.diagnostics.length
    }
  };
}

function toSessionPreview(
  normalized: AdapterNormalizationResult,
  sessionId: string
): SessionPreviewViewModel {
  const summary = toSessionSummary(normalized, sessionId);
  const projectName = normalized.projects.find(
    (project) => project.id === normalized.sessions.find((session) => session.id === sessionId)?.projectId
  )?.name;

  return {
    ...summary,
    ...(projectName ? { projectName } : {}),
    diagnostics: normalized.diagnostics.map(toDiagnosticViewModel)
  };
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
