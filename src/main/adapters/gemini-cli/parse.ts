import path from "node:path";

import type { AdapterContext, RawArtifactRef } from "../../core/adapter-contract/types.js";
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
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedArtifactPaths: [artifact.path],
      allowedRootPaths: [artifact.path]
    });

  let artifactText: string;

  try {
    artifactText = await safeFilesystem.readTextFile(artifact.path);
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
      timestamp: logEntry.timestamp,
      payload: {
        kind: "logs-entry",
        entry: logEntry,
        origin: buildOrigin(artifact.nativeId, undefined, index)
      }
    };
  }
}

function* parseChatArtifact(
  artifact: RawArtifactRef,
  artifactText: string
): Iterable<GeminiRawEvent> {
  const lines = artifactText.split(/\r?\n/);
  let sessionIdFromHeader = deriveSessionIdFromChatPath(artifact.path);

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      yield buildParseDiagnosticEvent(
        artifact,
        "chat-json-line",
        `Gemini chat row ${lineNumber} failed JSON parsing: ${message}`,
        sessionIdFromHeader
      );
      continue;
    }

    const headerResult = sessionHeaderSchema.safeParse(parsed);

    if (headerResult.success) {
      sessionIdFromHeader = headerResult.data.sessionId;
      yield {
        id: `${artifact.id}:header:${lineNumber}`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "gemini.session-header",
        ...(headerResult.data.startTime ? { timestamp: headerResult.data.startTime } : {}),
        payload: {
          kind: "session-header",
          sessionId: headerResult.data.sessionId,
          header: headerResult.data,
          origin: buildOrigin(artifact.nativeId, lineNumber)
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
        id: `${artifact.id}:patch:${lineNumber}`,
        adapterId: artifact.adapterId,
        sourceId: artifact.sourceId,
        artifactId: artifact.id,
        kind: "gemini.metadata-patch",
        ...(timestamp ? { timestamp } : {}),
        payload: {
          kind: "metadata-patch",
          sessionId: sessionIdFromHeader ?? path.basename(artifact.path),
          patch: metadataPatchResult.data.$set,
          origin: buildOrigin(artifact.nativeId, lineNumber)
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
        `Gemini chat row ${lineNumber} failed validation: ${issues}`,
        sessionIdFromHeader
      );
      continue;
    }

    yield {
      id: `${artifact.id}:record:${lineNumber}`,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      artifactId: artifact.id,
      kind: "gemini.transcript-record",
      timestamp: transcriptResult.data.timestamp,
      payload: {
        kind: "transcript-record",
        sessionId: sessionIdFromHeader ?? path.basename(artifact.path),
        record: transcriptResult.data,
        origin: buildOrigin(artifact.nativeId, lineNumber)
      }
    };
  }
}

function* parseToolOutputArtifact(
  artifact: RawArtifactRef,
  artifactText: string
): Iterable<GeminiRawEvent> {
  const relativePath = artifact.nativeId;
  const sessionId = deriveSessionIdFromToolOutputPath(artifact.path);

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

  const { toolCallId, toolName } = deriveToolOutputIdentity(path.basename(artifact.path));

  yield {
    id: `${artifact.id}:tool-output`,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    artifactId: artifact.id,
    kind: "gemini.tool-output-sidecar",
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

function buildOrigin(
  artifactNativeId: string,
  lineNumber?: number,
  index?: number
): GeminiArtifactOrigin {
  return {
    artifactNativeId,
    ...(lineNumber ? { lineNumber } : {}),
    ...(index !== undefined ? { index } : {})
  };
}

function deriveSessionIdFromChatPath(artifactPath: string): string | undefined {
  const fileName = path.basename(artifactPath);
  const match = fileName.match(/session-[0-9T-]+-([0-9a-f-]+)\.jsonl$/u);
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
