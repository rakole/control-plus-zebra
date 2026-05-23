import type {
  AdapterNormalizationInput,
  AdapterNormalizationResult
} from "../../core/adapter-contract/index.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import type {
  CapabilityEnvelope,
  CapabilityState,
  HarnessCapabilities
} from "../../core/model/capabilities.js";
import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE } from "../../core/model/confidence.js";
import type {
  FileMutationEvidence,
  OutputArtifact,
  Project,
  Session,
  SessionEvent,
  SessionMessage,
  ShellCommandEvidence,
  ToolCall
} from "../../core/model/entities.js";
import {
  createFileMutationEvidenceId,
  createOutputArtifactId,
  createProjectId,
  createSessionEventId,
  createSessionId,
  createSessionMessageId,
  createShellCommandEvidenceId,
  createToolCallId
} from "../../core/model/identifiers.js";
import { fakeTestDescriptor } from "./descriptor.js";
import type { FakeParseDiagnostic, FakeTimelineEvent } from "./types.js";
import type { FakeRawEvent } from "./parse.js";

function buildCapabilityEnvelope(
  capabilities: HarnessCapabilities,
  sourceId?: string,
  sessionId?: string
): CapabilityEnvelope {
  return {
    adapterId: fakeTestDescriptor.id,
    ...(sourceId ? { sourceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    capabilities
  };
}

function buildSessionCapabilityEnvelope(
  capabilities: HarnessCapabilities,
  sourceId: string,
  sessionId: string
): CapabilityEnvelope & { sessionId: string } {
  return {
    adapterId: fakeTestDescriptor.id,
    sourceId,
    sessionId,
    capabilities
  };
}

function toCapabilityState(state: {
  status: CapabilityState["status"];
  reason?: string | undefined;
  details?: string | undefined;
}): CapabilityState {
  return {
    status: state.status,
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
    ...(state.details !== undefined ? { details: state.details } : {})
  };
}

function toHarnessCapabilities(capabilities: {
  [K in keyof HarnessCapabilities]: {
    status: CapabilityState["status"];
    reason?: string | undefined;
    details?: string | undefined;
  };
}): HarnessCapabilities {
  return {
    sessionDiscovery: toCapabilityState(capabilities.sessionDiscovery),
    liveSessionObservation: toCapabilityState(capabilities.liveSessionObservation),
    eventStreaming: toCapabilityState(capabilities.eventStreaming),
    messageCapture: toCapabilityState(capabilities.messageCapture),
    toolCallCapture: toCapabilityState(capabilities.toolCallCapture),
    shellCommandCapture: toCapabilityState(capabilities.shellCommandCapture),
    outputArtifactCapture: toCapabilityState(capabilities.outputArtifactCapture),
    fileMutationCapture: toCapabilityState(capabilities.fileMutationCapture),
    sourceValidation: toCapabilityState(capabilities.sourceValidation),
    watchPlans: toCapabilityState(capabilities.watchPlans),
    gitContextCapture: toCapabilityState(capabilities.gitContextCapture),
    githubContextCapture: toCapabilityState(capabilities.githubContextCapture),
    verificationSignals: toCapabilityState(capabilities.verificationSignals)
  };
}

function summarizeTimelineEvent(event: FakeTimelineEvent): string {
  switch (event.kind) {
    case "lifecycle":
      return event.summary ?? `Lifecycle changed to ${event.state}`;
    case "message":
      return `${event.role} message`;
    case "tool-call":
      return `${event.toolName} ${event.status}`;
    case "shell-command":
      return event.command;
    case "output-artifact":
      return event.summary ?? `Output artifact ${event.artifactId}`;
  }
}

function buildParseDiagnostic(
  sourceId: string,
  diagnostic: FakeParseDiagnostic,
  relatedEntityIds?: string[]
) {
  return buildDiagnostic(
    fakeTestDescriptor.id,
    diagnostic.code,
    diagnostic.message,
    diagnostic.severity,
    "artifact",
    HIGH_CONFIDENCE,
    {
      sourceId,
      nativeId: diagnostic.nativeId ?? diagnostic.code,
      ...(relatedEntityIds ? { relatedEntityIds } : {})
    }
  );
}

export async function normalizeFakeTestEvents(
  input: AdapterNormalizationInput<FakeRawEvent>
): Promise<AdapterNormalizationResult> {
  const adapterId = fakeTestDescriptor.id;
  const sourceId = input.source.id;
  const parseDiagnostics = input.rawEvents
    .filter(
      (event): event is FakeRawEvent & { payload: { kind: "parse-diagnostic" } } =>
        event.payload.kind === "parse-diagnostic"
    )
    .map((event) => buildParseDiagnostic(sourceId, event.payload.diagnostic, [event.artifactId]));
  const metadataEvent = input.rawEvents.find(
    (event): event is FakeRawEvent & { payload: { kind: "fixture-metadata" } } =>
      event.payload.kind === "fixture-metadata"
  );

  if (!metadataEvent) {
    return {
      adapterId,
      sourceId,
      capabilities: {
        adapter: buildCapabilityEnvelope(fakeTestDescriptor.capabilities),
        source: buildCapabilityEnvelope(fakeTestDescriptor.capabilities, sourceId),
        sessions: []
      },
      projects: [],
      sessions: [],
      events: [],
      messages: [],
      toolCalls: [],
      shellCommands: [],
      outputArtifacts: [],
      fileMutations: [],
      diagnostics:
        parseDiagnostics.length > 0
          ? parseDiagnostics
          : [
              buildDiagnostic(
                adapterId,
                "fake-test.normalize.metadata-missing",
                "Fake test normalization requires a fixture metadata event.",
                "error",
                "artifact",
                HIGH_CONFIDENCE,
                {
                  sourceId,
                  nativeId: input.source.nativeId
                }
              )
            ]
    };
  }

  const fixture = metadataEvent.payload.fixture;
  const fixtureCapabilities = toHarnessCapabilities(fixture.capabilities);
  const projectId = createProjectId({
    adapterId,
    sourceId,
    nativeId: fixture.project.id
  });
  const sessionId = createSessionId({
    adapterId,
    sourceId,
    nativeId: fixture.session.id
  });

  const projects: Project[] = [
    {
      kind: "project",
      id: projectId,
      adapterId,
      sourceId,
      nativeId: fixture.project.id,
      name: fixture.project.name,
      ...(fixture.project.rootPath ? { rootPath: fixture.project.rootPath } : {}),
      confidence: HIGH_CONFIDENCE
    }
  ];

  const sessions: Session[] = [
    {
      kind: "session",
      id: sessionId,
      adapterId,
      sourceId,
      nativeId: fixture.session.id,
      projectId,
      ...(fixture.session.title ? { title: fixture.session.title } : {}),
      startedAt: fixture.session.startedAt,
      ...(fixture.session.endedAt ? { endedAt: fixture.session.endedAt } : {}),
      lifecycleState: fixture.session.lifecycleState,
      confidence: HIGH_CONFIDENCE
    }
  ];

  const diagnostics = [
    ...parseDiagnostics,
    ...fixture.diagnostics.map((diagnostic, index) =>
      buildDiagnostic(
        adapterId,
        diagnostic.code,
        diagnostic.message,
        diagnostic.severity,
        "source",
        MEDIUM_CONFIDENCE,
        {
          sourceId,
          nativeId: `${fixture.session.id}:diagnostic:${index}`
        }
      )
    )
  ];

  const artifactDefinitions = new Map(
    fixture.artifacts.map((artifact) => [artifact.id, artifact] as const)
  );
  const outputArtifactsByNativeId = new Map<string, OutputArtifact>();
  const fileMutations: FileMutationEvidence[] = [];
  const messages: SessionMessage[] = [];
  const toolCalls: ToolCall[] = [];
  const shellCommands: ShellCommandEvidence[] = [];
  const events: SessionEvent[] = [];

  const ensureOutputArtifact = (
    nativeArtifactId: string,
    eventId?: string
  ): OutputArtifact | undefined => {
    const existing = outputArtifactsByNativeId.get(nativeArtifactId);

    if (existing) {
      if (!existing.eventId && eventId) {
        existing.eventId = eventId;
      }
      return existing;
    }

    const artifactDefinition = artifactDefinitions.get(nativeArtifactId);

    if (!artifactDefinition) {
      return undefined;
    }

    const outputArtifact: OutputArtifact = {
      kind: "output-artifact",
      id: createOutputArtifactId({
        adapterId,
        sourceId,
        nativeId: nativeArtifactId
      }),
      adapterId,
      sourceId,
      sessionId,
      nativeId: artifactDefinition.id,
      artifactKind: artifactDefinition.kind,
      ...(artifactDefinition.path ? { path: artifactDefinition.path } : {}),
      ...(artifactDefinition.uri ? { uri: artifactDefinition.uri } : {}),
      ...(artifactDefinition.mediaType ? { mediaType: artifactDefinition.mediaType } : {}),
      ...(artifactDefinition.byteLength !== undefined
        ? { byteLength: artifactDefinition.byteLength }
        : {}),
      ...(eventId ? { eventId } : {}),
      confidence: HIGH_CONFIDENCE
    };

    outputArtifactsByNativeId.set(nativeArtifactId, outputArtifact);
    return outputArtifact;
  };

  const timelineEvents = input.rawEvents.filter(
    (event): event is FakeRawEvent & { payload: { kind: "timeline-event" } } =>
      event.payload.kind === "timeline-event"
  );

  for (const [index, rawEvent] of timelineEvents.entries()) {
    const timelineEvent = rawEvent.payload.event;
    const eventId = createSessionEventId({
      adapterId,
      sourceId,
      nativeId: timelineEvent.id
    });

    const sessionEvent: SessionEvent = {
      kind: "session-event",
      id: eventId,
      adapterId,
      sourceId,
      sessionId,
      nativeId: timelineEvent.id,
      eventKind: timelineEvent.kind,
      timestamp: timelineEvent.timestamp,
      ordinal: index + 1,
      summary: summarizeTimelineEvent(timelineEvent),
      confidence: HIGH_CONFIDENCE
    };

    if (timelineEvent.kind === "message") {
      const messageId = createSessionMessageId({
        adapterId,
        sourceId,
        nativeId: timelineEvent.id
      });

      const message: SessionMessage = {
        kind: "session-message",
        id: messageId,
        adapterId,
        sourceId,
        sessionId,
        nativeId: timelineEvent.id,
        role: timelineEvent.role,
        content: timelineEvent.text,
        ordinal: index + 1,
        timestamp: timelineEvent.timestamp,
        eventId,
        confidence: HIGH_CONFIDENCE
      };

      messages.push(message);
      sessionEvent.messageId = messageId;
    }

    if (timelineEvent.kind === "tool-call") {
      const toolCallId = createToolCallId({
        adapterId,
        sourceId,
        nativeId: timelineEvent.id
      });

      const outputArtifactIds = timelineEvent.artifactIds
        .map((artifactId) => ensureOutputArtifact(artifactId, eventId))
        .filter((artifact): artifact is OutputArtifact => artifact !== undefined)
        .map((artifact) => artifact.id);

      const fileMutationIds = timelineEvent.fileMutations.map((fileMutation) => {
        const fileMutationId = createFileMutationEvidenceId({
          adapterId,
          sourceId,
          nativeId: fileMutation.id
        });

        fileMutations.push({
          kind: "file-mutation",
          id: fileMutationId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: fileMutation.id,
          path: fileMutation.path,
          mutationKind: fileMutation.mutationKind,
          eventId,
          toolCallId,
          confidence: HIGH_CONFIDENCE
        });

        return fileMutationId;
      });

      toolCalls.push({
        kind: "tool-call",
        id: toolCallId,
        adapterId,
        sourceId,
        sessionId,
        nativeId: timelineEvent.id,
        toolName: timelineEvent.toolName,
        status: timelineEvent.status,
        startedAt: timelineEvent.timestamp,
        ...(timelineEvent.inputSummary ? { inputSummary: timelineEvent.inputSummary } : {}),
        ...(timelineEvent.outputSummary ? { outputSummary: timelineEvent.outputSummary } : {}),
        eventId,
        ...(outputArtifactIds.length > 0 ? { artifactIds: outputArtifactIds } : {}),
        ...(fileMutationIds.length > 0 ? { fileMutationIds } : {}),
        confidence: HIGH_CONFIDENCE
      });

      sessionEvent.toolCallId = toolCallId;

      const firstFileMutationId = fileMutationIds[0];

      if (firstFileMutationId) {
        sessionEvent.fileMutationId = firstFileMutationId;
      }

      const firstOutputArtifactId = outputArtifactIds[0];

      if (firstOutputArtifactId) {
        sessionEvent.outputArtifactId = firstOutputArtifactId;
      }
    }

    if (timelineEvent.kind === "shell-command") {
      const shellCommandId = createShellCommandEvidenceId({
        adapterId,
        sourceId,
        nativeId: timelineEvent.id
      });

      shellCommands.push({
        kind: "shell-command",
        id: shellCommandId,
        adapterId,
        sourceId,
        sessionId,
        nativeId: timelineEvent.id,
        command: timelineEvent.command,
        outputSource: timelineEvent.outputSource,
        ...(timelineEvent.cwd ? { cwd: timelineEvent.cwd } : {}),
        ...(timelineEvent.exitCode !== undefined ? { exitCode: timelineEvent.exitCode } : {}),
        startedAt: timelineEvent.timestamp,
        ...(timelineEvent.outputSummary ? { outputSummary: timelineEvent.outputSummary } : {}),
        eventId,
        ...(timelineEvent.toolCallId
          ? {
              toolCallId: createToolCallId({
                adapterId,
                sourceId,
                nativeId: timelineEvent.toolCallId
              })
            }
          : {}),
        ...(timelineEvent.artifactIds.length > 0
          ? {
              artifactIds: timelineEvent.artifactIds
                .map((artifactId) => ensureOutputArtifact(artifactId, eventId))
                .filter((artifact): artifact is OutputArtifact => artifact !== undefined)
                .map((artifact) => artifact.id)
            }
          : {}),
        ...(timelineEvent.rawToolStatus ? { rawToolStatus: timelineEvent.rawToolStatus } : {}),
        confidence: HIGH_CONFIDENCE
      });

      sessionEvent.shellCommandId = shellCommandId;
    }

    if (timelineEvent.kind === "output-artifact") {
      const outputArtifact = ensureOutputArtifact(timelineEvent.artifactId, eventId);

      if (outputArtifact) {
        sessionEvent.outputArtifactId = outputArtifact.id;
      } else {
        diagnostics.push(
          buildDiagnostic(
            adapterId,
            "fake-test.artifact.missing",
            `Timeline event referenced unknown artifact '${timelineEvent.artifactId}'.`,
            "warning",
            "artifact",
            HIGH_CONFIDENCE,
            {
              sourceId,
              nativeId: timelineEvent.id,
              relatedEntityIds: [eventId]
            }
          )
        );
      }
    }

    events.push(sessionEvent);
  }

  return {
    adapterId,
    sourceId,
    capabilities: {
      adapter: buildCapabilityEnvelope(fakeTestDescriptor.capabilities),
      source: buildCapabilityEnvelope(fixtureCapabilities, sourceId),
      sessions: [buildSessionCapabilityEnvelope(fixtureCapabilities, sourceId, sessionId)]
    },
    projects,
    sessions,
    events,
    messages,
    toolCalls,
    shellCommands,
    outputArtifacts: [...outputArtifactsByNativeId.values()],
    fileMutations,
    diagnostics
  };
}
