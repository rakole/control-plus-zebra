import path from "node:path";

import type { AdapterContext, RawArtifactRef } from "../../core/adapter-contract/types.js";
import {
  adapterReadTextFile,
  adapterReadTextLines
} from "../../core/adapter-contract/context-helpers.js";
import { DEFAULT_BOUNDED_INGESTION_LIMITS } from "../../core/ingestion/bounded-ingestion.js";
import type { RawHarnessEvent } from "../../core/adapter-contract/index.js";
import { createSafeFilesystem } from "../../core/security/safe-filesystem.js";
import {
  GEMINI_CHAT_ARTIFACT_TYPE,
  GEMINI_LOGS_ARTIFACT_TYPE,
  GEMINI_PROJECT_ROOT_ARTIFACT_TYPE,
  GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE
} from "./discovery.js";
import {
  extractGeminiContentText,
  logsEntrySchema,
  metadataPatchSchema,
  sessionHeaderSchema,
  transcriptRecordSchema,
  type GeminiArtifactOrigin,
  type GeminiParsedPayload
} from "./types.js";

export type GeminiRawEvent = RawHarnessEvent<GeminiParsedPayload>;

export async function* parseGeminiCliArtifact(
  artifact: RawArtifactRef,
  context: AdapterContext
): AsyncIterable<GeminiRawEvent> {
  let artifactText: string;

  if (artifact.artifactType === GEMINI_CHAT_ARTIFACT_TYPE && !isJsonChatArtifact(artifact)) {
    yield* parseJsonlChatArtifactStream(artifact, context);
    return;
  }

  if (
    artifact.artifactType === GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE &&
    (artifact.byteLength ?? artifact.sizeBytes ?? 0) >
      DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes
  ) {
    yield buildToolOutputPreviewEvent(artifact);
    return;
  }

  try {
    if (!artifact.path) {
      throw new Error("Gemini artifact is missing a readable path.");
    }

    artifactText = await adapterReadTextFile(
      {
        ...context,
        allowedRoots: context.allowedRoots ?? [artifact.path],
        safeFilesystem:
          context.safeFilesystem ??
          createSafeFilesystem({
            allowedArtifactPaths: [artifact.path],
            allowedRootPaths: [artifact.path]
          })
      },
      artifact.path,
      artifact.id
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown read error";
    yield buildParseDiagnosticEvent(
      artifact,
      "read",
      `Unable to read Gemini artifact: ${message}`,
      undefined
    );
    return;
  }

  switch (artifact.artifactType) {
    case GEMINI_PROJECT_ROOT_ARTIFACT_TYPE: {
      const repoRootPath = artifactText.trim();

      if (repoRootPath.length === 0) {
        yield buildParseDiagnosticEvent(
          artifact,
          "project-root-empty",
          "Gemini .project_root file was empty."
        );
        return;
      }

      yield {
        id: `${artifact.id}:project-root`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "gemini.project-root",
        nativeType: "project-root",
        raw: repoRootPath,
        source: buildPointer(artifact),
        diagnostics: [],
        payload: {
          kind: "project-root",
          repoRootPath,
          origin: buildOrigin(artifact.nativeId)
        }
      };
      return;
    }
    case GEMINI_LOGS_ARTIFACT_TYPE: {
      yield* parseLogsArtifact(artifact, artifactText);
      return;
    }
    case GEMINI_CHAT_ARTIFACT_TYPE: {
      yield* parseChatArtifact(artifact, artifactText);
      return;
    }
    case GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE: {
      yield* parseToolOutputArtifact(artifact, artifactText);
      return;
    }
    default: {
      yield buildParseDiagnosticEvent(
        artifact,
        "artifact-unsupported",
        `Unsupported Gemini artifact type '${artifact.artifactType}'.`
      );
    }
  }
}

function* parseLogsArtifact(
  artifact: RawArtifactRef,
  artifactText: string
): Iterable<GeminiRawEvent> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(artifactText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    yield buildParseDiagnosticEvent(
      artifact,
      "logs-json",
      `Gemini logs.json parsing failed: ${message}`
    );
    return;
  }

  if (!Array.isArray(parsed)) {
    yield buildParseDiagnosticEvent(
      artifact,
      "logs-shape",
      "Gemini logs.json must contain an array of log entries."
    );
    return;
  }

  for (const [index, entry] of parsed.entries()) {
    const result = logsEntrySchema.safeParse(entry);

    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");

      yield buildParseDiagnosticEvent(
        artifact,
        "logs-entry",
        `Gemini logs.json entry ${index} failed validation: ${issues}`
      );
      continue;
    }

    const logEntry = result.data;
    yield {
      id: `${artifact.id}:logs:${index}`,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      artifactId: artifact.id,
      kind: "gemini.logs-entry",
      nativeType: "logs-entry",
      nativeId: `${artifact.nativeId ?? artifact.nativeRef ?? artifact.id}:${index}`,
      timestamp: logEntry.timestamp,
      raw: entry,
      source: buildPointer(artifact, undefined, index),
      diagnostics: [],
      payload: {
        kind: "logs-entry",
        entry: logEntry,
        origin: buildOrigin(artifact.nativeId, undefined, index)
      }
    };
  }
}

