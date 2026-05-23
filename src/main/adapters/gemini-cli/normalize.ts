import path from "node:path";

import type {
  AdapterNormalizationInput,
  AdapterNormalizationResult
} from "../../core/adapter-contract/index.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import type { CapabilityEnvelope, HarnessCapabilities } from "../../core/model/capabilities.js";
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
import { geminiCliDescriptor } from "./descriptor.js";
import { extractTranscriptText, type GeminiRawEvent } from "./parse.js";
import type {
  GeminiLogsEntry,
  GeminiSessionHeader,
  GeminiToolCallRecord,
  GeminiTranscriptRecord
} from "./types.js";

type SessionAccumulator = {
  header?: GeminiSessionHeader;
  lastUpdated?: string;
  logEntries: Array<GeminiLogsEntry & { index?: number }>;
  sidecars: Array<{
    artifactId: string;
    format: "json" | "text" | "unknown";
    mediaType?: string;
    relativePath: string;
    sessionId: string;
    textPreview?: string;
    toolCallId?: string;
    toolName?: string;
  }>;
  transcriptRecords: Array<{
    artifactNativeId: string;
    lineNumber?: number;
    record: GeminiTranscriptRecord;
  }>;
};

function buildCapabilityEnvelope(
  capabilities: HarnessCapabilities,
  sourceId?: string,
  sessionId?: string
): CapabilityEnvelope {
  return {
    adapterId: geminiCliDescriptor.id,
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
    adapterId: geminiCliDescriptor.id,
    sourceId,
    sessionId,
    capabilities
  };
}

export interface GeminiOutputArtifactBinding {
  path: string;
  rawArtifactId: string;
}

export interface GeminiNormalizationExtras {
  outputArtifactBindings: Map<string, GeminiOutputArtifactBinding>;
}

