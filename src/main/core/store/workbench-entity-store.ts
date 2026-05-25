import type { RunAuditResult } from "../audit/types.js";
import type { Diagnostic, DiagnosticScope, DiagnosticSeverity } from "../diagnostics/diagnostic.js";
import type { ProjectGitSnapshot } from "../git/git-snapshot-provider.js";
import type { ProjectGitHubSnapshot } from "../github/github-snapshot-provider.js";
import type { RawArtifactIndexEntry } from "../ingestion/raw-artifact-index.js";
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
import type {
  AdapterId,
  EventOrderKey,
  OutputArtifactId,
  ProjectId,
  RawArtifactId,
  SessionEventId,
  SessionId,
  SourceId
} from "../model/identifiers.js";
import type { VerificationResult } from "../verification/types.js";

export type IngestRunId = string;
export type WorkbenchIngestRunStatus = "staging" | "published" | "failed" | "cancelled";

export interface WorkbenchIngestRun {
  ingestRunId: IngestRunId;
  adapterId: AdapterId;
  sourceId: SourceId;
  status: WorkbenchIngestRunStatus;
  startedAt: string;
  updatedAt: string;
  publishedAt?: string;
  replacedIngestRunId?: IngestRunId;
  diagnosticIds?: string[];
}

export interface WorkbenchCurrentRunScope {
  sourceId: SourceId;
}

export interface BeginWorkbenchIngestRunInput extends WorkbenchCurrentRunScope {
  adapterId: AdapterId;
  ingestRunId?: IngestRunId;
  startedAt: string;
}

export interface PublishWorkbenchIngestRunInput extends WorkbenchCurrentRunScope {
  ingestRunId: IngestRunId;
  publishedAt: string;
}

export interface WorkbenchCleanupStaleRunsInput {
  beforeUpdatedAt: string;
  limit?: number;
  preservePublished?: boolean;
  sourceId?: SourceId;
}

export interface WorkbenchCleanupStaleRunsResult {
  removedCount: number;
  removedIngestRunIds: IngestRunId[];
}

export interface WorkbenchSessionCursorKey {
  lastUpdatedAt: string;
  sessionId: SessionId;
}

export interface WorkbenchTimelineCursorKey {
  eventId: SessionEventId;
  orderKey: EventOrderKey;
}

export interface WorkbenchKeysetPageInfo {
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
  totalCount?: number;
}

export interface WorkbenchSessionPageQuery extends WorkbenchCurrentRunScope {
  adapterId?: AdapterId;
  cursor?: string;
  limit?: number;
  projectId?: ProjectId;
}

export interface WorkbenchSessionRecord {
  session: Session;
  runAudit?: RunAuditResult;
  verification?: VerificationResult;
  diagnosticIds?: string[];
  outputArtifactCount?: number;
  rawArtifactCount?: number;
}

export interface WorkbenchSessionPage {
  items: WorkbenchSessionRecord[];
  pageInfo: WorkbenchKeysetPageInfo;
}

export interface WorkbenchTimelinePageQuery extends WorkbenchCurrentRunScope {
  cursor?: string;
  limit?: number;
  sessionId: SessionId;
}

export interface WorkbenchTimelineRecord {
  event: SessionEvent;
  diagnostics?: Diagnostic[];
  fileMutation?: FileMutationEvidence;
  message?: SessionMessage;
  outputArtifacts?: OutputArtifact[];
  shellCommand?: ShellCommandEvidence;
  toolCall?: ToolCall;
}

export interface WorkbenchTimelinePage {
  items: WorkbenchTimelineRecord[];
  pageInfo: WorkbenchKeysetPageInfo;
}

export interface StoredSessionVerificationSnapshot {
  sessionId: SessionId;
  verification: VerificationResult;
}

export interface StoredSessionRunAuditSnapshot {
  audit: RunAuditResult;
  sessionId: SessionId;
}

export interface StoredProjectGitSnapshot {
  git: ProjectGitSnapshot;
  projectId: ProjectId;
}

export interface StoredProjectGitHubSnapshot {
  github: ProjectGitHubSnapshot;
  projectId: ProjectId;
}

