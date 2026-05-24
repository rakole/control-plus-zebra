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

export type AdapterCapabilities = HarnessCapabilities;
export type GroupedHarnessCapabilities = HarnessCapabilities;

export interface AdapterCapabilityEnvelope extends Omit<CapabilityEnvelope, "capabilities"> {
  capabilities: AdapterCapabilities;
}

export interface AdapterFilesystemStat {
  path: string;
  realPath?: string;
  kind: "directory" | "file";
  sizeBytes?: number;
  byteLength?: number;
  inode?: number | string;
  mtime?: string;
  mtimeMs?: number;
}

export type SafeReadFile = (
  targetPath: string,
  artifactId?: RawArtifactId
) => Promise<string>;

export type SafeStatFile = (targetPath: string) => Promise<AdapterFilesystemStat>;

export type SafeCreateReadStream = (
  targetPath: string,
  artifactId?: RawArtifactId
) => NodeJS.ReadableStream;

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
  capabilities?: AdapterCapabilities;
}

export interface AdapterContext {
  appVersion?: string;
  adapterRegistryVersion?: string;
  now?: string;
  allowedRoots?: string[];
  platform: NodeJS.Platform;
  logger?: {
    emit(diagnostic: Diagnostic): void;
  };
  readFile?: SafeReadFile;
  statFile?: SafeStatFile;
  createReadStream?: SafeCreateReadStream;
  projectDir?: string;
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
  path?: string | undefined;
  nativeRef?: string | undefined;
  artifactKind?:
    | "session-log"
    | "message-index"
    | "project-root-map"
    | "output-artifact"
    | "history"
    | "metadata"
    | "unknown"
    | undefined;
  sizeBytes?: number | undefined;
  mtime?: string | undefined;
  inode?: string | number | undefined;
  parseStrategy?: "stream-jsonl" | "json" | "text" | "adapter-native" | "unknown" | undefined;
  nativeId?: string | undefined;
  artifactType?: string | undefined;
  mediaType?: string | undefined;
  byteLength?: number | undefined;
  mtimeMs?: number | undefined;
}

export interface RawEventPointer {
  rawArtifactId?: RawArtifactId | undefined;
  artifactId?: RawArtifactId | undefined;
  artifactPath?: string | undefined;
  path?: string | undefined;
  nativeRef?: string | undefined;
  nativeId?: string | undefined;
  eventId?: string | undefined;
  lineNumber?: number | undefined;
  recordIndex?: number | undefined;
  pointer?: string | undefined;
}

export interface RawHarnessEvent<TPayload = unknown> {
  adapterId: AdapterId;
  sourceId: SourceId;
  id?: string;
  artifactId?: RawArtifactId;
  kind?: string;
  nativeType?: string;
  nativeId?: string;
  timestamp?: string;
  payload: TPayload;
  raw?: unknown;
  source?: RawEventPointer;
  diagnostics?: Diagnostic[];
}

export interface AdapterNormalizationInput<TRawEvent extends RawHarnessEvent = RawHarnessEvent> {
  source: DiscoveredHarnessSource;
  artifacts: RawArtifactRef[];
  rawEvents: TRawEvent[];
}

export interface OutputArtifactRef {
  id: string;
  adapterId: AdapterId;
  sourceId: SourceId;
  sessionId?: SessionId;
  nativeRef?: string;
  path?: string;
  mediaType?: string;
  kind?: string;
  contentKind?: string;
  nativeId?: string;
  artifactKind?: string;
}

export interface LoadedOutputArtifact {
  artifact: OutputArtifactRef;
  text?: string;
  mediaType?: string;
}

export interface AdapterCapabilitySnapshots {
  adapter: AdapterCapabilityEnvelope;
  source: AdapterCapabilityEnvelope;
  sessions: Array<AdapterCapabilityEnvelope & { sessionId: SessionId }>;
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