export async function normalizeGeminiCliEvents(
  input: AdapterNormalizationInput<GeminiRawEvent>
): Promise<AdapterNormalizationResult & { extras: GeminiNormalizationExtras }> {
  const adapterId = geminiCliDescriptor.id;
  const sourceId = input.source.id;
  const sourceCapabilities = geminiCliDescriptor.capabilities;
  const parseDiagnostics = input.rawEvents
    .filter(
      (event): event is GeminiRawEvent & { payload: { kind: "parse-diagnostic" } } =>
        event.payload.kind === "parse-diagnostic"
    )
    .map((event) =>
      buildDiagnostic(
        adapterId,
        event.payload.diagnostic.code,
        event.payload.diagnostic.message,
        event.payload.diagnostic.severity,
        "artifact",
        HIGH_CONFIDENCE,
        {
          sourceId,
          nativeId: event.payload.diagnostic.nativeId ?? event.payload.diagnostic.code,
          ...(event.payload.diagnostic.sessionId
            ? { metadata: { sessionId: event.payload.diagnostic.sessionId } }
            : {})
        }
      )
    );

  const projectRootPayload = input.rawEvents.find(
    (event): event is GeminiRawEvent & { payload: { kind: "project-root"; repoRootPath: string } } =>
      event.payload.kind === "project-root"
  );
  const projectRootPath = projectRootPayload?.payload.repoRootPath;
  const projectNativeId = path.basename(projectRootPath ?? input.source.displayName);
  const projectId = createProjectId({
    adapterId,
    sourceId,
    nativeId: projectNativeId
  });

  const projects: Project[] = [
    {
      kind: "project",
      id: projectId,
      adapterId,
      sourceId,
      nativeId: projectNativeId,
      name: path.basename(projectRootPath ?? input.source.displayName),
      ...(projectRootPath ? { rootPath: projectRootPath } : {}),
      confidence: HIGH_CONFIDENCE
    }
  ];

  const sessionData = collectSessionData(input.rawEvents);
  const sessions: Session[] = [];
  const events: SessionEvent[] = [];
  const messages: SessionMessage[] = [];
  const toolCalls: ToolCall[] = [];
  const shellCommands: ShellCommandEvidence[] = [];
  const outputArtifacts: OutputArtifact[] = [];
  const fileMutations: FileMutationEvidence[] = [];
  const diagnostics = [...parseDiagnostics];
  const outputArtifactBindings = new Map<string, GeminiOutputArtifactBinding>();
  const sessionCapabilitySnapshots: Array<CapabilityEnvelope & { sessionId: string }> = [];

  for (const [sessionNativeId, session] of [...sessionData.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    const sessionId = createSessionId({
      adapterId,
      sourceId,
      nativeId: sessionNativeId
    });
    const timeline = buildTimeline(session);
    const lifecycle = deriveLifecycle(timeline);
    const sessionDiagnosticsStart = diagnostics.length;

    if (lifecycle.conflictMessage) {
      diagnostics.push(
        buildDiagnostic(
          adapterId,
          "gemini-cli.normalize.lifecycle-contradiction",
          lifecycle.conflictMessage,
          "warning",
          "session",
          MEDIUM_CONFIDENCE,
          {
            sourceId,
            nativeId: sessionNativeId,
            relatedEntityIds: [sessionId]
          }
        )
      );
    }

    const toolCallMap = new Map<string, ToolCall>();
    const shellCommandMap = new Map<string, ShellCommandEvidence>();
    const fileMutationMap = new Map<string, FileMutationEvidence>();

    let ordinal = 1;

    const lifecycleEventId = createSessionEventId({
      adapterId,
      sourceId,
      nativeId: `${sessionNativeId}:lifecycle`
    });
    events.push({
      kind: "session-event",
      id: lifecycleEventId,
      adapterId,
      sourceId,
      sessionId,
      nativeId: `${sessionNativeId}:lifecycle`,
      eventKind: "lifecycle",
      ...(lifecycle.timestamp ? { timestamp: lifecycle.timestamp } : {}),
      ordinal: ordinal,
      summary: lifecycle.summary,
      confidence: HIGH_CONFIDENCE
    });
    ordinal += 1;

    if (session.header?.projectHash) {
      const metadataEventId = createSessionEventId({
        adapterId,
        sourceId,
        nativeId: `${sessionNativeId}:header-metadata`
      });
      events.push({
        kind: "session-event",
        id: metadataEventId,
        adapterId,
        sourceId,
        sessionId,
        nativeId: `${sessionNativeId}:header-metadata`,
        eventKind: "metadata",
        ...(session.header.startTime ? { timestamp: session.header.startTime } : {}),
        ordinal: ordinal,
        summary: `Project hash ${session.header.projectHash}`,
        confidence: HIGH_CONFIDENCE
      });
      ordinal += 1;
    }

    for (const record of timeline) {
      const recordText = extractTranscriptText(record.record);
      const role = toMessageRole(record.record.type);

      if (recordText) {
        const messageEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: `${sessionNativeId}:message:${record.artifactNativeId}:${record.lineNumber ?? ordinal}`
        });
        const messageId = createSessionMessageId({
          adapterId,
          sourceId,
          nativeId: `${sessionNativeId}:message:${record.record.id}:${record.lineNumber ?? ordinal}`
        });

        messages.push({
          kind: "session-message",
          id: messageId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: `${record.record.id}:${record.lineNumber ?? ordinal}`,
          role,
          content: recordText,
          ordinal: messages.filter((message) => message.sessionId === sessionId).length + 1,
          timestamp: record.record.timestamp,
          eventId: messageEventId,
          confidence: HIGH_CONFIDENCE
        });

        events.push({
          kind: "session-event",
          id: messageEventId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: `${record.artifactNativeId}:message:${record.lineNumber ?? ordinal}`,
          eventKind: "message",
          timestamp: record.record.timestamp,
          ordinal,
          summary: `${role} message`,
          messageId,
          confidence: HIGH_CONFIDENCE
        });
        ordinal += 1;
      }

      for (const [toolIndex, toolCallRecord] of (record.record.toolCalls ?? []).entries()) {
        const toolCallId = createToolCallId({
          adapterId,
          sourceId,
          nativeId: toolCallRecord.id
        });
        const toolCallEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: `${sessionNativeId}:tool-call:${toolCallRecord.id}:${record.lineNumber ?? toolIndex + 1}`
        });
        const matchingSidecars = session.sidecars.filter(
          (sidecar) => sidecar.toolCallId === toolCallRecord.id
        );
        const outputArtifactIds = matchingSidecars.map((sidecar) =>
          createOutputArtifactId({
            adapterId,
            sourceId,
            nativeId: sidecar.relativePath
          })
        );
        const fileMutationIds = buildFileMutationsForToolCall({
          adapterId,
          eventId: toolCallEventId,
          fileMutationMap,
          fileMutations,
          sessionId,
          sourceId,
          toolCallId,
          toolCallRecord
        });

        const toolCall = {
          kind: "tool-call",
          id: toolCallId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: toolCallRecord.id,
          toolName: toolCallRecord.name,
          status: mapToolCallStatus(toolCallRecord.status),
          ...(toolCallRecord.timestamp ?? record.record.timestamp
            ? { startedAt: toolCallRecord.timestamp ?? record.record.timestamp }
            : {}),
          ...(toolCallRecord.timestamp ?? record.record.timestamp
            ? { endedAt: toolCallRecord.timestamp ?? record.record.timestamp }
            : {}),
          ...(toolCallRecord.args
            ? withOptionalSummary("inputSummary", summarizeArgs(toolCallRecord.args))
            : {}),
          ...(toolCallRecord.resultDisplay !== undefined
            ? withOptionalSummary("outputSummary", summarizeUnknown(toolCallRecord.resultDisplay))
            : {}),
          eventId: toolCallEventId,
          ...(outputArtifactIds.length > 0 ? { artifactIds: outputArtifactIds } : {}),
          ...(fileMutationIds.length > 0 ? { fileMutationIds } : {}),
          confidence: HIGH_CONFIDENCE
        } satisfies ToolCall;

        toolCallMap.set(toolCallId, toolCall);
        events.push({
          kind: "session-event",
          id: toolCallEventId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: `${toolCallRecord.id}:${record.lineNumber ?? toolIndex + 1}`,
          eventKind: "tool-call",
          timestamp: toolCallRecord.timestamp ?? record.record.timestamp,
          ordinal,
          summary: `${toolCallRecord.name} ${toolCall.status}`,
          toolCallId,
          confidence: HIGH_CONFIDENCE
        });
        ordinal += 1;

        const shellCommand = buildShellCommandForToolCall({
          adapterId,
          eventId: toolCallEventId,
          outputArtifactIds,
          sessionId,
          sourceId,
          toolCallId,
          toolCallRecord
        });

        if (shellCommand) {
          shellCommandMap.set(shellCommand.id, shellCommand);
          events.push({
            kind: "session-event",
            id: createSessionEventId({
              adapterId,
              sourceId,
              nativeId: `${sessionNativeId}:shell:${toolCallRecord.id}`
            }),
            adapterId,
            sourceId,
            sessionId,
            nativeId: `shell:${toolCallRecord.id}`,
            eventKind: "shell-command",
            timestamp: shellCommand.startedAt ?? record.record.timestamp,
            ordinal,
            summary: shellCommand.command,
            shellCommandId: shellCommand.id,
            confidence: HIGH_CONFIDENCE
          });
          ordinal += 1;
        }

        if (matchingSidecars.length === 0) {
          diagnostics.push(
            buildDiagnostic(
              adapterId,
              "gemini-cli.normalize.missing-sidecar",
              `Gemini tool call '${toolCallRecord.id}' did not have a discovered output sidecar.`,
              "warning",
              "tool-call",
              MEDIUM_CONFIDENCE,
              {
                sourceId,
                nativeId: toolCallRecord.id,
                relatedEntityIds: [sessionId, toolCallId]
              }
            )
          );
        }
      }
    }

    if (timeline.length === 0 && session.logEntries.length > 0) {
      for (const logEntry of sortLogEntries(session.logEntries)) {
        const role = toMessageRole(logEntry.type);
        const messageEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: `${sessionNativeId}:log-message:${logEntry.messageId}`
        });
        const messageId = createSessionMessageId({
          adapterId,
          sourceId,
          nativeId: `${sessionNativeId}:log-message:${logEntry.messageId}`
        });

        messages.push({
          kind: "session-message",
          id: messageId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: `logs:${logEntry.messageId}`,
          role,
          content: logEntry.message,
          ordinal: messages.filter((message) => message.sessionId === sessionId).length + 1,
          timestamp: logEntry.timestamp,
          eventId: messageEventId,
          confidence: HIGH_CONFIDENCE
        });

        events.push({
          kind: "session-event",
          id: messageEventId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: `logs:${logEntry.messageId}`,
          eventKind: "message",
          timestamp: logEntry.timestamp,
          ordinal,
          summary: `${role} message`,
          messageId,
          confidence: HIGH_CONFIDENCE
        });
        ordinal += 1;
      }
    }

    for (const sidecar of session.sidecars) {
      const outputArtifactId = createOutputArtifactId({
        adapterId,
        sourceId,
        nativeId: sidecar.relativePath
      });
      const outputArtifactEventId = createSessionEventId({
        adapterId,
        sourceId,
        nativeId: `${sessionNativeId}:artifact:${sidecar.relativePath}`
      });
      const artifactKind =
        sidecar.format === "json" ? "json" : sidecar.mediaType?.startsWith("text/") ? "text" : "text";
      const matchingArtifact = input.artifacts.find(
        (artifact) => artifact.id === sidecar.artifactId
      );

      outputArtifacts.push({
        kind: "output-artifact",
        id: outputArtifactId,
        adapterId,
        sourceId,
        sessionId,
        nativeId: sidecar.relativePath,
        artifactKind,
        path: sidecar.relativePath,
        ...(sidecar.mediaType ? { mediaType: sidecar.mediaType } : {}),
        ...(matchingArtifact?.byteLength !== undefined
          ? { byteLength: matchingArtifact.byteLength }
          : {}),
        eventId: outputArtifactEventId,
        confidence: HIGH_CONFIDENCE
      });
      if (matchingArtifact) {
        outputArtifactBindings.set(outputArtifactId, {
          path: matchingArtifact.path,
          rawArtifactId: matchingArtifact.id
        });
      }

      events.push({
        kind: "session-event",
        id: outputArtifactEventId,
        adapterId,
        sourceId,
        sessionId,
        nativeId: `artifact:${sidecar.relativePath}`,
        eventKind: "output-artifact",
        ordinal,
        summary: sidecar.relativePath,
        outputArtifactId,
        confidence: HIGH_CONFIDENCE
      });
      ordinal += 1;
    }

    const diagnosticsForSession = diagnostics.slice(sessionDiagnosticsStart).map((diagnostic) => diagnostic.id);
    const startedAt =
      session.header?.startTime ?? timeline[0]?.record.timestamp ?? session.logEntries[0]?.timestamp;

    sessions.push({
      kind: "session",
      id: sessionId,
      adapterId,
      sourceId,
      nativeId: sessionNativeId,
      projectId,
      title: buildSessionTitle(session),
      ...(startedAt ? { startedAt } : {}),
      ...(lifecycle.endedAt ? { endedAt: lifecycle.endedAt } : {}),
      lifecycleState: lifecycle.state,
      ...(diagnosticsForSession.length > 0 ? { diagnosticIds: diagnosticsForSession } : {}),
      confidence: HIGH_CONFIDENCE
    });
    sessionCapabilitySnapshots.push(
      buildSessionCapabilityEnvelope(sourceCapabilities, sourceId, sessionId)
    );
    toolCalls.push(...toolCallMap.values());
    shellCommands.push(...shellCommandMap.values());
  }

  return {
    adapterId,
    sourceId,
    capabilities: {
      adapter: buildCapabilityEnvelope(sourceCapabilities),
      source: buildCapabilityEnvelope(sourceCapabilities, sourceId),
      sessions: sessionCapabilitySnapshots
    },
    projects,
    sessions,
    events,
    messages,
    toolCalls,
    shellCommands,
    outputArtifacts,
    fileMutations,
    diagnostics,
    extras: {
      outputArtifactBindings
    }
  };
}

