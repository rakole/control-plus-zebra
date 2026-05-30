import path from "node:path";

import type {
  AdapterBatchStreamingNormalizationInput,
  AdapterNormalizationInput,
  AdapterNormalizationResult,
  RawArtifactRef
} from "../../core/adapter-contract/index.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE } from "../../core/model/confidence.js";
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

const CONFIRMED = "confirmed";
const INFERRED = "inferred";
const UNKNOWN = "unknown";

type EventLocator = {
  artifactId?: string;
  path?: string;
  nativeId?: string;
  lineNumber?: number;
  recordIndex?: number;
};

type SessionAccumulator = {
  header?: GeminiSessionHeader;
  headerLocator?: EventLocator;
  lastUpdated?: string;
  logEntries: Array<{
    entry: GeminiLogsEntry;
    locator: EventLocator;
  }>;
  sidecars: Array<{
    artifactId: string;
    format: "json" | "text" | "unknown";
    locator: EventLocator;
    mediaType?: string;
    relativePath: string;
    sessionId: string;
    textPreview?: string;
    toolCallId?: string;
    toolName?: string;
  }>;
  transcriptRecords: Array<{
    locator: EventLocator;
    record: GeminiTranscriptRecord;
  }>;
};

type NormalizedMessage = {
  id: string;
  sessionId: string;
  adapterId: string;
  sourceId?: string;
  nativeId?: string;
  kind?: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  timestamp?: string;
  text?: string;
  modelName?: string;
  usage?: NormalizedUsageSummary;
  toolCallIds: string[];
  eventIds: string[];
  source: Record<string, string | number>;
  confidence: string;
};

type NormalizedEvent = {
  id: string;
  sessionId: string;
  adapterId: string;
  sourceId?: string;
  nativeId?: string;
  kind: string;
  timestamp?: string;
  orderKey: string;
  actor?: "user" | "assistant" | "system" | "tool" | "harness" | "unknown";
  title?: string;
  text?: string;
  raw: Record<string, string | number>;
  diagnostics: never[];
};

type NormalizedToolCall = {
  id: string;
  sessionId: string;
  adapterId: string;
  sourceId?: string;
  nativeId?: string;
  kind?: string;
  nativeToolCallId: string;
  name: string;
  normalizedKind: string;
  statusRaw?: string;
  statusNormalized?: string;
  argsPreview?: string;
  resultPreview?: string;
  outputArtifactIds: string[];
  fileMutationId?: string;
  shellCommandId?: string;
  source: Record<string, string | number>;
  confidence: string;
  diagnostics: never[];
};

type NormalizedShellCommand = {
  id: string;
  sessionId: string;
  adapterId: string;
  sourceId?: string;
  nativeId?: string;
  kind?: string;
  toolCallId?: string;
  command?: string;
  cwd?: string;
  outputInline?: string;
  outputArtifactIds: string[];
  rawStatus?: string;
  rawExitCode?: number;
  source: Record<string, string | number>;
  confidence: string;
};

