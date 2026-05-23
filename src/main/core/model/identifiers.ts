import { createHash } from "node:crypto";

export type AdapterId = string;
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

export interface StableIdentityParts {
  adapterId: AdapterId;
  nativeId: string;
  sourceId?: SourceId;
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

export function createSourceId(adapterId: AdapterId, nativeId: string): SourceId {
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