function collectSessionData(rawEvents: GeminiRawEvent[]): Map<string, SessionAccumulator> {
  const sessions = new Map<string, SessionAccumulator>();

  for (const event of rawEvents) {
    switch (event.payload.kind) {
      case "session-header": {
        const entry = getOrCreateSessionAccumulator(sessions, event.payload.sessionId);
        entry.header = event.payload.header;
        break;
      }
      case "metadata-patch": {
        const entry = getOrCreateSessionAccumulator(sessions, event.payload.sessionId);
        if (typeof event.payload.patch.lastUpdated === "string") {
          entry.lastUpdated = event.payload.patch.lastUpdated;
        }
        break;
      }
      case "logs-entry": {
        const entry = getOrCreateSessionAccumulator(sessions, event.payload.entry.sessionId);
        entry.logEntries.push({
          sessionId: event.payload.entry.sessionId,
          message: event.payload.entry.message,
          messageId: event.payload.entry.messageId,
          timestamp: event.payload.entry.timestamp,
          type: event.payload.entry.type,
          ...(event.payload.origin.index !== undefined
            ? { index: event.payload.origin.index }
            : {})
        });
        break;
      }
      case "transcript-record": {
        const entry = getOrCreateSessionAccumulator(sessions, event.payload.sessionId);
        entry.transcriptRecords.push({
          artifactNativeId: event.payload.origin.artifactNativeId,
          ...(event.payload.origin.lineNumber !== undefined
            ? { lineNumber: event.payload.origin.lineNumber }
            : {}),
          record: event.payload.record
        });
        break;
      }
      case "tool-output-sidecar": {
        const entry = getOrCreateSessionAccumulator(sessions, event.payload.sessionId);
        entry.sidecars.push({
          artifactId: event.artifactId,
          format: event.payload.format,
          relativePath: event.payload.relativePath,
          sessionId: event.payload.sessionId,
          ...(event.payload.mediaType ? { mediaType: event.payload.mediaType } : {}),
          ...(event.payload.textPreview ? { textPreview: event.payload.textPreview } : {}),
          ...(event.payload.toolCallId ? { toolCallId: event.payload.toolCallId } : {}),
          ...(event.payload.toolName ? { toolName: event.payload.toolName } : {})
        });
        break;
      }
      case "project-root":
      case "parse-diagnostic":
        break;
    }
  }

  return sessions;
}

