import type { Diagnostic } from "../diagnostics/diagnostic.js";
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
import type { AdapterId, RawArtifactId, SessionId, SourceId } from "../model/identifiers.js";
import type {
  IngestRunId,
  StoredProjectGitHubSnapshot,
  StoredProjectGitSnapshot,
  StoredSessionRunAuditSnapshot,
  StoredSessionVerificationSnapshot,
  WorkbenchOverviewRollup,
  WorkbenchProjectRollup,
  WorkbenchRawArtifactMetadataRecord,
  WorkbenchSessionRollup
} from "./workbench-entity-store.js";

export interface EntityWriteBatch {
  ingestRunId: IngestRunId;
  adapterId: AdapterId;
  sourceId: SourceId;
  diagnostics?: Diagnostic[];
  events?: SessionEvent[];
  fileMutations?: FileMutationEvidence[];
  githubSnapshots?: StoredProjectGitHubSnapshot[];
  gitSnapshots?: StoredProjectGitSnapshot[];
  messages?: SessionMessage[];
  outputArtifacts?: OutputArtifact[];
  overviewRollup?: WorkbenchOverviewRollup;
  projects?: Project[];
  projectRollups?: WorkbenchProjectRollup[];
  rawArtifacts?: WorkbenchRawArtifactMetadataRecord[];
  runAuditSnapshots?: StoredSessionRunAuditSnapshot[];
  sessionRollups?: WorkbenchSessionRollup[];
  sessions?: Session[];
  shellCommands?: ShellCommandEvidence[];
  toolCalls?: ToolCall[];
  verificationSnapshots?: StoredSessionVerificationSnapshot[];
}

interface EntityWriterLifecycleMarkerBase {
  ingestRunId: IngestRunId;
  adapterId: AdapterId;
  sourceId: SourceId;
  occurredAt: string;
  diagnosticIds?: string[];
}

export interface SourceStartLifecycleMarker extends EntityWriterLifecycleMarkerBase {
  kind: "source-start";
}

export interface SourceCompleteLifecycleMarker extends EntityWriterLifecycleMarkerBase {
  kind: "source-complete";
}

export interface SourceFailedLifecycleMarker extends EntityWriterLifecycleMarkerBase {
  kind: "source-failed";
  reason: string;
}

export interface ArtifactCompleteLifecycleMarker extends EntityWriterLifecycleMarkerBase {
  kind: "artifact-complete";
  artifactId: RawArtifactId;
}

export interface SessionCompleteLifecycleMarker extends EntityWriterLifecycleMarkerBase {
  kind: "session-complete";
  sessionId: SessionId;
}

export type EntityWriterLifecycleMarker =
  | ArtifactCompleteLifecycleMarker
  | SessionCompleteLifecycleMarker
  | SourceCompleteLifecycleMarker
  | SourceFailedLifecycleMarker
  | SourceStartLifecycleMarker;

export interface EntityWriter {
  markLifecycle(marker: EntityWriterLifecycleMarker): Promise<void>;
  writeBatch(batch: EntityWriteBatch): Promise<void>;
}
