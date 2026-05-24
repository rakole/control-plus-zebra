import { createHash } from "node:crypto";

export type HarnessId = string;
export type AdapterId = HarnessId;
export type SourceId = string;
export type ProjectId = string;
export type SessionId = string;
export type SessionEventId = string;
export type SessionMessageId = string;
export type ToolCallId = string;
export type ShellCommandEvidenceId = string;
export type OutputArtifactId = string;
export type FileMutationEvidenceId = string;
export type DiagnosticId = string;
export type RawArtifactId = string;
export type NativeId = string;
export type EventOrderKey = string;

export type StableEntityKind =
  | "source"
  | "project"
  | "session"
  | "session-event"
  | "session-message"
  | "tool-call"
  | "shell-command"
  | "output-artifact"
  | "file-mutation"
  | "diagnostic"
  | "raw-artifact";

export type RawArtifactKind =
  | "session-log"
  | "message-index"
  | "project-root-map"
  | "output-artifact"
  | "history"
  | "metadata"
  | "unknown";

export type RawArtifactParseStrategy =
  | "stream-jsonl"
  | "json"
  | "text"
  | "adapter-native"
  | "unknown";

export interface StableIdentityParts {
  adapterId: HarnessId;
  nativeId: NativeId;
  sourceId?: SourceId;
}

export interface RawArtifactRef {
  id: RawArtifactId;
  adapterId: HarnessId;
  sourceId: SourceId;
  path?: string | undefined;
  nativeRef?: NativeId | undefined;
  artifactKind: RawArtifactKind;
  sizeBytes?: number | undefined;
  mtime?: string | undefined;
  inode?: string | undefined;
  parseStrategy?: RawArtifactParseStrategy | undefined;
}

export interface OutputArtifactRef {
  adapterId: HarnessId;
  sourceId: SourceId;
  id?: OutputArtifactId;
  sessionId?: SessionId;
  nativeRef?: NativeId;
  path?: string;
}

export interface RawEventPointer {
  adapterId?: HarnessId | undefined;
  sourceId?: SourceId | undefined;
  artifactId?: RawArtifactId | undefined;
  rawArtifactId?: RawArtifactId | undefined;
  eventId?: string | undefined;
  nativeId?: NativeId | undefined;
  nativeRef?: NativeId | undefined;
  path?: string | undefined;
  artifactPath?: string | undefined;
  line?: number | undefined;
  lineNumber?: number | undefined;
  recordIndex?: number | undefined;
  column?: number | undefined;
  byteOffset?: number | undefined;
  jsonPointer?: string | undefined;
  pointer?: string | undefined;
}

export interface SourcePointer {
  adapterId: HarnessId;
  sourceId: SourceId;
  artifactId?: RawArtifactId;
  nativeRef?: NativeId;
  path?: string;
  rawEvent?: RawEventPointer;
}

export interface DiagnosticSourcePointer {
  adapterId: HarnessId;
  entityId?: string;
  entityKind?: StableEntityKind;
  sourceId?: SourceId;
  artifactId?: RawArtifactId;
  nativeRef?: NativeId;
  path?: string;
  rawEvent?: RawEventPointer;
}

function hashStableParts(parts: ReadonlyArray<string>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function buildStableId(kind: StableEntityKind, parts: StableIdentityParts): string {
  const tokens = [kind, parts.adapterId];

  if (parts.sourceId) {
    tokens.push(parts.sourceId);
  }

  tokens.push(parts.nativeId);

  return `${kind}_${hashStableParts(tokens)}`;
}

export function createSourceId(adapterId: HarnessId, nativeId: NativeId): SourceId {
  return buildStableId("source", { adapterId, nativeId });
}

export function createProjectId(parts: StableIdentityParts): ProjectId {
  return buildStableId("project", parts);
}

export function createSessionId(parts: StableIdentityParts): SessionId {
  return buildStableId("session", parts);
}

export function createSessionEventId(parts: StableIdentityParts): SessionEventId {
  return buildStableId("session-event", parts);
}

export function createSessionMessageId(parts: StableIdentityParts): SessionMessageId {
  return buildStableId("session-message", parts);
}

export function createToolCallId(parts: StableIdentityParts): ToolCallId {
  return buildStableId("tool-call", parts);
}

export function createShellCommandEvidenceId(parts: StableIdentityParts): ShellCommandEvidenceId {
  return buildStableId("shell-command", parts);
}

export function createOutputArtifactId(parts: StableIdentityParts): OutputArtifactId {
  return buildStableId("output-artifact", parts);
}

export function createFileMutationEvidenceId(parts: StableIdentityParts): FileMutationEvidenceId {
  return buildStableId("file-mutation", parts);
}

export function createDiagnosticId(parts: StableIdentityParts): DiagnosticId {
  return buildStableId("diagnostic", parts);
}

export function createRawArtifactId(parts: StableIdentityParts): RawArtifactId {
  return buildStableId("raw-artifact", parts);
}
