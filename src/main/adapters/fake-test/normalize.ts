import type {
  AdapterNormalizationInput,
  AdapterNormalizationResult
} from "../../core/adapter-contract/index.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../core/model/confidence.js";
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

const CONFIRMED = "confirmed";
const UNKNOWN = "unknown";

function buildCapabilityEnvelope(sourceId?: string, sessionId?: string) {
  return {
    adapterId: fakeTestDescriptor.id,
    ...(sourceId ? { sourceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    capabilities: fakeTestDescriptor.capabilities
  };
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

function buildOrderKey(order: number, nativeId: string): string {
  return `${String(order).padStart(6, "0")}:${nativeId}`;
}

function buildRawPointer(
  rawEvent: FakeRawEvent | undefined,
  pointer: string,
  eventId?: string
): Record<string, string> {
  return {
    ...(rawEvent?.artifactId ? { artifactId: rawEvent.artifactId } : {}),
    ...(rawEvent?.source?.artifactPath ? { path: rawEvent.source.artifactPath } : {}),
    ...(eventId ? { eventId } : {}),
    pointer
  };
}

function summarizeTimelineEvent(event: FakeTimelineEvent): string {
  switch (event.kind) {
    case "lifecycle":
      return event.summary ?? `Session ${event.state}`;
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

function mapToolKind(name: string) {
  switch (name) {
    case "read_file":
      return "read";
    case "search_file":
    case "grep":
      return "search";
    case "create_file":
    case "write_file":
      return "write";
    case "replace":
    case "edit_file":
      return "replace";
    case "run_shell_command":
      return "shell";
    case "update_topic":
      return "topic";
    default:
      return "unknown";
  }
}

function mapToolStatus(status: string) {
  switch (status) {
    case "started":
      return "pending";
    case "succeeded":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "unknown";
  }
}

function mapArtifactShape(artifact: {
  kind: "image" | "json" | "text" | "trace" | "unknown";
  path?: string | undefined;
  mediaType?: string | undefined;
}) {
  if (artifact.kind === "image") {
    return { kind: "screenshot", contentKind: "binary" };
  }

  if (artifact.kind === "json" || artifact.mediaType === "application/json") {
    return { kind: "sidecar", contentKind: "json-output-wrapper" };
  }

  if (artifact.kind === "trace") {
    return { kind: "raw-log", contentKind: "plain-text" };
  }

  if (artifact.kind === "text") {
    return { kind: "sidecar", contentKind: "plain-text" };
  }

  if (artifact.path?.endsWith(".json")) {
    return { kind: "sidecar", contentKind: "json-output-wrapper" };
  }

  return { kind: "unknown", contentKind: "unknown" };
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
    .map((event) => buildParseDiagnostic(sourceId, event.payload.diagnostic, [event.artifactId ?? event.id ?? "parse-diagnostic"]));
  const metadataEvent = input.rawEvents.find(
    (event): event is FakeRawEvent & { payload: { kind: "fixture-metadata" } } =>
      event.payload.kind === "fixture-metadata"
  );

  if (!metadataEvent) {
    return {
      adapterId,
      sourceId,
      capabilities: {
        adapter: buildCapabilityEnvelope(),
        source: buildCapabilityEnvelope(sourceId),
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
    } as unknown as AdapterNormalizationResult;
  }

  const fixture = metadataEvent.payload.fixture;
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

  const diagnostics = [
    ...parseDiagnostics,
    ...fixture.diagnostics.map((diagnostic, index) =>
      buildDiagnostic(
        adapterId,
        diagnostic.code,
        diagnostic.message,
        diagnostic.severity,
        "source",
        HIGH_CONFIDENCE,
        {
          sourceId,
          nativeId: `${fixture.session.id}:diagnostic:${index + 1}`
        }
      )
    )
  ];

  const rawArtifactRefs = fixture.artifacts.map((artifact) => ({
    id: `raw:output-artifact:${artifact.id}`,
    adapterId,
    sourceId,
    ...(artifact.path ? { path: artifact.path } : {}),
    nativeRef: artifact.path ?? artifact.id,
    artifactKind: "output-artifact",
    ...(artifact.byteLength !== undefined ? { sizeBytes: artifact.byteLength } : {}),
    parseStrategy:
      artifact.kind === "json" ? "json" : artifact.kind === "text" || artifact.kind === "trace" ? "text" : "unknown"
  }));

  const outputArtifactsByNativeId = new Map<string, Record<string, unknown>>();
  const messages: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  const shellCommands: Record<string, unknown>[] = [];
  const fileMutations: Record<string, unknown>[] = [];

  const timelineEvents = input.rawEvents.filter(
    (event): event is FakeRawEvent & { payload: { kind: "timeline-event" } } =>
      event.payload.kind === "timeline-event"
  );

  const ensureOutputArtifact = (
    nativeArtifactId: string,
    rawEvent?: FakeRawEvent
  ): string | undefined => {
    const existing = outputArtifactsByNativeId.get(nativeArtifactId);

    if (existing) {
      return existing.id as string;
    }

    const artifactDefinition = fixture.artifacts.find((artifact) => artifact.id === nativeArtifactId);

    if (!artifactDefinition) {
      return undefined;
    }

    const artifactId = createOutputArtifactId({
      adapterId,
      sourceId,
      nativeId: nativeArtifactId
    });
    const shape = mapArtifactShape(artifactDefinition);

	    outputArtifactsByNativeId.set(nativeArtifactId, {
	      id: artifactId,
	      adapterId,
	      sourceId,
	      sessionId,
	      nativeId: nativeArtifactId,
	      nativeRef: artifactDefinition.path ?? artifactDefinition.id,
      ...(artifactDefinition.path ? { path: artifactDefinition.path } : {}),
      kind: shape.kind,
      contentKind: shape.contentKind,
	      ...(artifactDefinition.byteLength !== undefined ? { sizeBytes: artifactDefinition.byteLength } : {}),
	      ...(artifactDefinition.mediaType ? { mediaType: artifactDefinition.mediaType } : {}),
	      ...(artifactDefinition.byteLength !== undefined ? { byteLength: artifactDefinition.byteLength } : {}),
	      loaded: false,
      source: buildRawPointer(
        rawEvent,
        `artifact:${artifactDefinition.path ?? artifactDefinition.id}`
      ),
      diagnostics: []
    });

    return artifactId;
  };

  for (const [index, rawEvent] of timelineEvents.entries()) {
    const timelineEvent = rawEvent.payload.event;
    const eventId = createSessionEventId({
      adapterId,
      sourceId,
      nativeId: timelineEvent.id
    });
    const orderKey = buildOrderKey(index + 1, timelineEvent.id);
    const title = summarizeTimelineEvent(timelineEvent);
	    const sessionEvent: Record<string, unknown> = {
	      id: eventId,
	      sessionId,
	      adapterId,
	      sourceId,
	      nativeId: timelineEvent.id,
	      kind: timelineEvent.kind === "output-artifact" ? "tool-result" : timelineEvent.kind,
	      timestamp: timelineEvent.timestamp,
	      orderKey,
      actor:
        timelineEvent.kind === "message"
          ? timelineEvent.role
          : timelineEvent.kind === "tool-call"
            ? "tool"
            : "harness",
      title,
      text: title,
      raw: buildRawPointer(rawEvent, `event:${timelineEvent.id}`, eventId),
      diagnostics: []
    };

    if (timelineEvent.kind === "message") {
      const messageId = createSessionMessageId({
        adapterId,
        sourceId,
        nativeId: timelineEvent.id
      });

	      messages.push({
	        id: messageId,
	        sessionId,
	        adapterId,
	        sourceId,
	        nativeId: timelineEvent.id,
	        kind: "session-message",
	        role: timelineEvent.role,
	        timestamp: timelineEvent.timestamp,
	        text: timelineEvent.text,
	        toolCallIds: [],
	        eventIds: [eventId],
        source: buildRawPointer(rawEvent, `message:${timelineEvent.id}`, eventId),
        confidence: CONFIRMED
      });
    }

    if (timelineEvent.kind === "tool-call") {
      const toolCallId = createToolCallId({
        adapterId,
        sourceId,
        nativeId: timelineEvent.id
      });
      const outputArtifactIds = timelineEvent.artifactIds.flatMap((artifactId) => {
        const normalizedArtifactId = ensureOutputArtifact(artifactId, rawEvent);
        return normalizedArtifactId ? [normalizedArtifactId] : [];
      });
      const mutationIds = timelineEvent.fileMutations.map((mutation) => {
        const fileMutationId = createFileMutationEvidenceId({
          adapterId,
          sourceId,
          nativeId: mutation.id
        });

        fileMutations.push({
	        id: fileMutationId,
	        sessionId,
	        adapterId,
	        sourceId,
	        nativeId: mutation.id,
	        kind: "file-mutation",
	        path: mutation.path,
          mutationKind: mutation.mutationKind,
	        toolCallId,
          source: buildRawPointer(
            rawEvent,
            `file:${timelineEvent.id}:${mutation.path}`,
            eventId
          ),
          confidence: CONFIRMED,
          diagnostics: []
        });

        return fileMutationId;
      });

      toolCalls.push({
	        id: toolCallId,
	        sessionId,
	        adapterId,
	        sourceId,
	        nativeId: timelineEvent.id,
	        kind: "tool-call",
	        nativeToolCallId: timelineEvent.id,
	        name: timelineEvent.toolName,
	        normalizedKind: mapToolKind(timelineEvent.toolName),
	        statusRaw: timelineEvent.status,
	        statusNormalized: mapToolStatus(timelineEvent.status),
	        ...(timelineEvent.inputSummary ? { argsPreview: timelineEvent.inputSummary } : {}),
	        ...(timelineEvent.outputSummary ? { resultPreview: timelineEvent.outputSummary } : {}),
	        outputArtifactIds,
	        ...(mutationIds[0] ? { fileMutationId: mutationIds[0] } : {}),
        source: buildRawPointer(rawEvent, `tool:${timelineEvent.id}`, eventId),
        confidence: CONFIRMED,
        diagnostics: []
      });
    }

    if (timelineEvent.kind === "shell-command") {
      const shellCommandId = createShellCommandEvidenceId({
        adapterId,
        sourceId,
        nativeId: timelineEvent.id
      });

      shellCommands.push({
	        id: shellCommandId,
	        sessionId,
	        adapterId,
	        sourceId,
	        nativeId: timelineEvent.id,
	        kind: "shell-command",
        ...(timelineEvent.toolCallId
          ? {
              toolCallId: createToolCallId({
                adapterId,
                sourceId,
                nativeId: timelineEvent.toolCallId
              })
            }
          : {}),
	        command: timelineEvent.command,
        ...(timelineEvent.cwd ? { cwd: timelineEvent.cwd } : {}),
	        ...(timelineEvent.outputSummary ? { outputInline: timelineEvent.outputSummary } : {}),
	        outputArtifactIds: timelineEvent.artifactIds.flatMap((artifactId) => {
	          const normalizedArtifactId = ensureOutputArtifact(artifactId, rawEvent);
	          return normalizedArtifactId ? [normalizedArtifactId] : [];
	        }),
	        ...(timelineEvent.rawToolStatus ? { rawStatus: timelineEvent.rawToolStatus } : {}),
	        ...(timelineEvent.exitCode !== undefined ? { rawExitCode: timelineEvent.exitCode } : {}),
        source: buildRawPointer(rawEvent, `shell:${timelineEvent.id}`, eventId),
        confidence: CONFIRMED
      });
    }

    if (timelineEvent.kind === "output-artifact") {
      const outputArtifactId = ensureOutputArtifact(timelineEvent.artifactId, rawEvent);

      if (!outputArtifactId) {
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

  const firstUserPrompt = messages.find((message) => message.role === "user")?.text as string | undefined;
  const latestUserPrompt =
    [...messages].reverse().find((message) => message.role === "user")?.text as string | undefined;
  const latestTimelineTimestamp = [...timelineEvents]
    .reverse()
    .find((event) => typeof event.timestamp === "string")?.timestamp;
  const result = {
    adapterId,
    sourceId,
    capabilities: {
      adapter: buildCapabilityEnvelope(),
      source: buildCapabilityEnvelope(sourceId),
      sessions: [buildCapabilityEnvelope(sourceId, sessionId)]
    },
    projects: [
      {
	        id: projectId,
	        adapterId,
	        sourceId,
	        nativeId: fixture.project.id,
	        kind: "project",
	        displayName: fixture.project.name,
	        name: fixture.project.name,
	        ...(fixture.project.rootPath ? { primaryRootPath: fixture.project.rootPath } : {}),
	        ...(fixture.project.rootPath ? { rootPath: fixture.project.rootPath } : {}),
	        rootConfidence: CONFIRMED,
	        confidence: HIGH_CONFIDENCE,
        harnessRefs: [
          {
            adapterId,
            sourceId,
            nativeProjectId: fixture.project.id,
            ...(fixture.project.rootPath ? { nativeProjectPath: fixture.project.rootPath } : {}),
            ...(fixture.project.rootPath ? { projectRootPath: fixture.project.rootPath } : {}),
            projectRootConfidence: CONFIRMED,
            rawArtifactRefs
          }
        ],
        sessionIds: [sessionId],
        ...(latestTimelineTimestamp ? { latestActivityAt: latestTimelineTimestamp } : {}),
        ...(latestUserPrompt ? { latestPrompt: latestUserPrompt } : {}),
        diagnostics: []
      }
    ],
    sessions: [
      {
	        id: sessionId,
	        adapterId,
	        sourceId,
	        nativeId: fixture.session.id,
	        nativeSessionId: fixture.session.id,
	        kind: "session",
        projectId,
	        ...(fixture.session.title ? { title: fixture.session.title } : {}),
        ...(firstUserPrompt ? { firstUserPrompt } : {}),
        ...(latestUserPrompt ? { latestUserPrompt } : {}),
	        startedAt: fixture.session.startedAt,
        ...(latestTimelineTimestamp ? { lastUpdatedAt: latestTimelineTimestamp } : {}),
        ...(fixture.session.endedAt
          ? {
              durationMs:
                Date.parse(fixture.session.endedAt) - Date.parse(fixture.session.startedAt)
            }
          : {}),
	        lifecycleStatus: fixture.session.lifecycleState,
	        capabilities: fakeTestDescriptor.capabilities,
	        parseConfidence: CONFIRMED,
        messageIds: messages.map((message) => message.id as string),
        eventIds: events.map((event) => event.id as string),
        toolCallIds: toolCalls.map((toolCall) => toolCall.id as string),
        fileMutationIds: fileMutations.map((mutation) => mutation.id as string),
        shellCommandIds: shellCommands.map((command) => command.id as string),
        outputArtifactIds: [...outputArtifactsByNativeId.values()].map((artifact) => artifact.id as string),
	        usage: {},
	        confidence: HIGH_CONFIDENCE,
	        rawArtifactRefs,
        diagnostics: []
      }
    ],
    events,
    messages,
    toolCalls,
    shellCommands,
    outputArtifacts: [...outputArtifactsByNativeId.values()],
    fileMutations,
    diagnostics
  };

  return result as unknown as AdapterNormalizationResult;
}