export interface WorkbenchRawArtifactMetadataRecord {
  artifactId: RawArtifactId;
  sourceId: SourceId;
  status: "available" | "missing";
  entry?: RawArtifactIndexEntry;
  outputArtifactId?: OutputArtifactId;
  reason?: string;
  sessionId?: SessionId;
}

export interface WorkbenchOverviewRollup {
  sourceId: SourceId;
  latestActivityAt?: string;
  needsAttentionCount: number;
  projectCount: number;
  sessionCount: number;
}

export interface WorkbenchProjectRollup {
  sourceId: SourceId;
  latestActivityAt?: string;
  latestRunAudit?: RunAuditResult;
  latestSessionId: SessionId;
  latestVerification?: VerificationResult;
  project?: Project;
  projectId?: ProjectId;
  rawArtifactCount?: number;
  sessionIds: SessionId[];
  git?: ProjectGitSnapshot;
  github?: ProjectGitHubSnapshot;
}

export interface WorkbenchSessionRollup {
  sourceId: SourceId;
  sessionId: SessionId;
  diagnosticCount?: number;
  latestActivityAt?: string;
  projectId?: ProjectId;
  rawArtifactCount?: number;
  runAudit?: RunAuditResult;
  session?: Session;
  verification?: VerificationResult;
}

export interface WorkbenchDiagnosticQuery extends WorkbenchCurrentRunScope {
  projectId?: ProjectId;
  relatedEntityId?: string;
  scope?: DiagnosticScope;
  sessionId?: SessionId;
  severity?: DiagnosticSeverity;
}

export interface WorkbenchEntityStore {
  beginIngestRun(input: BeginWorkbenchIngestRunInput): Promise<WorkbenchIngestRun>;
  cleanupStaleRuns(input: WorkbenchCleanupStaleRunsInput): Promise<WorkbenchCleanupStaleRunsResult>;
  getCurrentIngestRun(scope: WorkbenchCurrentRunScope): Promise<WorkbenchIngestRun | undefined>;
  getIngestRun(ingestRunId: IngestRunId): Promise<WorkbenchIngestRun | undefined>;
  getOverviewRollup(scope: WorkbenchCurrentRunScope): Promise<WorkbenchOverviewRollup | undefined>;
  getProjectGitHubSnapshot(
    scope: WorkbenchCurrentRunScope & { projectId: ProjectId }
  ): Promise<StoredProjectGitHubSnapshot | undefined>;
  getProjectGitSnapshot(
    scope: WorkbenchCurrentRunScope & { projectId: ProjectId }
  ): Promise<StoredProjectGitSnapshot | undefined>;
  getRawArtifactMetadata(
    scope: WorkbenchCurrentRunScope & { artifactId: RawArtifactId }
  ): Promise<WorkbenchRawArtifactMetadataRecord | undefined>;
  listRawArtifactMetadata(scope: WorkbenchCurrentRunScope): Promise<WorkbenchRawArtifactMetadataRecord[]>;
  getSessionRollup(
    scope: WorkbenchCurrentRunScope & { sessionId: SessionId }
  ): Promise<WorkbenchSessionRollup | undefined>;
  getSessionRunAuditSnapshot(
    scope: WorkbenchCurrentRunScope & { sessionId: SessionId }
  ): Promise<StoredSessionRunAuditSnapshot | undefined>;
  getSessionTimelinePage(query: WorkbenchTimelinePageQuery): Promise<WorkbenchTimelinePage>;
  getSessionVerificationSnapshot(
    scope: WorkbenchCurrentRunScope & { sessionId: SessionId }
  ): Promise<StoredSessionVerificationSnapshot | undefined>;
  listDiagnostics(query: WorkbenchDiagnosticQuery): Promise<Diagnostic[]>;
  listProjectRollups(scope: WorkbenchCurrentRunScope): Promise<WorkbenchProjectRollup[]>;
  listSessionsPage(query: WorkbenchSessionPageQuery): Promise<WorkbenchSessionPage>;
  publishIngestRun(input: PublishWorkbenchIngestRunInput): Promise<WorkbenchIngestRun>;
}
