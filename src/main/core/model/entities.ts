import type { AttentionReasonCode, RunAuditResult } from "../audit/types.js";
import type { Diagnostic, DiagnosticSeverity } from "../diagnostics/diagnostic.js";
import type { ParsedShellCommand } from "../shell/types.js";
import type { VerificationResult } from "../verification/types.js";
import type { HarnessCapabilities } from "./capabilities.js";
import type { Confidence, ConfidenceScore } from "./confidence.js";
import type {
  DiagnosticSourcePointer,
  EventOrderKey,
  FileMutationEvidenceId,
  HarnessId,
  NativeId,
  OutputArtifactId,
  OutputArtifactRef,
  ProjectId,
  RawArtifactRef,
  RawEventPointer,
  ShellCommandEvidenceId,
  SessionEventId,
  SessionId,
  SessionMessageId,
  SourceId,
  ToolCallId
} from "./identifiers.js";

export type EntityPrimitive = boolean | null | number | string;
export type EntityMetadata = Record<string, EntityPrimitive | EntityPrimitive[]>;

export type LifecycleStatus = "active" | "completed" | "cancelled" | "unknown";

export type SessionEventKind =
  | "message"
  | "tool-call"
  | "tool-result"
  | "shell-command"
  | "file-event"
  | "lifecycle"
  | "metadata"
  | "topic"
  | "raw-unknown";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type ToolCallNormalizedKind =
  | "read"
  | "search"
  | "write"
  | "replace"
  | "shell"
  | "topic"
  | "network"
  | "mcp"
  | "unknown";

export type ToolCallStatusNormalized = "pending" | "completed" | "failed" | "unknown";
export type ToolCallStatus = "started" | "succeeded" | "failed" | "cancelled" | "unknown";

export type CommandOutputSource = "stdout" | "stderr" | "combined" | "unknown";

export type OutputArtifactKind =
  | "sidecar"
  | "inline-large-output"
  | "raw-log"
  | "screenshot"
  | "unknown";

export type OutputArtifactContentKind =
  | "plain-text"
  | "json-output-wrapper"
  | "json"
  | "binary"
  | "unknown";

export type FileMutationKind = "created" | "updated" | "deleted" | "unknown";
export type AttentionReason = AttentionReasonCode;

export interface UsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
}

interface NormalizedEntityBase {
  id: string;
  entityType?:
    | "project"
    | "session"
    | "session-event"
    | "session-message"
    | "tool-call"
    | "shell-command-evidence"
    | "output-artifact"
    | "file-mutation";
  adapterId?: HarnessId;
  sourceId?: SourceId;
  metadata?: EntityMetadata;
  diagnostics?: Diagnostic[];
  diagnosticIds?: string[];
}

export interface ProjectHarnessRef {
  adapterId: HarnessId;
  sourceId: SourceId;
  nativeProjectId?: NativeId;
  nativeProjectPath?: string;
  projectRootPath?: string;
  projectRootConfidence: Confidence;
  rawArtifactRefs: RawArtifactRef[];
}

export interface Project extends NormalizedEntityBase {
  entityType?: "project";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  kind?: "project";
  displayName?: string;
  primaryRootPath?: string;
  rootConfidence?: Confidence;
  harnessRefs?: ProjectHarnessRef[];
  sessionIds?: SessionId[];
  latestActivityAt?: string;
  latestPrompt?: string;
  latestVerificationState?: "not-run" | "passed" | "failed" | "mixed" | "unknown";
  gitSnapshot?: unknown;
  githubSnapshot?: unknown;
  confidence?: ConfidenceScore;
  name?: string;
  nativeId?: NativeId;
  rootPath?: string;
}

export interface Session extends NormalizedEntityBase {
  entityType?: "session";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  kind?: "session";
  adapterId: HarnessId;
  sourceId: SourceId;
  nativeSessionId?: NativeId;
  nativeId?: NativeId;
  projectId?: ProjectId;
  title?: string;
  firstUserPrompt?: string;
  latestUserPrompt?: string;
  startedAt?: string;
  lastUpdatedAt?: string;
  durationMs?: number;
  lifecycleStatus?: LifecycleStatus;
  capabilities?: HarnessCapabilities;
  parseConfidence?: Confidence;
  attentionReasons?: AttentionReason[];
  messageIds?: SessionMessageId[];
  eventIds?: SessionEventId[];
  toolCallIds?: ToolCallId[];
  fileMutationIds?: FileMutationEvidenceId[];
  shellCommandIds?: ShellCommandEvidenceId[];
  outputArtifactIds?: OutputArtifactId[];
  usage?: UsageSummary;
  verification?: VerificationResult;
  runAudit?: RunAuditResult;
  parsedShellCommands?: ParsedShellCommand[];
  rawArtifactRefs?: RawArtifactRef[];
  confidence?: ConfidenceScore;
}

