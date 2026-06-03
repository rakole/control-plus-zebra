import { z } from "zod";

import type { HarnessCapabilities } from "../../core/model/capabilities.js";

const geminiCapabilityStateSchema = z.object({
  status: z.enum(["supported", "unsupported", "unknown"]),
  reason: z.string().optional(),
  details: z.string().optional()
});

export const geminiHarnessCapabilitiesSchema = z.object({
  sessionDiscovery: geminiCapabilityStateSchema,
  liveSessionObservation: geminiCapabilityStateSchema,
  eventStreaming: geminiCapabilityStateSchema,
  messageCapture: geminiCapabilityStateSchema,
  toolCallCapture: geminiCapabilityStateSchema,
  shellCommandCapture: geminiCapabilityStateSchema,
  outputArtifactCapture: geminiCapabilityStateSchema,
  fileMutationCapture: geminiCapabilityStateSchema,
  sourceValidation: geminiCapabilityStateSchema,
  watchPlans: geminiCapabilityStateSchema,
  gitContextCapture: geminiCapabilityStateSchema,
  githubContextCapture: geminiCapabilityStateSchema,
  verificationSignals: geminiCapabilityStateSchema
});

const parseDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  nativeId: z.string().optional(),
  sessionId: z.string().optional()
});

const artifactOriginSchema = z.object({
  artifactNativeId: z.string(),
  lineNumber: z.number().int().positive().optional(),
  index: z.number().int().nonnegative().optional()
});

const contentPartSchema = z.object({
  text: z.string().optional()
});

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  result: z.array(z.unknown()).optional(),
  status: z.string().optional(),
  timestamp: z.string().optional(),
  resultDisplay: z.unknown().optional(),
  description: z.string().optional(),
  displayName: z.string().optional(),
  renderOutputAsMarkdown: z.boolean().optional()
});

export const sessionHeaderSchema = z.object({
  sessionId: z.string(),
  projectHash: z.string().optional(),
  startTime: z.string().optional(),
  lastUpdated: z.string().optional(),
  kind: z.string().optional()
});

export const metadataPatchSchema = z.object({
  $set: z.record(z.string(), z.unknown())
});

export const transcriptRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  content: z.union([z.string(), z.array(contentPartSchema)]).optional(),
  thoughts: z.array(z.record(z.string(), z.unknown())).optional(),
  tokens: z
    .object({
      input: z.number().int().nonnegative().optional(),
      output: z.number().int().nonnegative().optional(),
      cached: z.number().int().nonnegative().optional(),
      thoughts: z.number().int().nonnegative().optional(),
      tool: z.number().int().nonnegative().optional(),
      total: z.number().int().nonnegative().optional()
    })
    .optional(),
  model: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional()
});

export const logsEntrySchema = z.object({
  sessionId: z.string(),
  messageId: z.number().int().nonnegative(),
  type: z.string(),
  message: z.string(),
  timestamp: z.string()
});

export const projectRootPayloadSchema = z.object({
  repoRootPath: z.string(),
  origin: artifactOriginSchema
});

export const toolOutputSidecarPayloadSchema = z.object({
  sessionId: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  relativePath: z.string(),
  format: z.enum(["json", "text", "unknown"]),
  textPreview: z.string().optional(),
  exitCode: z.number().int().optional(),
  mediaType: z.string().optional(),
  origin: artifactOriginSchema
});

export type GeminiHarnessCapabilities = HarnessCapabilities;
export type GeminiParseDiagnostic = z.infer<typeof parseDiagnosticSchema>;
export type GeminiToolCallRecord = z.infer<typeof toolCallSchema>;
export type GeminiSessionHeader = z.infer<typeof sessionHeaderSchema>;
export type GeminiTranscriptRecord = z.infer<typeof transcriptRecordSchema>;
export type GeminiLogsEntry = z.infer<typeof logsEntrySchema>;
export type GeminiMetadataPatch = z.infer<typeof metadataPatchSchema>["$set"];
export type GeminiArtifactOrigin = z.infer<typeof artifactOriginSchema>;
export type GeminiProjectRootPayload = z.infer<typeof projectRootPayloadSchema>;
export type GeminiToolOutputSidecarPayload = z.infer<typeof toolOutputSidecarPayloadSchema>;

export interface GeminiSessionHeaderPayload {
  kind: "session-header";
  sessionId: string;
  header: GeminiSessionHeader;
  origin: GeminiArtifactOrigin;
}

export interface GeminiMetadataPatchPayload {
  kind: "metadata-patch";
  sessionId: string;
  patch: GeminiMetadataPatch;
  origin: GeminiArtifactOrigin;
}

export interface GeminiTranscriptPayload {
  kind: "transcript-record";
  sessionId: string;
  record: GeminiTranscriptRecord;
  origin: GeminiArtifactOrigin;
}

export interface GeminiLogsEntryPayload {
  kind: "logs-entry";
  entry: GeminiLogsEntry;
  origin: GeminiArtifactOrigin;
}

export interface GeminiProjectRootEventPayload {
  kind: "project-root";
  repoRootPath: string;
  origin: GeminiArtifactOrigin;
}

export interface GeminiToolOutputSidecarEventPayload {
  kind: "tool-output-sidecar";
  sessionId: string;
  toolCallId?: string;
  toolName?: string;
  relativePath: string;
  format: "json" | "text" | "unknown";
  textPreview?: string;
  exitCode?: number;
  mediaType?: string;
  origin: GeminiArtifactOrigin;
}

export interface GeminiParseDiagnosticPayload {
  kind: "parse-diagnostic";
  diagnostic: GeminiParseDiagnostic;
}

export type GeminiParsedPayload =
  | GeminiSessionHeaderPayload
  | GeminiMetadataPatchPayload
  | GeminiTranscriptPayload
  | GeminiLogsEntryPayload
  | GeminiProjectRootEventPayload
  | GeminiToolOutputSidecarEventPayload
  | GeminiParseDiagnosticPayload;

export function extractGeminiContentText(
  content: GeminiTranscriptRecord["content"]
): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!content || content.length === 0) {
    return undefined;
  }

  const joined = content
    .map((part) => part.text?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n");

  return joined.length > 0 ? joined : undefined;
}