type NormalizedUsageSummary = {
  cacheReadTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type NormalizedOutputArtifact = {
  id: string;
  adapterId: string;
  sourceId: string;
  sessionId?: string;
  nativeId?: string;
  nativeRef?: string;
  path?: string;
  kind: string;
  contentKind: string;
  mediaType?: string;
  sizeBytes?: number;
  mtime?: string;
  preview?: string;
  loaded: boolean;
  source: Record<string, string | number>;
  diagnostics: never[];
};

type NormalizedFileMutation = {
  id: string;
  sessionId: string;
  adapterId: string;
  sourceId?: string;
  nativeId?: string;
  kind?: string;
  path: string;
  mutationKind: string;
  toolCallId?: string;
  source: Record<string, string | number>;
  confidence: string;
  diagnostics: never[];
};

function buildCapabilityEnvelope(sourceId?: string, sessionId?: string) {
  return {
    adapterId: geminiCliDescriptor.id,
    ...(sourceId ? { sourceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    capabilities: geminiCliDescriptor.capabilities
  };
}

function buildOrderKey(order: number, nativeId: string): string {
  return `${String(order).padStart(6, "0")}:${nativeId}`;
}

function buildRawPointer(
  locator: EventLocator | undefined,
  pointer: string,
  eventId?: string
): Record<string, string | number> {
  return {
    ...(locator?.artifactId ? { artifactId: locator.artifactId } : {}),
    ...(locator?.path ? { path: locator.path } : {}),
    ...(locator?.nativeId ? { nativeId: locator.nativeId } : {}),
    ...(locator?.lineNumber !== undefined ? { lineNumber: locator.lineNumber } : {}),
    ...(locator?.recordIndex !== undefined ? { recordIndex: locator.recordIndex } : {}),
    ...(eventId ? { eventId } : {}),
    pointer
  };
}

function mapToolKind(name: string) {
  switch (name) {
    case "read_file":
      return "read";
    case "grep":
    case "grep_search":
    case "search_file":
    case "glob":
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
    case "web_fetch":
      return "network";
    case "mcp":
      return "mcp";
    default:
      return "unknown";
  }
}

function mapToolStatus(status?: string) {
  switch (status) {
    case "success":
    case "succeeded":
    case "completed":
      return "completed";
    case "failed":
    case "error":
    case "cancelled":
      return "failed";
    case "started":
    case "running":
    case "pending":
      return "pending";
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

function optionalString(summary: string | undefined): string | undefined {
  return summary && summary.trim().length > 0 ? summary : undefined;
}

function mapArtifactShape(sidecar: { format: "json" | "text" | "unknown"; mediaType?: string }) {
  if (sidecar.format === "json" || sidecar.mediaType === "application/json") {
    return {
      kind: "sidecar",
      contentKind: "json-output-wrapper"
    };
  }

  if (sidecar.mediaType?.startsWith("image/")) {
    return {
      kind: "screenshot",
      contentKind: "binary"
    };
  }

  if (sidecar.format === "text") {
    return {
      kind: "sidecar",
      contentKind: "plain-text"
    };
  }

  return {
    kind: "unknown",
    contentKind: "unknown"
  };
}

export async function normalizeGeminiCliEvents(
  input: AdapterNormalizationInput<GeminiRawEvent>
): Promise<AdapterNormalizationResult> {
  const adapterId = geminiCliDescriptor.id;
  const sourceId = input.source.id;
  const accumulated = createGeminiNormalizationAccumulator();

  for (const event of input.rawEvents) {
    accumulateGeminiCliEvent(accumulated, event, {
      adapterId,
      sourceId
    });
  }

  return buildNormalizedGeminiCliResult({
    adapterId,
    artifacts: input.artifacts,
    inputSource: input.source,
    parseDiagnostics: accumulated.parseDiagnostics,
    projectRootPath: accumulated.projectRootPath ?? input.source.rootPath,
    sessionData: accumulated.sessions,
    sourceId
  });
}

export async function* normalizeGeminiCliEventBatches(
  input: AdapterBatchStreamingNormalizationInput<GeminiRawEvent>
): AsyncIterable<AdapterNormalizationResult> {
  const adapterId = geminiCliDescriptor.id;
  const sourceId = input.source.id;
  const accumulated = createGeminiNormalizationAccumulator();

  for await (const event of input.rawEvents) {
    accumulateGeminiCliEvent(accumulated, event, {
      adapterId,
      sourceId
    });
  }

  yield buildNormalizedGeminiCliResult({
    adapterId,
    artifacts: input.artifacts,
    inputSource: input.source,
    projectRootPath: accumulated.projectRootPath ?? input.source.rootPath,
    sessionData: accumulated.sessions,
    parseDiagnostics: accumulated.parseDiagnostics,
    sourceId
  });
}

function buildOutputArtifactBinding(
  sessionId: string,
  sidecar: SessionAccumulator["sidecars"][number],
  matchingArtifact?: RawArtifactRef
) {
  if (!matchingArtifact?.path) {
    return undefined;
  }

  const shape = mapArtifactShape(sidecar);

  return {
    id: matchingArtifact.id,
    adapterId: geminiCliDescriptor.id,
    sourceId: matchingArtifact.sourceId,
    sessionId,
    nativeRef: sidecar.relativePath,
    nativeId: sidecar.relativePath,
    path: matchingArtifact.path,
    ...(sidecar.mediaType ? { mediaType: sidecar.mediaType } : {}),
    kind: shape.kind,
    contentKind: shape.contentKind,
    artifactKind: matchingArtifact.artifactKind ?? "output-artifact"
  };
}

interface GeminiNormalizationAccumulator {
  parseDiagnostics: ReturnType<typeof buildDiagnostic>[];
  projectRootPath?: string;
  sessions: Map<string, SessionAccumulator>;
}

function createGeminiNormalizationAccumulator(): GeminiNormalizationAccumulator {
  return {
    parseDiagnostics: [],
    sessions: new Map()
  };
}

function accumulateGeminiCliEvent(
  accumulator: GeminiNormalizationAccumulator,
  event: GeminiRawEvent,
  context: {
    adapterId: string;
    sourceId: string;
  }
): void {
  switch (event.payload.kind) {
    case "parse-diagnostic":
      accumulator.parseDiagnostics.push(
        buildDiagnostic(
          context.adapterId,
          event.payload.diagnostic.code,
          event.payload.diagnostic.message,
          event.payload.diagnostic.severity,
          "artifact",
          HIGH_CONFIDENCE,
          {
            sourceId: context.sourceId,
            nativeId: event.payload.diagnostic.nativeId ?? event.payload.diagnostic.code,
            ...(event.payload.diagnostic.sessionId
              ? { metadata: { sessionId: event.payload.diagnostic.sessionId } }
              : {})
          }
        )
      );
      return;
    case "project-root":
      accumulator.projectRootPath = event.payload.repoRootPath;
      return;
    case "session-header": {
      const entry = getOrCreateSessionAccumulator(accumulator.sessions, event.payload.sessionId);
      entry.header = event.payload.header;
      entry.headerLocator = toEventLocator(event);
      return;
    }
    case "metadata-patch": {
      const entry = getOrCreateSessionAccumulator(accumulator.sessions, event.payload.sessionId);
      if (typeof event.payload.patch.lastUpdated === "string") {
        entry.lastUpdated = event.payload.patch.lastUpdated;
      }
      return;
    }
    case "logs-entry": {
      const entry = getOrCreateSessionAccumulator(accumulator.sessions, event.payload.entry.sessionId);
      entry.logEntries.push({
        entry: event.payload.entry,
        locator: toEventLocator(event)
      });
      return;
    }
    case "transcript-record": {
      const entry = getOrCreateSessionAccumulator(accumulator.sessions, event.payload.sessionId);
      entry.transcriptRecords.push({
        record: event.payload.record,
        locator: toEventLocator(event)
      });
      return;
    }
    case "tool-output-sidecar": {
      const entry = getOrCreateSessionAccumulator(accumulator.sessions, event.payload.sessionId);
      entry.sidecars.push({
        artifactId: event.artifactId ?? event.id ?? event.payload.relativePath,
        format: event.payload.format,
        locator: toEventLocator(event),
        relativePath: event.payload.relativePath,
        sessionId: event.payload.sessionId,
        ...(event.payload.mediaType ? { mediaType: event.payload.mediaType } : {}),
        ...(event.payload.textPreview ? { textPreview: event.payload.textPreview } : {}),
        ...(event.payload.toolCallId ? { toolCallId: event.payload.toolCallId } : {}),
        ...(event.payload.toolName ? { toolName: event.payload.toolName } : {})
      });
      return;
    }
  }
}

function buildNormalizedGeminiCliResult(args: {
  adapterId: string;
  artifacts: RawArtifactRef[];
  inputSource: AdapterNormalizationInput<GeminiRawEvent>["source"];
  parseDiagnostics: ReturnType<typeof buildDiagnostic>[];
  projectRootPath: string;
  sessionData: Map<string, SessionAccumulator>;
  sourceId: string;
}): AdapterNormalizationResult {
  const adapterId = args.adapterId;
  const sourceId = args.sourceId;
  const projectRootPath = args.projectRootPath;
  const projectNativeId = path.basename(projectRootPath || args.inputSource.displayName);
  const projectId = createProjectId({
    adapterId,
    sourceId,
    nativeId: projectNativeId
  });
  const sessionData = args.sessionData;
  const rawArtifactsById = new Map(args.artifacts.map((artifact) => [artifact.id, artifact]));
  const diagnostics = [...args.parseDiagnostics];

  const sessions: Record<string, unknown>[] = [];
  const events: NormalizedEvent[] = [];
  const messages: NormalizedMessage[] = [];
  const toolCalls: NormalizedToolCall[] = [];
  const shellCommands: NormalizedShellCommand[] = [];
  const outputArtifacts: NormalizedOutputArtifact[] = [];
  const fileMutations: NormalizedFileMutation[] = [];
  const sessionCapabilitySnapshots: Array<Record<string, unknown>> = [];
  const projectRawArtifactRefs = uniqueRawArtifactRefs(
    args.artifacts
      .filter(
        (artifact) =>
          artifact.artifactKind !== "output-artifact" && artifact.artifactKind !== "session-log"
      )
      .map((artifact) => toRawArtifactRef(artifact))
  );
  const sessionSummaries: Array<{
    id: string;
    latestActivityAt?: string;
    latestUserPrompt?: string;
  }> = [];

  for (const [sessionNativeId, session] of [...sessionData.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    const sessionId = createSessionId({
      adapterId,
      sourceId,
      nativeId: sessionNativeId
    });
    const timeline = buildTimeline(session);
    const toolCallCounts = countToolCallOccurrences(timeline);
    const lifecycle = deriveLifecycle(timeline);
    const sessionOutputArtifacts = new Map<string, NormalizedOutputArtifact>();
    const sessionToolCalls = new Map<string, NormalizedToolCall>();
    const sessionShellCommands = new Map<string, NormalizedShellCommand>();
    const sessionFileMutations = new Map<string, NormalizedFileMutation>();
    const sessionMessages: NormalizedMessage[] = [];
    const sessionEvents: NormalizedEvent[] = [];
    const warnedAmbiguousSidecars = new Set<string>();
    let ordinal = 1;

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

    const lifecycleEventNativeId = `${sessionNativeId}:lifecycle`;
    const lifecycleEventId = createSessionEventId({
      adapterId,
      sourceId,
      nativeId: lifecycleEventNativeId
    });
    sessionEvents.push({
      id: lifecycleEventId,
      sessionId,
      adapterId,
      sourceId,
      nativeId: lifecycleEventNativeId,
      kind: "lifecycle",
      ...(lifecycle.timestamp ? { timestamp: lifecycle.timestamp } : {}),
      orderKey: buildOrderKey(ordinal, lifecycleEventNativeId),
      actor: "harness",
      title: lifecycle.summary,
      text: lifecycle.summary,
      raw: buildRawPointer(session.headerLocator, `event:${lifecycleEventNativeId}`, lifecycleEventId),
      diagnostics: []
    });
    ordinal += 1;

    if (session.header?.projectHash) {
      const metadataNativeId = `${sessionNativeId}:header-metadata`;
      const metadataEventId = createSessionEventId({
        adapterId,
        sourceId,
        nativeId: metadataNativeId
      });
      const summary = `Project hash ${session.header.projectHash}`;
      sessionEvents.push({
        id: metadataEventId,
        sessionId,
        adapterId,
        sourceId,
        nativeId: metadataNativeId,
        kind: "metadata",
        ...(session.header.startTime ? { timestamp: session.header.startTime } : {}),
        orderKey: buildOrderKey(ordinal, metadataNativeId),
        actor: "harness",
        title: summary,
        text: summary,
        raw: buildRawPointer(session.headerLocator, `event:${metadataNativeId}`, metadataEventId),
        diagnostics: []
      });
      ordinal += 1;
    }

    for (const record of timeline) {
      const recordText = extractTranscriptText(record.record);
      const role = toMessageRole(record.record.type);

      if (recordText) {
        const messageNativeId = `${record.record.id}:${record.locator.lineNumber ?? ordinal}`;
        const eventNativeId = `${record.locator.nativeId ?? record.record.id}:message:${record.locator.lineNumber ?? ordinal}`;
        const messageEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: eventNativeId
        });
        const messageId = createSessionMessageId({
          adapterId,
          sourceId,
          nativeId: messageNativeId
        });
        const summary = `${role} message`;

        const message: NormalizedMessage = {
          id: messageId,
          sessionId,
          adapterId,
          sourceId,
          nativeId: messageNativeId,
          kind: "session-message",
          role,
          ...(record.record.timestamp ? { timestamp: record.record.timestamp } : {}),
          text: recordText,
          ...(record.record.model ? { modelName: resolveModelName(record.record.model) } : {}),
          ...(record.record.tokens ? { usage: toUsageSummary(record.record.tokens) } : {}),
          toolCallIds: [],
          eventIds: [messageEventId],
          source: buildRawPointer(record.locator, `message:${messageNativeId}`, messageEventId),
          confidence: CONFIRMED
        };

        sessionMessages.push(message);
        sessionEvents.push({
          id: messageEventId,
          sessionId,
          adapterId,
          sourceId,
          nativeId: eventNativeId,
          kind: "message",
          ...(record.record.timestamp ? { timestamp: record.record.timestamp } : {}),
          orderKey: buildOrderKey(ordinal, eventNativeId),
          actor: role,
          title: summary,
          text: summary,
          raw: buildRawPointer(record.locator, `event:${eventNativeId}`, messageEventId),
          diagnostics: []
        });
        ordinal += 1;
      }

      for (const [toolIndex, toolCallRecord] of (record.record.toolCalls ?? []).entries()) {
        const toolCallId = createToolCallId({
          adapterId,
          sourceId,
          nativeId: toolCallRecord.id
        });
        const eventNativeId = `${toolCallRecord.id}:${record.locator.lineNumber ?? toolIndex + 1}`;
        const toolCallEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: eventNativeId
        });
        const matchingSidecars = session.sidecars.filter(
          (sidecar) => sidecar.toolCallId === toolCallRecord.id
        );
        const duplicateToolCallCount = toolCallCounts.get(toolCallRecord.id) ?? 0;
        const sidecarLinkageIsAmbiguous =
          duplicateToolCallCount > 1 && matchingSidecars.length > 0;
        const linkedSidecars = sidecarLinkageIsAmbiguous ? [] : matchingSidecars;

        if (sidecarLinkageIsAmbiguous && !warnedAmbiguousSidecars.has(toolCallRecord.id)) {
          diagnostics.push(
            buildDiagnostic(
              adapterId,
              "gemini-cli.normalize.ambiguous-sidecar",
              `Gemini tool call '${toolCallRecord.id}' reused a native tool-call ID across ${duplicateToolCallCount} occurrences, so discovered sidecars remain unlinked to avoid ambiguous attribution.`,
              "warning",
              "tool-call",
              MEDIUM_CONFIDENCE,
              {
                sourceId,
                nativeId: `${toolCallRecord.id}:ambiguous-sidecar`,
                relatedEntityIds: [sessionId, toolCallId],
                metadata: {
                  duplicateOccurrences: duplicateToolCallCount,
                  sidecarCount: matchingSidecars.length
                }
              }
            )
          );
          warnedAmbiguousSidecars.add(toolCallRecord.id);
        }

        const outputArtifactIds = linkedSidecars.flatMap((sidecar) => {
          const matchingArtifact = rawArtifactsById.get(sidecar.artifactId);
          const outputArtifactId = createOutputArtifactId({
            adapterId,
            sourceId,
            nativeId: sidecar.relativePath
          });

          if (!sessionOutputArtifacts.has(outputArtifactId)) {
            const shape = mapArtifactShape(sidecar);
            sessionOutputArtifacts.set(outputArtifactId, {
              id: outputArtifactId,
              adapterId,
              sourceId,
              sessionId,
              nativeId: sidecar.relativePath,
              nativeRef: sidecar.relativePath,
              path: sidecar.relativePath,
              kind: shape.kind,
              contentKind: shape.contentKind,
              ...(sidecar.mediaType ? { mediaType: sidecar.mediaType } : {}),
              ...(matchingArtifact?.sizeBytes !== undefined
                ? { sizeBytes: matchingArtifact.sizeBytes }
                : matchingArtifact?.byteLength !== undefined
                  ? { sizeBytes: matchingArtifact.byteLength }
                  : {}),
              ...(matchingArtifact?.mtime ? { mtime: matchingArtifact.mtime } : {}),
              ...(sidecar.textPreview ? { preview: sidecar.textPreview } : {}),
              loaded: false,
              ...(() => {
                const binding = buildOutputArtifactBinding(sessionId, sidecar, matchingArtifact);
                return binding ? { ref: binding } : {};
              })(),
              source: buildRawPointer(sidecar.locator, `artifact:${sidecar.relativePath}`),
              diagnostics: []
            });
          }

          return [outputArtifactId];
        });
        const fileMutationId = buildFileMutationForToolCall({
          adapterId,
          fileMutationMap: sessionFileMutations,
          sessionId,
          sourceId,
          toolCallId,
          toolCallRecord,
          locator: record.locator
        });
        const shellEventNativeId = `shell:${toolCallRecord.id}`;
        const shellEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: shellEventNativeId
        });
        const shellCommand = buildShellCommandForToolCall({
          adapterId,
          outputArtifactIds,
          sessionId,
          sourceEventId: shellEventId,
          sourceId,
          toolCallId,
          toolCallRecord,
          locator: record.locator
        });

        sessionToolCalls.set(toolCallId, {
          id: toolCallId,
          sessionId,
          adapterId,
          sourceId,
          nativeId: toolCallRecord.id,
          kind: "tool-call",
          nativeToolCallId: toolCallRecord.id,
          name: toolCallRecord.name,
          normalizedKind: mapToolKind(toolCallRecord.name),
          ...(toolCallRecord.status ? { statusRaw: toolCallRecord.status } : {}),
          ...(toolCallRecord.status ? { statusNormalized: mapToolStatus(toolCallRecord.status) } : {}),
          ...(toolCallRecord.args
            ? (() => {
                const argsPreview = optionalString(summarizeArgs(toolCallRecord.args));
                return argsPreview ? { argsPreview } : {};
              })()
            : {}),
          ...(toolCallRecord.resultDisplay !== undefined
            ? (() => {
                const resultPreview = optionalString(summarizeUnknown(toolCallRecord.resultDisplay));
                return resultPreview ? { resultPreview } : {};
              })()
            : {}),
          outputArtifactIds,
          ...(fileMutationId ? { fileMutationId } : {}),
          ...(shellCommand ? { shellCommandId: shellCommand.id } : {}),
          source: buildRawPointer(record.locator, `tool:${toolCallRecord.id}`, toolCallEventId),
          confidence: CONFIRMED,
          diagnostics: []
        });

        const toolSummary = `${toolCallRecord.name} ${toolCallRecord.status ?? "unknown"}`;
        sessionEvents.push({
          id: toolCallEventId,
          sessionId,
          adapterId,
          sourceId,
          nativeId: eventNativeId,
          kind: "tool-call",
          ...(toolCallRecord.timestamp ?? record.record.timestamp
            ? { timestamp: toolCallRecord.timestamp ?? record.record.timestamp }
            : {}),
          orderKey: buildOrderKey(ordinal, eventNativeId),
          actor: "tool",
          title: toolSummary,
          text: toolSummary,
          raw: buildRawPointer(record.locator, `event:${eventNativeId}`, toolCallEventId),
          diagnostics: []
        });
        ordinal += 1;

        if (shellCommand) {
          sessionShellCommands.set(shellCommand.id, shellCommand);
          const shellSummary = shellCommand.command ?? "run_shell_command";
          sessionEvents.push({
            id: shellEventId,
            sessionId,
            adapterId,
            sourceId,
            nativeId: shellEventNativeId,
            kind: "shell-command",
            ...(toolCallRecord.timestamp ?? record.record.timestamp
              ? { timestamp: toolCallRecord.timestamp ?? record.record.timestamp }
              : {}),
            orderKey: buildOrderKey(ordinal, shellEventNativeId),
            actor: "harness",
            title: shellSummary,
            text: shellSummary,
            raw: buildRawPointer(record.locator, `event:${shellEventNativeId}`, shellEventId),
            diagnostics: []
          });
          ordinal += 1;
        }

        if (shouldWarnMissingSidecar(toolCallRecord, linkedSidecars.length)) {
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
      for (const [index, logRecord] of sortLogEntries(session.logEntries).entries()) {
        const role = toMessageRole(logRecord.entry.type);
        const messageNativeId = `logs:${logRecord.entry.messageId}`;
        const eventNativeId = `${logRecord.locator.nativeId ?? "logs"}:message:${logRecord.entry.messageId}`;
        const messageEventId = createSessionEventId({
          adapterId,
          sourceId,
          nativeId: eventNativeId
        });
        const messageId = createSessionMessageId({
          adapterId,
          sourceId,
          nativeId: messageNativeId
        });
        const summary = `${role} message`;

        sessionMessages.push({
          id: messageId,
          sessionId,
          adapterId,
          role,
          timestamp: logRecord.entry.timestamp,
          text: logRecord.entry.message,
          toolCallIds: [],
          eventIds: [messageEventId],
          source: buildRawPointer(logRecord.locator, `message:${messageNativeId}`, messageEventId),
          confidence: CONFIRMED
        });
        sessionEvents.push({
          id: messageEventId,
          sessionId,
          adapterId,
          kind: "message",
          timestamp: logRecord.entry.timestamp,
          orderKey: buildOrderKey(ordinal, `${eventNativeId}:${index + 1}`),
          actor: role,
          title: summary,
          text: summary,
          raw: buildRawPointer(logRecord.locator, `event:${eventNativeId}`, messageEventId),
          diagnostics: []
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
      const outputArtifactEventNativeId = `artifact:${sidecar.relativePath}`;
      const outputArtifactEventId = createSessionEventId({
        adapterId,
        sourceId,
        nativeId: outputArtifactEventNativeId
      });
      const matchingArtifact = rawArtifactsById.get(sidecar.artifactId);

      if (!sessionOutputArtifacts.has(outputArtifactId)) {
        const shape = mapArtifactShape(sidecar);
        sessionOutputArtifacts.set(outputArtifactId, {
          id: outputArtifactId,
          adapterId,
          sourceId,
          sessionId,
          nativeId: sidecar.relativePath,
          nativeRef: sidecar.relativePath,
          path: sidecar.relativePath,
          kind: shape.kind,
          contentKind: shape.contentKind,
          ...(sidecar.mediaType ? { mediaType: sidecar.mediaType } : {}),
          ...(matchingArtifact?.sizeBytes !== undefined
            ? { sizeBytes: matchingArtifact.sizeBytes }
            : matchingArtifact?.byteLength !== undefined
              ? { sizeBytes: matchingArtifact.byteLength }
              : {}),
          ...(matchingArtifact?.mtime ? { mtime: matchingArtifact.mtime } : {}),
          ...(sidecar.textPreview ? { preview: sidecar.textPreview } : {}),
          loaded: false,
          ...(() => {
            const binding = buildOutputArtifactBinding(sessionId, sidecar, matchingArtifact);
            return binding ? { ref: binding } : {};
          })(),
          source: buildRawPointer(sidecar.locator, `artifact:${sidecar.relativePath}`),
          diagnostics: []
        });
      }

      sessionEvents.push({
        id: outputArtifactEventId,
        sessionId,
        adapterId,
        sourceId,
        nativeId: outputArtifactEventNativeId,
        kind: "tool-result",
        orderKey: buildOrderKey(ordinal, outputArtifactEventNativeId),
        actor: "harness",
        title: sidecar.relativePath,
        text: sidecar.relativePath,
        raw: buildRawPointer(
          sidecar.locator,
          `event:${outputArtifactEventNativeId}`,
          outputArtifactEventId
        ),
        diagnostics: []
      });
      ordinal += 1;
    }

    const firstUserPrompt = sessionMessages.find((message) => message.role === "user")?.text;
    const latestUserPrompt = [...sessionMessages]
      .reverse()
      .find((message) => message.role === "user")?.text;
    const lastUpdatedAt =
      session.lastUpdated ??
      session.header?.lastUpdated ??
      [...timeline].reverse().find((record) => record.record.timestamp)?.record.timestamp ??
      [...session.logEntries].reverse().find((entry) => entry.entry.timestamp)?.entry.timestamp;
    const startedAt =
      session.header?.startTime ??
      timeline[0]?.record.timestamp ??
      session.logEntries[0]?.entry.timestamp;
    const sessionRawArtifactRefs = uniqueRawArtifactRefs(
      [
        ...(session.headerLocator?.artifactId ? [session.headerLocator.artifactId] : []),
        ...session.transcriptRecords.flatMap((record) =>
          record.locator.artifactId ? [record.locator.artifactId] : []
        ),
        ...session.logEntries.flatMap((entry) =>
          entry.locator.artifactId ? [entry.locator.artifactId] : []
        ),
        ...session.sidecars.map((sidecar) => sidecar.artifactId)
      ]
        .map((artifactId) => rawArtifactsById.get(artifactId))
        .filter((artifact): artifact is RawArtifactRef => Boolean(artifact))
        .map((artifact) => toRawArtifactRef(artifact))
    );
    sessions.push({
      id: sessionId,
      adapterId,
      sourceId,
      nativeId: sessionNativeId,
      nativeSessionId: sessionNativeId,
      kind: "session",
      projectId,
      ...(buildSessionTitle(session) ? { title: buildSessionTitle(session) } : {}),
      ...(firstUserPrompt ? { firstUserPrompt } : {}),
      ...(latestUserPrompt ? { latestUserPrompt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
      ...(startedAt && lastUpdatedAt
        ? { durationMs: Math.max(0, Date.parse(lastUpdatedAt) - Date.parse(startedAt)) }
        : {}),
      lifecycleStatus: lifecycle.state,
      capabilities: geminiCliDescriptor.capabilities,
      parseConfidence: timeline.length > 0 || session.logEntries.length > 0 ? CONFIRMED : UNKNOWN,
      messageIds: sessionMessages.map((message) => message.id),
      eventIds: sessionEvents.map((event) => event.id),
      toolCallIds: [...sessionToolCalls.values()].map((toolCall) => toolCall.id),
      fileMutationIds: [...sessionFileMutations.values()].map((mutation) => mutation.id),
      shellCommandIds: [...sessionShellCommands.values()].map((command) => command.id),
      outputArtifactIds: [...sessionOutputArtifacts.values()].map((artifact) => artifact.id),
      usage: buildSessionUsage(timeline.map((record) => record.record)),
      rawArtifactRefs: sessionRawArtifactRefs,
      diagnostics: []
    });
    sessionCapabilitySnapshots.push(buildCapabilityEnvelope(sourceId, sessionId));
    sessionSummaries.push({
      id: sessionId,
      ...(lastUpdatedAt ? { latestActivityAt: lastUpdatedAt } : {}),
      ...(latestUserPrompt ? { latestUserPrompt } : {})
    });
    events.push(...sessionEvents);
    messages.push(...sessionMessages);
    toolCalls.push(...sessionToolCalls.values());
    shellCommands.push(...sessionShellCommands.values());
    outputArtifacts.push(...sessionOutputArtifacts.values());
    fileMutations.push(...sessionFileMutations.values());
  }

  const latestSessionSummary = [...sessionSummaries]
    .filter((summary) => summary.latestActivityAt)
    .sort((left, right) => (right.latestActivityAt ?? "").localeCompare(left.latestActivityAt ?? ""))[0];
  const project = {
    id: projectId,
    adapterId,
    sourceId,
    nativeId: projectNativeId,
    kind: "project",
    displayName: path.basename(projectRootPath || args.inputSource.displayName),
    name: path.basename(projectRootPath || args.inputSource.displayName),
    ...(projectRootPath ? { primaryRootPath: projectRootPath } : {}),
    ...(projectRootPath ? { rootPath: projectRootPath } : {}),
    rootConfidence: projectRootPath ? CONFIRMED : INFERRED,
    harnessRefs: [
      {
        adapterId,
        sourceId,
        nativeProjectId: projectNativeId,
        ...(projectRootPath ? { nativeProjectPath: projectRootPath } : {}),
        ...(projectRootPath ? { projectRootPath } : {}),
        projectRootConfidence: projectRootPath ? CONFIRMED : INFERRED,
        rawArtifactRefs: projectRawArtifactRefs
      }
    ],
    sessionIds: sessions.map((session) => session.id as string),
    ...(latestSessionSummary?.latestActivityAt
      ? { latestActivityAt: latestSessionSummary.latestActivityAt }
      : {}),
    ...(latestSessionSummary?.latestUserPrompt ? { latestPrompt: latestSessionSummary.latestUserPrompt } : {}),
    diagnostics: []
  };

  return {
    adapterId,
    sourceId,
    capabilities: {
      adapter: buildCapabilityEnvelope(),
      source: buildCapabilityEnvelope(sourceId),
      sessions: sessionCapabilitySnapshots
    },
    projects: [project],
    sessions,
    events,
    messages,
    toolCalls,
    shellCommands,
    outputArtifacts,
    fileMutations,
    diagnostics
  } as unknown as AdapterNormalizationResult;
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

function toEventLocator(event: GeminiRawEvent): EventLocator {
  return {
    ...(event.artifactId ? { artifactId: event.artifactId } : {}),
    ...(event.source?.artifactPath ? { path: event.source.artifactPath } : {}),
    ...(event.source?.nativeRef ? { nativeId: event.source.nativeRef } : {}),
    ...(event.source?.lineNumber !== undefined ? { lineNumber: event.source.lineNumber } : {}),
    ...(event.source?.recordIndex !== undefined ? { recordIndex: event.source.recordIndex } : {})
  };
}

function buildTimeline(session: SessionAccumulator) {
  return [...session.transcriptRecords].sort((left, right) => {
    if (left.record.timestamp !== right.record.timestamp) {
      return left.record.timestamp.localeCompare(right.record.timestamp);
    }

    return (left.locator.lineNumber ?? 0) - (right.locator.lineNumber ?? 0);
  });
}

function countToolCallOccurrences(timeline: ReturnType<typeof buildTimeline>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const record of timeline) {
    for (const toolCallRecord of record.record.toolCalls ?? []) {
      counts.set(toolCallRecord.id, (counts.get(toolCallRecord.id) ?? 0) + 1);
    }
  }

  return counts;
}

function shouldWarnMissingSidecar(
  toolCallRecord: GeminiToolCallRecord,
  sidecarCount: number
): boolean {
  return sidecarCount === 0 && !hasInlineToolResult(toolCallRecord);
}

function hasInlineToolResult(toolCallRecord: GeminiToolCallRecord): boolean {
  if (
    toolCallRecord.resultDisplay !== undefined &&
    optionalString(summarizeUnknown(toolCallRecord.resultDisplay))
  ) {
    return true;
  }

  return Array.isArray(toolCallRecord.result) && toolCallRecord.result.length > 0;
}

function toUsageSummary(
  tokens: NonNullable<GeminiTranscriptRecord["tokens"]>
): NormalizedUsageSummary {
  const usage: NormalizedUsageSummary = {};

  if (typeof tokens.input === "number") {
    usage.inputTokens = tokens.input;
  }

  if (typeof tokens.output === "number") {
    usage.outputTokens = tokens.output;
  }

  if (typeof tokens.total === "number") {
    usage.totalTokens = tokens.total;
  }

  if (typeof tokens.cached === "number") {
    usage.cacheReadTokens = tokens.cached;
  }

  return removeUndefinedUsageFields(usage);
}

function buildSessionUsage(records: GeminiTranscriptRecord[]): NormalizedUsageSummary {
  const totals = records.reduce<Required<NormalizedUsageSummary>>(
    (current, record) => {
      const usage = record.tokens ? toUsageSummary(record.tokens) : {};

      return {
        inputTokens: current.inputTokens + (usage.inputTokens ?? 0),
        outputTokens: current.outputTokens + (usage.outputTokens ?? 0),
        totalTokens: current.totalTokens + (usage.totalTokens ?? 0),
        cacheReadTokens: current.cacheReadTokens + (usage.cacheReadTokens ?? 0)
      };
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0
    }
  );

  return removeUndefinedUsageFields({
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    cacheReadTokens: totals.cacheReadTokens
  });
}

function removeUndefinedUsageFields(
  usage: Required<NormalizedUsageSummary>
): NormalizedUsageSummary;
function removeUndefinedUsageFields(usage: NormalizedUsageSummary): NormalizedUsageSummary;
function removeUndefinedUsageFields(usage: NormalizedUsageSummary): NormalizedUsageSummary {
  return Object.fromEntries(
    Object.entries(usage).filter(([, value]) => typeof value === "number" && value > 0)
  ) as NormalizedUsageSummary;
}

function sortLogEntries(entries: SessionAccumulator["logEntries"]) {
  return [...entries].sort((left, right) => {
    if (left.entry.timestamp !== right.entry.timestamp) {
      return left.entry.timestamp.localeCompare(right.entry.timestamp);
    }

    if (left.entry.messageId !== right.entry.messageId) {
      return left.entry.messageId - right.entry.messageId;
    }

    return (left.locator.recordIndex ?? 0) - (right.locator.recordIndex ?? 0);
  });
}

function deriveLifecycle(timeline: SessionAccumulator["transcriptRecords"]): {
  conflictMessage?: string;
  state: "active" | "completed" | "cancelled" | "unknown";
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
        summary: "Completed with conflicting cancellation evidence.",
        conflictMessage:
          "Gemini timeline contained both a cancellation signal and a later completed assistant response."
      };
    }

    return {
      state: "cancelled",
      timestamp: cancellationRecord.record.timestamp,
      summary: "Cancelled"
    };
  }

  if (cancellationRecord) {
    return {
      state: "cancelled",
      timestamp: cancellationRecord.record.timestamp,
      summary: "Cancelled"
    };
  }

  if (lastAssistantResponse) {
    return {
      state: "completed",
      timestamp: lastAssistantResponse.record.timestamp,
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
        state: "unknown",
        summary: "Unknown"
      };
}

function buildSessionTitle(session: SessionAccumulator): string {
  const userPrompt = session.transcriptRecords.find((record) => record.record.type === "user");
  const userText = userPrompt ? extractTranscriptText(userPrompt.record) : undefined;

  if (userText && userText.trim().length > 0) {
    return userText.slice(0, 80);
  }

  const firstLog = session.logEntries[0];
  return firstLog?.entry.message.slice(0, 80) ?? "Gemini CLI session";
}

const TABNINE_MODEL_ALISES: Readonly<Record<string, string>> = {
    "d5ff943b-972a-45e7-9242-a3367c907078": "Claude 4.6 Sonnet",
    "01a524ea-36d3-4ebd-a78a-ff5ed37b1533": "GPT-5.4"
}

function resolveModelName(model: string): string {
    return TABNINE_MODEL_ALISES[model] ?? model;
}

function toMessageRole(type: string): "user" | "assistant" | "system" | "tool" | "unknown" {
  switch (type) {
    case "user":
      return "user";
    case "gemini":
    case "tabnine":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
    case "info":
    case "error":
      return "system";
    default:
      return "unknown";
  }
}

function buildShellCommandForToolCall(args: {
  adapterId: string;
  locator: EventLocator;
  outputArtifactIds: string[];
  sessionId: string;
  sourceEventId: string;
  sourceId: string;
  toolCallId: string;
  toolCallRecord: GeminiToolCallRecord;
}): NormalizedShellCommand | null {
  if (args.toolCallRecord.name !== "run_shell_command") {
    return null;
  }

  const command =
    typeof args.toolCallRecord.args?.command === "string"
      ? args.toolCallRecord.args.command
      : "run_shell_command";
  const shellCommandId = createShellCommandEvidenceId({
    adapterId: args.adapterId,
    sourceId: args.sourceId,
    nativeId: `shell:${args.toolCallRecord.id}`
  });
  const outputInline =
    args.toolCallRecord.resultDisplay !== undefined
      ? optionalString(summarizeUnknown(args.toolCallRecord.resultDisplay))
      : undefined;

	  return {
	    id: shellCommandId,
	    sessionId: args.sessionId,
	    adapterId: args.adapterId,
	    sourceId: args.sourceId,
	    nativeId: `shell:${args.toolCallRecord.id}`,
	    kind: "shell-command",
	    toolCallId: args.toolCallId,
	    command,
    ...(typeof args.toolCallRecord.args?.cwd === "string"
      ? { cwd: args.toolCallRecord.args.cwd }
      : {}),
	    ...(outputInline ? { outputInline } : {}),
	    outputArtifactIds: args.outputArtifactIds,
	    ...(args.toolCallRecord.status ? { rawStatus: args.toolCallRecord.status } : {}),
	    source: buildRawPointer(
      args.locator,
      `shell:${args.toolCallRecord.id}`,
      args.sourceEventId
    ),
	    confidence: CONFIRMED
  };
}

function buildFileMutationForToolCall(args: {
  adapterId: string;
  fileMutationMap: Map<string, NormalizedFileMutation>;
  locator: EventLocator;
  sessionId: string;
  sourceId: string;
  toolCallId: string;
  toolCallRecord: GeminiToolCallRecord;
}): string | undefined {
  const mutationKind = mapFileMutationKind(args.toolCallRecord.name);
  const filePath = extractMutationPath(args.toolCallRecord.args);

  if (!mutationKind || !filePath) {
    return undefined;
  }

  const mutationId = createFileMutationEvidenceId({
    adapterId: args.adapterId,
    sourceId: args.sourceId,
    nativeId: `${args.toolCallRecord.id}:${filePath}`
  });

  if (!args.fileMutationMap.has(mutationId)) {
	    args.fileMutationMap.set(mutationId, {
	      id: mutationId,
	      sessionId: args.sessionId,
	      adapterId: args.adapterId,
	      sourceId: args.sourceId,
	      nativeId: `${args.toolCallRecord.id}:${filePath}`,
	      kind: "file-mutation",
	      path: filePath,
	      mutationKind,
	      toolCallId: args.toolCallId,
      source: buildRawPointer(args.locator, `file:${args.toolCallRecord.id}:${filePath}`),
      confidence: CONFIRMED,
      diagnostics: []
    });
  }

  return mutationId;
}

function mapFileMutationKind(toolName: string): "created" | "updated" | "deleted" | null {
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

function extractMutationPath(args?: Record<string, unknown>): string | undefined {
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

function toRawArtifactRef(artifact: RawArtifactRef) {
  return {
    id: artifact.id,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    ...(artifact.path ? { path: artifact.path } : {}),
    ...(artifact.nativeRef ?? artifact.nativeId ? { nativeRef: artifact.nativeRef ?? artifact.nativeId } : {}),
    artifactKind: artifact.artifactKind ?? "unknown",
    ...(artifact.sizeBytes !== undefined
      ? { sizeBytes: artifact.sizeBytes }
      : artifact.byteLength !== undefined
        ? { sizeBytes: artifact.byteLength }
        : {}),
    ...(artifact.mtime ? { mtime: artifact.mtime } : {}),
    ...(artifact.inode !== undefined ? { inode: String(artifact.inode) } : {}),
    parseStrategy: artifact.parseStrategy ?? "unknown"
  };
}

function uniqueRawArtifactRefs<T extends { id: string }>(artifacts: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const artifact of artifacts) {
    if (seen.has(artifact.id)) {
      continue;
    }

    seen.add(artifact.id);
    deduped.push(artifact);
  }

  return deduped;
}
