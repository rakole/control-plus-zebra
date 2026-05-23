import type { ConfidenceScore } from "./confidence.js";
import type {
  AdapterId,
  FileMutationEvidenceId,
  OutputArtifactId,
  ProjectId,
  SessionEventId,
  SessionId,
  SessionMessageId,
  SourceId,
  ToolCallId
} from "./identifiers.js";

export type EntityPrimitive = boolean | null | number | string;
export type EntityMetadata = Record<string, EntityPrimitive | EntityPrimitive[]>;

interface NormalizedEntityBase {
  id: string;
  adapterId: AdapterId;
  confidence: ConfidenceScore;
  diagnosticIds?: string[];
  metadata?: EntityMetadata;
}

interface SourceBoundEntityBase extends NormalizedEntityBase {
  sourceId: SourceId;
}

export interface Project extends SourceBoundEntityBase {
  kind: "project";
  nativeId: string;
  name: string;
  rootPath?: string;
}

export type SessionLifecycleState = "active" | "completed" | "cancelled" | "unknown";

export interface Session extends SourceBoundEntityBase {
  kind: "session";
  nativeId: string;
  projectId?: ProjectId;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  lifecycleState: SessionLifecycleState;
}

export type SessionEventKind =
  | "lifecycle"
  | "message"
  | "tool-call"
  | "shell-command"
  | "output-artifact"
  | "file-mutation"
  | "metadata";

export interface SessionEvent extends SourceBoundEntityBase {
  kind: "session-event";
  sessionId: SessionId;
  nativeId: string;
  eventKind: SessionEventKind;
  timestamp?: string;
  ordinal: number;
  summary?: string;
  messageId?: SessionMessageId;
  toolCallId?: ToolCallId;
  shellCommandId?: string;
  outputArtifactId?: OutputArtifactId;
  fileMutationId?: FileMutationEvidenceId;
}

export type MessageRole = "assistant" | "system" | "tool" | "user";

export interface SessionMessage extends SourceBoundEntityBase {
  kind: "session-message";
  sessionId: SessionId;
  nativeId: string;
  role: MessageRole;
  content: string;
  ordinal: number;
  timestamp?: string;
  eventId?: SessionEventId;
}

export type ToolCallStatus = "started" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface ToolCall extends SourceBoundEntityBase {
  kind: "tool-call";
  sessionId: SessionId;
  nativeId: string;
  toolName: string;
  status: ToolCallStatus;
  startedAt?: string;
  endedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  eventId?: SessionEventId;
  artifactIds?: OutputArtifactId[];
  fileMutationIds?: FileMutationEvidenceId[];
}

export type CommandOutputSource = "stdout" | "stderr" | "combined" | "unknown";

export interface ShellCommandEvidence extends SourceBoundEntityBase {
  kind: "shell-command";
  sessionId: SessionId;
  nativeId: string;
  command: string;
  outputSource: CommandOutputSource;
  cwd?: string;
  exitCode?: number;
  startedAt?: string;
  endedAt?: string;
  outputSummary?: string;
  eventId?: SessionEventId;
}

export type OutputArtifactKind = "image" | "json" | "text" | "trace" | "unknown";

export interface OutputArtifact extends SourceBoundEntityBase {
  kind: "output-artifact";
  sessionId: SessionId;
  nativeId: string;
  artifactKind: OutputArtifactKind;
  path?: string;
  uri?: string;
  mediaType?: string;
  byteLength?: number;
  eventId?: SessionEventId;
}

export type FileMutationKind = "created" | "updated" | "deleted" | "unknown";

export interface FileMutationEvidence extends SourceBoundEntityBase {
  kind: "file-mutation";
  sessionId: SessionId;
  nativeId: string;
  path: string;
  mutationKind: FileMutationKind;
  eventId?: SessionEventId;
  toolCallId?: ToolCallId;
}

export interface NormalizedSessionGraph {
  adapterId: AdapterId;
  sourceId: SourceId;
  projects: Project[];
  sessions: Session[];
  events: SessionEvent[];
  messages: SessionMessage[];
  toolCalls: ToolCall[];
  shellCommands: ShellCommandEvidence[];
  outputArtifacts: OutputArtifact[];
  fileMutations: FileMutationEvidence[];
}