async function* parseChatArtifact(
  artifact: RawArtifactRef,
  artifactText: string
): AsyncIterable<GeminiRawEvent> {
  yield* parseChatRowsAsEvents(artifact, parseChatRows(artifact, artifactText));
}

async function* parseJsonlChatArtifactStream(
  artifact: RawArtifactRef,
  context: AdapterContext
): AsyncIterable<GeminiRawEvent> {
  try {
    yield* parseChatRowsAsEvents(
      artifact,
      parseJsonlChatRowsStream(
        adapterReadTextLines(context, artifact.path ?? artifact.id, {
          maxLineBytes: DEFAULT_BOUNDED_INGESTION_LIMITS.maxTextLineBytes
        })
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown read error";

    yield buildParseDiagnosticEvent(
      artifact,
      "read",
      `Unable to stream Gemini chat artifact: ${message}`,
      deriveSessionIdFromChatPath(artifact.path ?? artifact.nativeId ?? "")
    );
  }
}

async function* parseChatRowsAsEvents(
  artifact: RawArtifactRef,
  rows: AsyncIterable<ParsedChatRow> | Iterable<ParsedChatRow>
): AsyncIterable<GeminiRawEvent> {
  let sessionIdFromHeader = deriveSessionIdFromChatPath(artifact.path ?? artifact.nativeId ?? "");

  for await (const row of rows) {
    if (!row.ok) {
      yield buildParseDiagnosticEvent(
        artifact,
        row.diagnosticSuffix,
        row.message,
        sessionIdFromHeader
      );
      continue;
    }

    const parsed = row.parsed;
    const headerResult = sessionHeaderSchema.safeParse(parsed);

    if (headerResult.success) {
      sessionIdFromHeader = headerResult.data.sessionId;
      yield {
        id: `${artifact.id}:header:${row.eventKey}`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "gemini.session-header",
        nativeType: "session-header",
        nativeId: headerResult.data.sessionId,
        ...(headerResult.data.startTime ? { timestamp: headerResult.data.startTime } : {}),
        raw: parsed,
        source: buildPointer(artifact, row.lineNumber, row.index),
        diagnostics: [],
        payload: {
          kind: "session-header",
          sessionId: headerResult.data.sessionId,
          header: headerResult.data,
          origin: buildOrigin(artifact.nativeId, row.lineNumber, row.index)
        }
      };
      continue;
    }

    const metadataPatchResult = metadataPatchSchema.safeParse(parsed);

    if (metadataPatchResult.success) {
      const timestamp =
        typeof metadataPatchResult.data.$set.lastUpdated === "string"
          ? metadataPatchResult.data.$set.lastUpdated
          : undefined;
      yield {
        id: `${artifact.id}:patch:${row.eventKey}`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "gemini.metadata-patch",
        nativeType: "metadata-patch",
        nativeId: sessionIdFromHeader ?? path.basename(artifact.path ?? artifact.id),
        ...(timestamp ? { timestamp } : {}),
        raw: parsed,
        source: buildPointer(artifact, row.lineNumber, row.index),
        diagnostics: [],
        payload: {
          kind: "metadata-patch",
          sessionId: sessionIdFromHeader ?? path.basename(artifact.path ?? artifact.id),
          patch: metadataPatchResult.data.$set,
          origin: buildOrigin(artifact.nativeId, row.lineNumber, row.index)
        }
      };
      continue;
    }

    const transcriptResult = transcriptRecordSchema.safeParse(parsed);

    if (!transcriptResult.success) {
      const issues = transcriptResult.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      yield buildParseDiagnosticEvent(
        artifact,
        "chat-shape",
        `Gemini chat row ${row.label} failed validation: ${issues}`,
        sessionIdFromHeader
      );
      continue;
    }

    yield {
      id: `${artifact.id}:record:${row.eventKey}`,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      artifactId: artifact.id,
      kind: "gemini.transcript-record",
      nativeType: "transcript-record",
      nativeId: transcriptResult.data.id,
      timestamp: transcriptResult.data.timestamp,
      raw: parsed,
      source: buildPointer(artifact, row.lineNumber, row.index),
      diagnostics: [],
      payload: {
        kind: "transcript-record",
        sessionId: sessionIdFromHeader ?? path.basename(artifact.path ?? artifact.id),
        record: transcriptResult.data,
        origin: buildOrigin(artifact.nativeId, row.lineNumber, row.index)
      }
    };
  }
}

type ParsedChatRow =
  | {
      ok: true;
      eventKey: string;
      index?: number;
      label: string;
      lineNumber?: number;
      parsed: unknown;
    }
  | {
      ok: false;
      diagnosticSuffix: string;
      message: string;
    };

function parseChatRows(
  artifact: RawArtifactRef,
  artifactText: string
): ParsedChatRow[] {
  if (isJsonChatArtifact(artifact)) {
    return parseJsonChatRows(artifactText);
  }

  return parseJsonlChatRows(artifactText);
}

function isJsonChatArtifact(artifact: RawArtifactRef): boolean {
  return (
    artifact.mediaType === "application/json" ||
    path.extname(artifact.path ?? artifact.nativeId ?? "").toLowerCase() === ".json"
  );
}

function parseJsonlChatRows(artifactText: string): ParsedChatRow[] {
  const rows: ParsedChatRow[] = [];

  for (const [index, line] of artifactText.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    try {
      rows.push({
        ok: true,
        eventKey: String(lineNumber),
        label: String(lineNumber),
        lineNumber,
        parsed: JSON.parse(trimmed)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      rows.push({
        ok: false,
        diagnosticSuffix: "chat-json-line",
        message: `Gemini chat row ${lineNumber} failed JSON parsing: ${message}`
      });
    }
  }

  return rows;
}

async function* parseJsonlChatRowsStream(
  lines: AsyncIterable<string>
): AsyncIterable<ParsedChatRow> {
  let index = 0;

  for await (const line of lines) {
    index += 1;
    const lineNumber = index;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    try {
      yield {
        ok: true,
        eventKey: String(lineNumber),
        label: String(lineNumber),
        lineNumber,
        parsed: JSON.parse(trimmed)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      yield {
        ok: false,
        diagnosticSuffix: "chat-json-line",
        message: `Gemini chat row ${lineNumber} failed JSON parsing: ${message}`
      };
    }
  }
}

function parseJsonChatRows(artifactText: string): ParsedChatRow[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(artifactText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return [
      {
        ok: false,
        diagnosticSuffix: "chat-json",
        message: `Gemini chat JSON parsing failed: ${message}`
      }
    ];
  }

  const records = extractJsonChatRecords(parsed);

  if (!records) {
    return [
      {
        ok: false,
        diagnosticSuffix: "chat-json-shape",
        message:
          "Gemini chat JSON must contain a transcript record object or an array of transcript records."
      }
    ];
  }

  return records.map((record, index) => ({
    ok: true,
    eventKey: `index-${index}`,
    index,
    label: `index ${index}`,
    parsed: record
  }));
}

function extractJsonChatRecords(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  for (const property of ["records", "events", "messages", "transcript", "entries"]) {
    const value = parsed[property];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [parsed];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function* parseToolOutputArtifact(
  artifact: RawArtifactRef,
  artifactText: string
): Iterable<GeminiRawEvent> {
  const relativePath = artifact.nativeId ?? artifact.nativeRef ?? artifact.id;
  const sessionId = deriveSessionIdFromToolOutputPath(artifact.path ?? artifact.id);

  if (!sessionId) {
    yield buildParseDiagnosticEvent(
      artifact,
      "tool-output-session",
      "Gemini tool-output path did not encode a session UUID."
    );
    return;
  }

  let format: "json" | "text" | "unknown" = "text";
  let mediaType = artifact.mediaType ?? "text/plain";
  let textPreview = artifactText.slice(0, 240);

  const trimmed = artifactText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(artifactText) as Record<string, unknown>;
      format = "json";
      mediaType = "application/json";

      const extractedText = extractJsonWrappedOutputText(parsed);
      if (extractedText) {
        textPreview = extractedText.slice(0, 240);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      format = "unknown";
      yield buildParseDiagnosticEvent(
        artifact,
        "tool-output-json",
        `Gemini tool-output JSON parsing failed: ${message}`,
        sessionId
      );
    }
  }

  const { toolCallId, toolName } = deriveToolOutputIdentity(
    path.basename(artifact.path ?? artifact.id)
  );

  yield {
    id: `${artifact.id}:tool-output`,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactId: artifact.id,
    kind: "gemini.tool-output-sidecar",
    nativeType: "tool-output-sidecar",
    nativeId: relativePath,
    raw: artifactText,
    source: buildPointer(artifact),
    diagnostics: [],
    payload: {
      kind: "tool-output-sidecar",
      sessionId,
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolName ? { toolName } : {}),
      relativePath,
      format,
      textPreview,
      mediaType,
      origin: buildOrigin(artifact.nativeId)
    }
  };
}

function buildToolOutputPreviewEvent(artifact: RawArtifactRef): GeminiRawEvent {
  const relativePath = artifact.nativeId ?? artifact.nativeRef ?? artifact.id;
  const sessionId =
    deriveSessionIdFromToolOutputPath(artifact.path ?? artifact.id) ?? "unknown-session";
  const { toolCallId, toolName } = deriveToolOutputIdentity(
    path.basename(artifact.path ?? artifact.id)
  );

  return {
    id: `${artifact.id}:tool-output`,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactId: artifact.id,
    kind: "gemini.tool-output-sidecar",
    nativeType: "tool-output-sidecar",
    nativeId: relativePath,
    raw: {
      byteLength: artifact.byteLength ?? artifact.sizeBytes,
      previewOnly: true
    },
    source: buildPointer(artifact),
    diagnostics: [],
    payload: {
      kind: "tool-output-sidecar",
      sessionId,
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolName ? { toolName } : {}),
      relativePath,
      format: "text",
      textPreview: "Large tool-output artifact is available through bounded lazy loading.",
      mediaType: artifact.mediaType ?? "text/plain",
      origin: buildOrigin(artifact.nativeId)
    }
  };
}

function buildParseDiagnosticEvent(
  artifact: RawArtifactRef,
  suffix: string,
  message: string,
  sessionId?: string
): GeminiRawEvent {
  return {
    id: `${artifact.id}:parse-diagnostic:${suffix}:${sessionId ?? "global"}`,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactId: artifact.id,
    kind: "gemini.parse-diagnostic",
    nativeType: "parse-diagnostic",
    raw: {
      code: `gemini-cli.parse.${suffix}`,
      message,
      sessionId
    },
    source: buildPointer(artifact),
    diagnostics: [],
    payload: {
      kind: "parse-diagnostic",
      diagnostic: {
        code: `gemini-cli.parse.${suffix}`,
        severity: "error",
        message,
        nativeId: artifact.nativeId,
        ...(sessionId ? { sessionId } : {})
      }
    }
  };
}

function buildPointer(
  artifact: RawArtifactRef,
  lineNumber?: number,
  index?: number
) {
  return {
    rawArtifactId: artifact.id,
    artifactPath: artifact.path,
    nativeRef: artifact.nativeRef ?? artifact.nativeId,
    ...(lineNumber ? { lineNumber } : {}),
    ...(index !== undefined ? { recordIndex: index } : {})
  };
}

function buildOrigin(
  artifactNativeId: string | undefined,
  lineNumber?: number,
  index?: number
): GeminiArtifactOrigin {
  return {
    artifactNativeId: artifactNativeId ?? "unknown-artifact",
    ...(lineNumber ? { lineNumber } : {}),
    ...(index !== undefined ? { index } : {})
  };
}

function deriveSessionIdFromChatPath(artifactPath: string): string | undefined {
  const fileName = path.basename(artifactPath);
  const match = fileName.match(/session-[0-9T-]+-([0-9a-f-]+)\.(?:json|jsonl)$/u);
  return match?.[1];
}

function deriveSessionIdFromToolOutputPath(artifactPath: string): string | undefined {
  const match = artifactPath.match(/tool-outputs[\\/]+session-([0-9a-f-]+)[\\/]/u);
  return match?.[1];
}

function deriveToolOutputIdentity(fileName: string): {
  toolCallId?: string;
  toolName?: string;
} {
  const stem = fileName.replace(/\.[^.]+$/u, "");
  const withoutSuffix = stem.replace(/_[A-Za-z0-9]{4,}$/u, "");
  const repeatCandidate = deriveRepeatedPrefixToolCallId(withoutSuffix);
  const toolCallId =
    repeatCandidate ?? (/.+_\d+_\d+$/u.test(withoutSuffix) ? withoutSuffix : undefined);

  if (!toolCallId) {
    return {};
  }

  const toolNameMatch = toolCallId.match(/^(.*)_\d+_\d+$/u);
  return {
    toolCallId,
    ...(toolNameMatch?.[1] ? { toolName: toolNameMatch[1] } : {})
  };
}

function deriveRepeatedPrefixToolCallId(candidate: string): string | undefined {
  const tokens = candidate.split("_");

  for (let index = 1; index < tokens.length - 1; index += 1) {
    const prefix = tokens.slice(0, index).join("_");
    const rest = tokens.slice(index).join("_");

    if (rest.startsWith(`${prefix}_`) && /.+_\d+_\d+$/u.test(rest)) {
      return rest;
    }
  }

  return undefined;
}

function extractJsonWrappedOutputText(candidate: Record<string, unknown>): string | undefined {
  const directTextKeys = ["content", "output", "text", "result"] as const;

  for (const key of directTextKeys) {
    const value = candidate[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

export function extractTranscriptText(record: { content?: unknown }): string | undefined {
  return extractGeminiContentText(record.content as Parameters<typeof extractGeminiContentText>[0]);
}