function getOrCreateSessionAccumulator(
  sessions: Map<string, SessionAccumulator>,
  sessionId: string
): SessionAccumulator {
  const existing = sessions.get(sessionId);

  if (existing) {
    return existing;
  }

  const created: SessionAccumulator = {
    logEntries: [],
    sidecars: [],
    transcriptRecords: []
  };
  sessions.set(sessionId, created);
  return created;
}

function buildTimeline(session: SessionAccumulator) {
  return [...session.transcriptRecords].sort((left, right) => {
    if (left.record.timestamp !== right.record.timestamp) {
      return left.record.timestamp.localeCompare(right.record.timestamp);
    }

    return (left.lineNumber ?? 0) - (right.lineNumber ?? 0);
  });
}

function sortLogEntries(entries: SessionAccumulator["logEntries"]) {
  return [...entries].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp.localeCompare(right.timestamp);
    }

    if (left.messageId !== right.messageId) {
      return left.messageId - right.messageId;
    }

    return (left.index ?? 0) - (right.index ?? 0);
  });
}

function deriveLifecycle(timeline: SessionAccumulator["transcriptRecords"]): {
  conflictMessage?: string;
  endedAt?: string;
  state: Session["lifecycleState"];
  summary: string;
  timestamp?: string;
} {
  const lastAssistantResponse = [...timeline]
    .reverse()
    .find(
      (record) =>
        record.record.type === "gemini" &&
        typeof extractTranscriptText(record.record) === "string" &&
        extractTranscriptText(record.record)?.trim().length
    );
  const cancellationRecord = [...timeline]
    .reverse()
    .find(
      (record) =>
        /request cancelled/i.test(extractTranscriptText(record.record) ?? "") ||
        /cancelled/i.test(record.record.type)
    );

  if (cancellationRecord && lastAssistantResponse) {
    if (cancellationRecord.record.timestamp < lastAssistantResponse.record.timestamp) {
      return {
        state: "completed",
        timestamp: lastAssistantResponse.record.timestamp,
        endedAt: lastAssistantResponse.record.timestamp,
        summary: "Completed with conflicting cancellation evidence.",
        conflictMessage:
          "Gemini timeline contained both a cancellation signal and a later completed assistant response."
      };
    }

    return {
      state: "cancelled",
      timestamp: cancellationRecord.record.timestamp,
      endedAt: cancellationRecord.record.timestamp,
      summary: "Cancelled"
    };
  }

  if (cancellationRecord) {
    return {
      state: "cancelled",
      timestamp: cancellationRecord.record.timestamp,
      endedAt: cancellationRecord.record.timestamp,
      summary: "Cancelled"
    };
  }

  if (lastAssistantResponse) {
    return {
      state: "completed",
      timestamp: lastAssistantResponse.record.timestamp,
      endedAt: lastAssistantResponse.record.timestamp,
      summary: "Completed"
    };
  }

  const latestTimestamp = timeline[timeline.length - 1]?.record.timestamp;

  return latestTimestamp
    ? {
        state: "active",
        timestamp: latestTimestamp,
        summary: "Active"
      }
    : {
        state: "active",
        summary: "Active"
      };
}

