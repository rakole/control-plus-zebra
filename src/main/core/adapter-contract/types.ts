import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { CapabilityEnvelope, HarnessCapabilities } from "../model/capabilities.js";
import type { ConfidenceScore } from "../model/confidence.js";
import type { SafeFilesystem } from "../security/safe-filesystem.js";
import type {
  AdapterId,
  RawArtifactId,
  SessionId,
  SourceId
} from "../model/identifiers.js";
import type {
  FileMutationEvidence,
  OutputArtifact,
  Project,
  Session,
  SessionEvent,
  SessionMessage,
  ShellCommandEvidence,
  ToolCall
} from "../model/entities.js";

export type SupportedPlatform = "darwin" | "linux" | "win32";

export interface SourceRootHint {
  path: string;
  label: string;
  kind: "directory" | "file";
}

export interface SourceRootConfig {
  rootPath: string;
  displayName?: string;
  metadata?: Record<string, string>;
}

export interface SourceRootValidation {
  ok: boolean;
  normalizedPath?: string;
  diagnostics: Diagnostic[];
  capabilities?: HarnessCapabilities;
}

export interface AdapterContext {
  projectDir: string;
  platform: NodeJS.Platform;
  safeFilesystem?: SafeFilesystem;
}

export interface DiscoveredHarnessSource {
  id: SourceId;
  adapterId: AdapterId;
  nativeId: string;
  rootPath: string;
  displayName: string;
  confidence: ConfidenceScore;
  metadata?: Record<string, boolean | number | string>;
}

export interface RawArtifactRef {
  id: RawArtifactId;
  adapterId: AdapterId;
  sourceId: SourceId;
  nativeId: string;
  path: string;
  artifactType: string;
  mediaType?: string;
  byteLength?: number;
  inode?: number;
  mtimeMs?: number;
}

export interface RawHarnessEvent<TPayload = unknown> {
  id: string;
  adapterId: AdapterId;
  sourceId: SourceId;
  artifactId: RawArtifactId;
  kind: string;
  timestamp?: string;
  payload: TPayload;
}

export interface AdapterNormalizationInput<TRawEvent extends RawHarnessEvent = RawHarnessEvent> {
  source: DiscoveredHarnessSource;
  artifacts: RawArtifactRef[];
  rawEvents: TRawEvent[];
}

export interface LoadedOutputArtifact {
  artifact: OutputArtifact;
  text?: string;
  mediaType?: string;
}

export interface AdapterCapabilitySnapshots {
  adapter: CapabilityEnvelope;
  source: CapabilityEnvelope;
  sessions: Array<CapabilityEnvelope & { sessionId: SessionId }>;
}

export interface AdapterNormalizationResult {
  adapterId: AdapterId;
  sourceId: SourceId;
  capabilities: AdapterCapabilitySnapshots;
  projects: Project[];
  sessions: Session[];
  events: SessionEvent[];
  messages: SessionMessage[];
  toolCalls: ToolCall[];
  shellCommands: ShellCommandEvidence[];
  outputArtifacts: OutputArtifact[];
  fileMutations: FileMutationEvidence[];
  diagnostics: Diagnostic[];
}