export interface SessionEvent extends NormalizedEntityBase {
  entityType?: "session-event";
  kind: SessionEventKind;
  sourceId: SourceId;
  adapterId: HarnessId;
  sessionId: SessionId;
  nativeId?: NativeId;
  timestamp?: string;
  orderKey?: EventOrderKey;
  actor?: "user" | "assistant" | "system" | "tool" | "harness" | "unknown";
  title?: string;
  text?: string;
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  summary?: string;
  severity?: DiagnosticSeverity;
  raw?: RawEventPointer;
  confidence?: ConfidenceScore;
}

export interface SessionMessage extends NormalizedEntityBase {
  entityType?: "session-message";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  kind?: "session-message";
  sourceId: SourceId;
  adapterId: HarnessId;
  sessionId: SessionId;
  nativeId?: NativeId;
  role: MessageRole;
  timestamp?: string;
  text?: string;
  modelName?: string;
  usage?: UsageSummary;
  toolCallIds?: ToolCallId[];
  eventIds?: SessionEventId[];
  source?: RawEventPointer;
  confidence: Confidence | ConfidenceScore;
}

export interface RawHarnessEvent<TPayload = unknown> {
  adapterId: HarnessId;
  sourceId: SourceId;
  nativeType?: string;
  nativeId?: NativeId;
  timestamp?: string;
  raw: TPayload;
  source: RawEventPointer;
  diagnostics: Diagnostic[];
}

export interface ToolCall extends NormalizedEntityBase {
  entityType?: "tool-call";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  kind?: "tool-call";
  sourceId: SourceId;
  adapterId: HarnessId;
  sessionId: SessionId;
  nativeToolCallId?: NativeId;
  nativeId?: NativeId;
  name?: string;
  normalizedKind?: ToolCallNormalizedKind;
  statusRaw?: string;
  statusNormalized?: ToolCallStatusNormalized;
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  status?: ToolCallStatus;
  startedAt?: string;
  endedAt?: string;
  argsPreview?: string;
  resultPreview?: string;
  outputArtifactIds?: OutputArtifactId[];
  fileMutationId?: FileMutationEvidenceId;
  shellCommandId?: ShellCommandEvidenceId;
  source?: RawEventPointer;
  confidence: Confidence | ConfidenceScore;
}

export interface ShellCommandEvidence extends NormalizedEntityBase {
  entityType?: "shell-command-evidence";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  kind?: "shell-command";
  sourceId: SourceId;
  adapterId: HarnessId;
  sessionId: SessionId;
  nativeId?: NativeId;
  toolCallId?: ToolCallId;
  command?: string;
  cwd?: string;
  outputInline?: string;
  outputArtifactIds?: OutputArtifactId[];
  rawStatus?: string;
  rawExitCode?: number;
  source?: RawEventPointer;
  confidence: Confidence | ConfidenceScore;
}

export interface OutputArtifact extends NormalizedEntityBase {
  entityType?: "output-artifact";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  nativeId?: NativeId;
  sourceId: SourceId;
  adapterId: HarnessId;
  sessionId?: SessionId;
  nativeRef?: NativeId;
  path?: string;
  uri?: string;
  kind?: OutputArtifactKind;
  contentKind?: OutputArtifactContentKind;
  mediaType?: string;
  byteLength?: number;
  sizeBytes?: number;
  mtime?: string;
  preview?: string;
  loaded?: boolean;
  source?: RawEventPointer;
  ref?: OutputArtifactRef;
  confidence?: ConfidenceScore;
  diagnosticIds?: string[];
}

export interface FileMutationEvidence extends NormalizedEntityBase {
  entityType?: "file-mutation";
  /** @deprecated Transitional Wave 2 type-only compatibility. */
  kind?: "file-mutation";
  sourceId: SourceId;
  adapterId: HarnessId;
  sessionId: SessionId;
  nativeId?: NativeId;
  path: string;
  mutationKind: FileMutationKind;
  toolCallId?: ToolCallId;
  source?: DiagnosticSourcePointer | RawEventPointer;
  confidence?: ConfidenceScore;
  diagnosticIds?: string[];
}

export interface NormalizedSessionGraph {
  adapterId: HarnessId;
  sourceId: SourceId;
  projects: Project[];
  sessions: Session[];
  events: SessionEvent[];
  messages: SessionMessage[];
  toolCalls: ToolCall[];
  shellCommands: ShellCommandEvidence[];
  outputArtifacts: OutputArtifact[];
  fileMutations: FileMutationEvidence[];
  diagnostics?: Diagnostic[];
}