function buildSessionTitle(session: SessionAccumulator): string {
  const userPrompt = session.transcriptRecords.find((record) => record.record.type === "user");
  const userText = userPrompt ? extractTranscriptText(userPrompt.record) : undefined;

  if (userText && userText.trim().length > 0) {
    return userText.slice(0, 80);
  }

  const firstLog = session.logEntries[0];
  return firstLog?.message.slice(0, 80) ?? "Gemini CLI session";
}

function toMessageRole(type: string): SessionMessage["role"] {
  switch (type) {
    case "user":
      return "user";
    case "gemini":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
    case "info":
    default:
      return "system";
  }
}

function mapToolCallStatus(status?: string): ToolCall["status"] {
  switch (status) {
    case "success":
    case "succeeded":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "started":
    case "running":
      return "started";
    default:
      return "unknown";
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  return keys.map((key) => `${key}=${summarizeUnknown(args[key])}`).join(", ");
}

function summarizeUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function withOptionalSummary<TKey extends "inputSummary" | "outputSummary">(
  key: TKey,
  summary: string
): Partial<Record<TKey, string>> {
  return summary.trim().length > 0 ? ({ [key]: summary } as Partial<Record<TKey, string>>) : {};
}

function buildShellCommandForToolCall(args: {
  adapterId: string;
  eventId: string;
  outputArtifactIds: string[];
  sessionId: string;
  sourceId: string;
  toolCallId: string;
  toolCallRecord: GeminiToolCallRecord;
}): ShellCommandEvidence | null {
  if (args.toolCallRecord.name !== "run_shell_command") {
    return null;
  }

  const command =
    typeof args.toolCallRecord.args?.command === "string"
      ? args.toolCallRecord.args.command
      : "run_shell_command";

  return {
    kind: "shell-command",
    id: createShellCommandEvidenceId({
      adapterId: args.adapterId,
      sourceId: args.sourceId,
      nativeId: `shell:${args.toolCallRecord.id}`
    }),
    adapterId: args.adapterId,
    sourceId: args.sourceId,
    sessionId: args.sessionId,
    nativeId: args.toolCallRecord.id,
    command,
    outputSource: "combined",
    ...(typeof args.toolCallRecord.args?.cwd === "string"
      ? { cwd: args.toolCallRecord.args.cwd }
      : {}),
    ...(args.toolCallRecord.timestamp ? { startedAt: args.toolCallRecord.timestamp } : {}),
    ...(args.toolCallRecord.timestamp ? { endedAt: args.toolCallRecord.timestamp } : {}),
    ...(args.toolCallRecord.resultDisplay !== undefined
      ? withOptionalSummary("outputSummary", summarizeUnknown(args.toolCallRecord.resultDisplay))
      : {}),
    eventId: args.eventId,
    toolCallId: args.toolCallId,
    ...(args.outputArtifactIds.length > 0 ? { artifactIds: args.outputArtifactIds } : {}),
    ...(args.toolCallRecord.status
      ? { rawToolStatus: mapToolCallStatus(args.toolCallRecord.status) }
      : {}),
    confidence: HIGH_CONFIDENCE
  };
}

function buildFileMutationsForToolCall(args: {
  adapterId: string;
  eventId: string;
  fileMutationMap: Map<string, FileMutationEvidence>;
  fileMutations: FileMutationEvidence[];
  sessionId: string;
  sourceId: string;
  toolCallId: string;
  toolCallRecord: GeminiToolCallRecord;
}): string[] {
  const mutationKind = mapFileMutationKind(args.toolCallRecord.name);
  const filePath = extractMutationPath(args.toolCallRecord.args);

  if (!mutationKind || !filePath) {
    return [];
  }

  const mutationId = createFileMutationEvidenceId({
    adapterId: args.adapterId,
    sourceId: args.sourceId,
    nativeId: `${args.toolCallRecord.id}:${filePath}`
  });
  const mutation = {
    kind: "file-mutation",
    id: mutationId,
    adapterId: args.adapterId,
    sourceId: args.sourceId,
    sessionId: args.sessionId,
    nativeId: `${args.toolCallRecord.id}:${filePath}`,
    path: filePath,
    mutationKind,
    eventId: args.eventId,
    toolCallId: args.toolCallId,
    confidence: HIGH_CONFIDENCE
  } satisfies FileMutationEvidence;

  if (!args.fileMutationMap.has(mutationId)) {
    args.fileMutationMap.set(mutationId, mutation);
    args.fileMutations.push(mutation);
  }

  return [mutationId];
}

function mapFileMutationKind(toolName: string): FileMutationEvidence["mutationKind"] | null {
  switch (toolName) {
    case "create_file":
    case "write_file":
      return "created";
    case "replace":
    case "edit_file":
      return "updated";
    case "delete_file":
      return "deleted";
    default:
      return null;
  }
}

function extractMutationPath(
  args?: Record<string, unknown>
): string | undefined {
  if (!args) {
    return undefined;
  }

  const candidateKeys = ["file_path", "path", "target_path"] as const;

  for (const key of candidateKeys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}
