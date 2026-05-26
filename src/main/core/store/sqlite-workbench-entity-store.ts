import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { createEmptyArchiveV3SectionEntityCounts } from "../archive/archive-manifest.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { DEFAULT_BOUNDED_INGESTION_LIMITS } from "../ingestion/bounded-ingestion.js";
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
import type { RawArtifactId } from "../model/identifiers.js";
import type { EntityWriteBatch, EntityWriter, EntityWriterLifecycleMarker } from "./entity-writer.js";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  PaginationValidationError,
  validatePageLimit
} from "./pagination.js";
import type {
  BeginWorkbenchIngestRunInput,
  PublishWorkbenchIngestRunInput,
  StoredProjectGitHubSnapshot,
  StoredProjectGitSnapshot,
  StoredSessionRunAuditSnapshot,
  StoredSessionVerificationSnapshot,
  WorkbenchCleanupStaleRunsInput,
  WorkbenchCleanupStaleRunsResult,
  WorkbenchCurrentRunScope,
  WorkbenchDiagnosticQuery,
  WorkbenchEntityStore,
  WorkbenchArchivePreflight,
  WorkbenchArtifactBlobRecord,
  WorkbenchIngestRun,
  WorkbenchKeysetPageInfo,
  WorkbenchOverviewRollup,
  WorkbenchProjectRollup,
  WorkbenchRawArtifactMetadataRecord,
  WorkbenchSessionCursorKey,
  WorkbenchSessionPage,
  WorkbenchSessionPageQuery,
  WorkbenchSessionRecord,
  WorkbenchSessionRollup,
  WorkbenchTimelineCursorKey,
  WorkbenchTimelinePage,
  WorkbenchTimelinePageQuery,
  WorkbenchTimelineRecord,
  WriteWorkbenchArtifactBlobInput
} from "./workbench-entity-store.js";
import { ArtifactBlobStore } from "./artifact-blob-store.js";

export interface SQLiteWorkbenchEntityStoreOptions {
  artifactBlobRootDir: string;
  databasePath: string;
  defaultPageLimit?: number;
  maxEntityBatchSize?: number;
  maxPageLimit?: number;
}

interface SQLiteRunRow {
  adapter_id: string;
  diagnostic_ids_json: string | null;
  ingest_run_id: string;
  published_at: string | null;
  replaced_ingest_run_id: string | null;
  source_id: string;
  started_at: string;
  status: WorkbenchIngestRun["status"];
  updated_at: string;
}

interface SQLiteJsonRow {
  payload_json: string;
}

interface SQLiteArtifactBlobRow {
  blob_id: string;
  byte_length: number;
  created_at: string;
  preview_text: string;
  relative_path: string;
}

export class SQLiteWorkbenchEntityStore implements WorkbenchEntityStore, EntityWriter {
  static readonly SCHEMA_VERSION = 1;

  readonly #artifactBlobStore: ArtifactBlobStore;
  readonly #db: DatabaseSync;
  readonly #defaultPageLimit: number;
  readonly #maxEntityBatchSize: number;
  readonly #maxPageLimit: number;
  readonly #statements = new Map<string, StatementSync>();

  constructor(options: SQLiteWorkbenchEntityStoreOptions) {
    this.#defaultPageLimit = options.defaultPageLimit ?? 50;
    this.#maxEntityBatchSize = options.maxEntityBatchSize ?? DEFAULT_BOUNDED_INGESTION_LIMITS.maxEntityBatchSize;
    this.#maxPageLimit = options.maxPageLimit ?? 100;
    this.#artifactBlobStore = new ArtifactBlobStore({
      rootDir: options.artifactBlobRootDir
    });

    mkdirSync(path.dirname(options.databasePath), { recursive: true });
    mkdirSync(options.artifactBlobRootDir, { recursive: true });

    this.#db = new DatabaseSync(options.databasePath, {
      timeout: 5_000
    });
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = NORMAL");

    this.#migrate();
  }

  close(): void {
    if (this.#db.isOpen) {
      this.#db.close();
    }
  }

  async beginIngestRun(input: BeginWorkbenchIngestRunInput): Promise<WorkbenchIngestRun> {
    const ingestRunId = input.ingestRunId ?? `run-${Date.now()}`;

    return this.#withTransaction(() => {
      this.#prepare(
        `INSERT INTO sources (source_id, adapter_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(source_id) DO NOTHING`
      ).run(input.sourceId, input.adapterId, input.startedAt);
      this.#prepare(
        `INSERT INTO ingest_runs (
           ingest_run_id,
           adapter_id,
           source_id,
           status,
           started_at,
           updated_at,
           published_at,
           replaced_ingest_run_id,
           diagnostic_ids_json
         ) VALUES (?, ?, ?, 'staging', ?, ?, NULL, NULL, NULL)`
      ).run(ingestRunId, input.adapterId, input.sourceId, input.startedAt, input.startedAt);

      return this.#requireRun(ingestRunId);
    });
  }

  async clearCurrentIngestRun(scope: WorkbenchCurrentRunScope): Promise<void> {
    this.#prepare(
      `UPDATE sources
       SET current_ingest_run_id = NULL,
           updated_at = ?
       WHERE source_id = ?`
    ).run(new Date().toISOString(), scope.sourceId);
  }

  async cleanupStaleRuns(input: WorkbenchCleanupStaleRunsInput): Promise<WorkbenchCleanupStaleRunsResult> {
    const preservePublished = input.preservePublished ?? true;
    const rows = this.#prepare(
      `SELECT ingest_run_id, source_id, status
       FROM ingest_runs
       WHERE updated_at < ?
         AND (? IS NULL OR source_id = ?)
       ORDER BY updated_at ASC
       LIMIT ?`
    ).all(
      input.beforeUpdatedAt,
      input.sourceId ?? null,
      input.sourceId ?? null,
      input.limit ?? Number.MAX_SAFE_INTEGER
    ) as Array<{ ingest_run_id: string; source_id: string; status: WorkbenchIngestRun["status"] }>;
    const removable = rows.filter((row) => {
      const currentRunId = this.#currentRunId(row.source_id);

      if (currentRunId === row.ingest_run_id) {
        return false;
      }

      return !(preservePublished && row.status === "published");
    });

    this.#withTransaction(() => {
      for (const row of removable) {
        this.#prepare("DELETE FROM ingest_runs WHERE ingest_run_id = ?").run(row.ingest_run_id);
      }
    });

    return {
      removedCount: removable.length,
      removedIngestRunIds: removable.map((row) => row.ingest_run_id)
    };
  }

  async getArchivePreflight(
    scope: WorkbenchCurrentRunScope
  ): Promise<WorkbenchArchivePreflight | undefined> {
    const run = await this.getCurrentIngestRun(scope);

    if (!run) {
      return undefined;
    }

    const sectionEntityCounts = createEmptyArchiveV3SectionEntityCounts();
    const countBySection = (tableName: string): number =>
      this.#countRowsForRun(tableName, run.ingestRunId, scope.sourceId);

    sectionEntityCounts.sources = 1;
    sectionEntityCounts.projects = countBySection("projects");
    sectionEntityCounts.sessions = countBySection("sessions");
    sectionEntityCounts["timeline-events"] = countBySection("timeline_events");
    sectionEntityCounts.messages = countBySection("messages");
    sectionEntityCounts["tool-calls"] = countBySection("tool_calls");
    sectionEntityCounts["shell-commands"] = countBySection("shell_commands");
    sectionEntityCounts["output-artifacts"] = countBySection("output_artifacts");
    sectionEntityCounts["file-mutations"] = countBySection("file_mutations");
    sectionEntityCounts.diagnostics = countBySection("diagnostics");
    sectionEntityCounts["verification-snapshots"] = countBySection("verification_snapshots");
    sectionEntityCounts["run-audit-snapshots"] = countBySection("run_audit_snapshots");
    sectionEntityCounts["git-snapshots"] = countBySection("git_snapshots");
    sectionEntityCounts["github-snapshots"] = countBySection("github_snapshots");
    sectionEntityCounts["overview-rollups"] = countBySection("overview_rollups");
    sectionEntityCounts["project-rollups"] = countBySection("project_rollups");
    sectionEntityCounts["session-rollups"] = countBySection("session_rollups");
    sectionEntityCounts["raw-artifact-entries"] = countBySection("raw_artifact_entries");

    return {
      adapterId: run.adapterId,
      ingestRunId: run.ingestRunId,
      sectionEntityCounts,
      sourceId: scope.sourceId,
      sourceRecordCount: sectionEntityCounts.sources,
      totalEntityCount: Object.values(sectionEntityCounts).reduce(
        (total, count) => total + count,
        0
      )
    };
  }

  async getArtifactBlob(blobId: string): Promise<WorkbenchArtifactBlobRecord | undefined> {
    const row = this.#prepare(
      `SELECT blob_id, relative_path, preview_text, byte_length, created_at
       FROM artifact_blobs
       WHERE blob_id = ?`
    ).get(blobId) as SQLiteArtifactBlobRow | undefined;

    return row ? mapArtifactBlobRow(row) : undefined;
  }

  async getCurrentIngestRun(scope: WorkbenchCurrentRunScope): Promise<WorkbenchIngestRun | undefined> {
    const ingestRunId = this.#currentRunId(scope.sourceId);
    return ingestRunId ? this.getIngestRun(ingestRunId) : undefined;
  }

  async getIngestRun(ingestRunId: string): Promise<WorkbenchIngestRun | undefined> {
    const row = this.#prepare(
      `SELECT ingest_run_id, adapter_id, source_id, status, started_at, updated_at, published_at,
              replaced_ingest_run_id, diagnostic_ids_json
       FROM ingest_runs
       WHERE ingest_run_id = ?`
    ).get(ingestRunId) as SQLiteRunRow | undefined;

    return row ? mapRunRow(row) : undefined;
  }

  async getOverviewRollup(scope: WorkbenchCurrentRunScope): Promise<WorkbenchOverviewRollup | undefined> {
    const ingestRunId = this.#currentRunId(scope.sourceId);

    if (!ingestRunId) {
      return undefined;
    }

    const row = this.#prepare(
      "SELECT payload_json FROM overview_rollups WHERE ingest_run_id = ? AND source_id = ?"
    ).get(ingestRunId, scope.sourceId) as SQLiteJsonRow | undefined;

    return row ? parseJson<WorkbenchOverviewRollup>(row.payload_json) : undefined;
  }

  async getProjectGitHubSnapshot(
    scope: WorkbenchCurrentRunScope & { projectId: string }
  ): Promise<StoredProjectGitHubSnapshot | undefined> {
    const row = this.#getCurrentPayloadRow("github_snapshots", scope.sourceId, "project_id", scope.projectId);

    return row ? parseJson<StoredProjectGitHubSnapshot>(row.payload_json) : undefined;
  }

  async getProjectGitSnapshot(
    scope: WorkbenchCurrentRunScope & { projectId: string }
  ): Promise<StoredProjectGitSnapshot | undefined> {
    const row = this.#getCurrentPayloadRow("git_snapshots", scope.sourceId, "project_id", scope.projectId);

    return row ? parseJson<StoredProjectGitSnapshot>(row.payload_json) : undefined;
  }

  async getRawArtifactMetadata(
    scope: WorkbenchCurrentRunScope & { artifactId: RawArtifactId }
  ): Promise<WorkbenchRawArtifactMetadataRecord | undefined> {
    const row = this.#getCurrentPayloadRow("raw_artifact_entries", scope.sourceId, "artifact_id", scope.artifactId);

    return row ? parseJson<WorkbenchRawArtifactMetadataRecord>(row.payload_json) : undefined;
  }

  async listRawArtifactMetadata(
    scope: WorkbenchCurrentRunScope
  ): Promise<WorkbenchRawArtifactMetadataRecord[]> {
    const ingestRunId = this.#currentRunId(scope.sourceId);

    if (!ingestRunId) {
      return [];
    }

    const rows = this.#prepare(
      `SELECT payload_json
       FROM raw_artifact_entries
       WHERE ingest_run_id = ?
         AND source_id = ?
       ORDER BY session_id ASC, artifact_id ASC`
    ).all(ingestRunId, scope.sourceId) as unknown as SQLiteJsonRow[];

    return rows.map((row) => parseJson<WorkbenchRawArtifactMetadataRecord>(row.payload_json));
  }

  async getRawArtifactMetadataByOutputArtifactId(
    scope: WorkbenchCurrentRunScope & { outputArtifactId: string }
  ): Promise<WorkbenchRawArtifactMetadataRecord | undefined> {
    const ingestRunId = this.#currentRunId(scope.sourceId);

    if (!ingestRunId) {
      return undefined;
    }

    const row = this.#prepare(
      `SELECT payload_json
       FROM raw_artifact_entries
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND output_artifact_id = ?`
    ).get(ingestRunId, scope.sourceId, scope.outputArtifactId) as SQLiteJsonRow | undefined;

    return row ? parseJson<WorkbenchRawArtifactMetadataRecord>(row.payload_json) : undefined;
  }

  async getOutputArtifact(
    scope: WorkbenchCurrentRunScope & { outputArtifactId: string }
  ): Promise<OutputArtifact | undefined> {
    const ingestRunId = this.#currentRunId(scope.sourceId);

    if (!ingestRunId) {
      return undefined;
    }

    const row = this.#prepare(
      `SELECT payload_json
       FROM output_artifacts
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND output_artifact_id = ?`
    ).get(ingestRunId, scope.sourceId, scope.outputArtifactId) as SQLiteJsonRow | undefined;

    return row ? parseJson<OutputArtifact>(row.payload_json) : undefined;
  }

  async getOutputArtifactTimelineRecord(
    scope: WorkbenchCurrentRunScope & {
      outputArtifactId: string;
      sessionId: string;
    }
  ): Promise<WorkbenchTimelineRecord | undefined> {
    const ingestRunId = this.#currentRunId(scope.sourceId);

    if (!ingestRunId) {
      return undefined;
    }

    const row = this.#prepare(
      `SELECT timeline_events.payload_json
       FROM output_artifacts
       INNER JOIN timeline_events
         ON output_artifacts.ingest_run_id = timeline_events.ingest_run_id
        AND output_artifacts.source_id = timeline_events.source_id
        AND output_artifacts.source_event_id = timeline_events.event_id
       WHERE output_artifacts.ingest_run_id = ?
         AND output_artifacts.source_id = ?
         AND output_artifacts.output_artifact_id = ?
         AND timeline_events.session_id = ?
       LIMIT 1`
    ).get(
      ingestRunId,
      scope.sourceId,
      scope.outputArtifactId,
      scope.sessionId
    ) as SQLiteJsonRow | undefined;

    if (!row) {
      return undefined;
    }

    const event = parseJson<SessionEvent>(row.payload_json);

    return {
      event,
      ...this.#getTimelineAttachments(ingestRunId, scope.sourceId, event.id)
    };
  }

  async getSessionRollup(
    scope: WorkbenchCurrentRunScope & { sessionId: string }
  ): Promise<WorkbenchSessionRollup | undefined> {
    const row = this.#getCurrentPayloadRow("session_rollups", scope.sourceId, "session_id", scope.sessionId);

    return row ? parseJson<WorkbenchSessionRollup>(row.payload_json) : undefined;
  }

  async getSessionRunAuditSnapshot(
    scope: WorkbenchCurrentRunScope & { sessionId: string }
  ): Promise<StoredSessionRunAuditSnapshot | undefined> {
    const row = this.#getCurrentPayloadRow("run_audit_snapshots", scope.sourceId, "session_id", scope.sessionId);

    return row ? parseJson<StoredSessionRunAuditSnapshot>(row.payload_json) : undefined;
  }

  async getSessionTimelinePage(query: WorkbenchTimelinePageQuery): Promise<WorkbenchTimelinePage> {
    const limit = validatePageLimit(query.limit, {
      defaultLimit: this.#defaultPageLimit,
      maxLimit: this.#maxPageLimit
    });
    const ingestRunId = this.#currentRunId(query.sourceId);

    if (!ingestRunId) {
      return emptyPage(limit);
    }

    let cursorKey: WorkbenchTimelineCursorKey | undefined;

    if (query.cursor) {
      cursorKey = decodeOpaqueCursor<WorkbenchTimelineCursorKey>(query.cursor);
      const exists = this.#prepare(
        `SELECT 1
         FROM timeline_events
         WHERE ingest_run_id = ?
           AND source_id = ?
           AND session_id = ?
           AND event_id = ?
           AND order_key = ?`
      ).get(ingestRunId, query.sourceId, query.sessionId, cursorKey.eventId, cursorKey.orderKey);

      if (!exists) {
        throw new PaginationValidationError("invalid-cursor");
      }
    }

    const rows = this.#prepare(
      `SELECT payload_json
       FROM timeline_events
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND session_id = ?
         AND (
           ? IS NULL OR order_key > ? OR (order_key = ? AND event_id > ?)
         )
       ORDER BY order_key ASC, event_id ASC
       LIMIT ?`
    ).all(
      ingestRunId,
      query.sourceId,
      query.sessionId,
      cursorKey?.orderKey ?? null,
      cursorKey?.orderKey ?? null,
      cursorKey?.orderKey ?? null,
      cursorKey?.eventId ?? null,
      limit + 1
    ) as unknown as SQLiteJsonRow[];
    const totalCountRow = this.#prepare(
      `SELECT COUNT(*) AS count
       FROM timeline_events
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND session_id = ?`
    ).get(ingestRunId, query.sourceId, query.sessionId) as { count: number };
    const hasMore = rows.length > limit;
    const pageEvents = rows.slice(0, limit).map((row) => parseJson<SessionEvent>(row.payload_json));
    const items: WorkbenchTimelineRecord[] = pageEvents.map((event) => ({
      event,
      ...this.#getTimelineAttachments(ingestRunId, query.sourceId, event.id)
    }));

    return {
      items,
      pageInfo: this.#buildPageInfo({
        hasMore,
        limit,
        ...(hasMore
          ? {
              nextCursor: encodeOpaqueCursor<WorkbenchTimelineCursorKey>({
                eventId: pageEvents.at(-1)!.id,
                orderKey: pageEvents.at(-1)!.orderKey ?? ""
              })
            }
          : {}),
        totalCount: totalCountRow.count
      })
    };
  }

  async getSessionVerificationSnapshot(
    scope: WorkbenchCurrentRunScope & { sessionId: string }
  ): Promise<StoredSessionVerificationSnapshot | undefined> {
    const row = this.#getCurrentPayloadRow("verification_snapshots", scope.sourceId, "session_id", scope.sessionId);

    return row ? parseJson<StoredSessionVerificationSnapshot>(row.payload_json) : undefined;
  }

  async listDiagnostics(query: WorkbenchDiagnosticQuery): Promise<Diagnostic[]> {
    const ingestRunId = this.#currentRunId(query.sourceId);

    if (!ingestRunId) {
      return [];
    }

    const rows = this.#prepare(
      `SELECT payload_json
       FROM diagnostics
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND (? IS NULL OR scope = ?)
         AND (? IS NULL OR severity = ?)
       ORDER BY diagnostic_id ASC`
    ).all(
      ingestRunId,
      query.sourceId,
      query.scope ?? null,
      query.scope ?? null,
      query.severity ?? null,
      query.severity ?? null
    ) as unknown as SQLiteJsonRow[];

    return rows
      .map((row) => parseJson<Diagnostic>(row.payload_json))
      .filter((diagnostic) => {
        const relatedIds = diagnostic.relatedEntityIds ?? [];

        if (query.relatedEntityId && !relatedIds.includes(query.relatedEntityId)) {
          return false;
        }

        if (query.sessionId && !relatedIds.includes(query.sessionId)) {
          return false;
        }

        if (query.projectId && !relatedIds.includes(query.projectId)) {
          return false;
        }

        return true;
      });
  }

  async listProjectRollups(scope: WorkbenchCurrentRunScope): Promise<WorkbenchProjectRollup[]> {
    const ingestRunId = this.#currentRunId(scope.sourceId);

    if (!ingestRunId) {
      return [];
    }

    const rows = this.#prepare(
      `SELECT payload_json
       FROM project_rollups
       WHERE ingest_run_id = ?
         AND source_id = ?
       ORDER BY latest_activity_at DESC, project_id ASC`
    ).all(ingestRunId, scope.sourceId) as unknown as SQLiteJsonRow[];

    return rows.map((row) => parseJson<WorkbenchProjectRollup>(row.payload_json));
  }

  async listSessionsPage(query: WorkbenchSessionPageQuery): Promise<WorkbenchSessionPage> {
    const limit = validatePageLimit(query.limit, {
      defaultLimit: this.#defaultPageLimit,
      maxLimit: this.#maxPageLimit
    });
    const ingestRunId = this.#currentRunId(query.sourceId);

    if (!ingestRunId) {
      return emptyPage(limit);
    }

    let cursorKey: WorkbenchSessionCursorKey | undefined;

    if (query.cursor) {
      cursorKey = decodeOpaqueCursor<WorkbenchSessionCursorKey>(query.cursor);
      const exists = this.#prepare(
        `SELECT 1
         FROM sessions
         WHERE ingest_run_id = ?
           AND source_id = ?
           AND session_id = ?
           AND last_updated_at = ?
           AND (? IS NULL OR adapter_id = ?)
           AND (? IS NULL OR project_id = ?)`
      ).get(
        ingestRunId,
        query.sourceId,
        cursorKey.sessionId,
        cursorKey.lastUpdatedAt,
        query.adapterId ?? null,
        query.adapterId ?? null,
        query.projectId ?? null,
        query.projectId ?? null
      );

      if (!exists) {
        throw new PaginationValidationError("invalid-cursor");
      }
    }

    const rows = this.#prepare(
      `SELECT payload_json
       FROM sessions
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND (? IS NULL OR adapter_id = ?)
         AND (? IS NULL OR project_id = ?)
         AND (
           ? IS NULL
           OR last_updated_at < ?
           OR (last_updated_at = ? AND session_id < ?)
         )
       ORDER BY last_updated_at DESC, session_id DESC
       LIMIT ?`
    ).all(
      ingestRunId,
      query.sourceId,
      query.adapterId ?? null,
      query.adapterId ?? null,
      query.projectId ?? null,
      query.projectId ?? null,
      cursorKey?.lastUpdatedAt ?? null,
      cursorKey?.lastUpdatedAt ?? null,
      cursorKey?.lastUpdatedAt ?? null,
      cursorKey?.sessionId ?? null,
      limit + 1
    ) as unknown as SQLiteJsonRow[];
    const totalCountRow = this.#prepare(
      `SELECT COUNT(*) AS count
       FROM sessions
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND (? IS NULL OR adapter_id = ?)
         AND (? IS NULL OR project_id = ?)`
    ).get(
      ingestRunId,
      query.sourceId,
      query.adapterId ?? null,
      query.adapterId ?? null,
      query.projectId ?? null,
      query.projectId ?? null
    ) as { count: number };
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map((row) => parseJson<Session>(row.payload_json));
    const items = sessions.map((session) => this.#buildSessionRecord(ingestRunId, query.sourceId, session));

    return {
      items,
      pageInfo: this.#buildPageInfo({
        hasMore,
        limit,
        ...(hasMore
          ? {
              nextCursor: encodeOpaqueCursor<WorkbenchSessionCursorKey>({
                lastUpdatedAt: sessions.at(-1)!.lastUpdatedAt ?? "",
                sessionId: sessions.at(-1)!.id
              })
            }
          : {}),
        totalCount: totalCountRow.count
      })
    };
  }

  async markLifecycle(marker: EntityWriterLifecycleMarker): Promise<void> {
    const run = this.#requireRunForScope(marker);
    const diagnosticIds = marker.diagnosticIds?.length ? JSON.stringify(marker.diagnosticIds) : null;

    this.#prepare(
      `UPDATE ingest_runs
       SET status = ?, updated_at = ?, diagnostic_ids_json = COALESCE(?, diagnostic_ids_json)
       WHERE ingest_run_id = ?`
    ).run(
      marker.kind === "source-failed" ? "failed" : run.status,
      marker.occurredAt,
      diagnosticIds,
      marker.ingestRunId
    );
  }

  async publishIngestRun(input: PublishWorkbenchIngestRunInput): Promise<WorkbenchIngestRun> {
    const run = this.#requireRunForScope(input);

    return this.#withTransaction(() => {
      const previousCurrentRunId = this.#currentRunId(input.sourceId);

      this.#prepare(
        `UPDATE ingest_runs
         SET status = 'published',
             published_at = ?,
             updated_at = ?,
             replaced_ingest_run_id = ?
         WHERE ingest_run_id = ?`
      ).run(
        input.publishedAt,
        input.publishedAt,
        previousCurrentRunId && previousCurrentRunId !== input.ingestRunId ? previousCurrentRunId : null,
        input.ingestRunId
      );
      this.#prepare(
        `INSERT INTO sources (source_id, adapter_id, current_ingest_run_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           adapter_id = excluded.adapter_id,
           current_ingest_run_id = excluded.current_ingest_run_id,
           updated_at = excluded.updated_at`
      ).run(input.sourceId, run.adapterId, input.ingestRunId, input.publishedAt);

      return this.#requireRun(input.ingestRunId);
    });
  }

  async writeArtifactBlob(
    input: WriteWorkbenchArtifactBlobInput
  ): Promise<WorkbenchArtifactBlobRecord> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const blob = await this.#artifactBlobStore.writeTextBlob(input);

    this.#prepare(
      `INSERT INTO artifact_blobs (
         blob_id,
         relative_path,
         preview_text,
         byte_length,
         created_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(blob_id) DO UPDATE SET
         relative_path = excluded.relative_path,
         preview_text = excluded.preview_text,
         byte_length = excluded.byte_length,
         created_at = excluded.created_at`
    ).run(blob.blobId, blob.relativePath, blob.previewText, blob.byteLength, createdAt);

    return {
      ...blob,
      createdAt
    };
  }

  async writeBatch(batch: EntityWriteBatch): Promise<void> {
    this.#assertBatchBounded(batch);
    const run = this.#requireRunForScope(batch);

    this.#withTransaction(() => {
      if (batch.projects) {
        this.#writeProjects(run.ingestRunId, batch.sourceId, batch.adapterId, batch.projects);
      }

      if (batch.sessions) {
        this.#writeSessions(run.ingestRunId, batch.sourceId, batch.adapterId, batch.sessions);
      }

      if (batch.events) {
        this.#writeTimelineEvents(run.ingestRunId, batch.sourceId, batch.adapterId, batch.events);
      }

      if (batch.messages) {
        this.#writeMessages(run.ingestRunId, batch.sourceId, batch.adapterId, batch.messages);
      }

      if (batch.toolCalls) {
        this.#writeToolCalls(run.ingestRunId, batch.sourceId, batch.adapterId, batch.toolCalls);
      }

      if (batch.shellCommands) {
        this.#writeShellCommands(run.ingestRunId, batch.sourceId, batch.adapterId, batch.shellCommands);
      }

      if (batch.outputArtifacts) {
        this.#writeOutputArtifacts(run.ingestRunId, batch.sourceId, batch.adapterId, batch.outputArtifacts);
      }

      if (batch.fileMutations) {
        this.#writeFileMutations(run.ingestRunId, batch.sourceId, batch.adapterId, batch.fileMutations);
      }

      if (batch.diagnostics) {
        this.#writeDiagnostics(run.ingestRunId, batch.sourceId, batch.adapterId, batch.diagnostics);
      }

      if (batch.verificationSnapshots) {
        this.#writePayloadRows(run.ingestRunId, batch.sourceId, "verification_snapshots", "session_id", batch.verificationSnapshots, (snapshot) => snapshot.sessionId);
      }

      if (batch.runAuditSnapshots) {
        this.#writePayloadRows(run.ingestRunId, batch.sourceId, "run_audit_snapshots", "session_id", batch.runAuditSnapshots, (snapshot) => snapshot.sessionId);
      }

      if (batch.gitSnapshots) {
        this.#writePayloadRows(run.ingestRunId, batch.sourceId, "git_snapshots", "project_id", batch.gitSnapshots, (snapshot) => snapshot.projectId);
      }

      if (batch.githubSnapshots) {
        this.#writePayloadRows(run.ingestRunId, batch.sourceId, "github_snapshots", "project_id", batch.githubSnapshots, (snapshot) => snapshot.projectId);
      }

      if (batch.rawArtifacts) {
        this.#writeRawArtifacts(run.ingestRunId, batch.sourceId, batch.rawArtifacts);
      }

      if (batch.overviewRollup) {
        this.#prepare(
          `INSERT INTO overview_rollups (
             ingest_run_id, source_id, latest_activity_at, needs_attention_count, project_count, session_count, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(ingest_run_id, source_id) DO UPDATE SET
             latest_activity_at = excluded.latest_activity_at,
             needs_attention_count = excluded.needs_attention_count,
             project_count = excluded.project_count,
             session_count = excluded.session_count,
             payload_json = excluded.payload_json`
        ).run(
          run.ingestRunId,
          batch.sourceId,
          batch.overviewRollup.latestActivityAt ?? "",
          batch.overviewRollup.needsAttentionCount,
          batch.overviewRollup.projectCount,
          batch.overviewRollup.sessionCount,
          JSON.stringify(batch.overviewRollup)
        );
      }

      if (batch.projectRollups) {
        this.#writeProjectRollups(run.ingestRunId, batch.sourceId, batch.projectRollups);
      }

      if (batch.sessionRollups) {
        this.#writeSessionRollups(run.ingestRunId, batch.sourceId, batch.sessionRollups);
      }

      this.#prepare("UPDATE ingest_runs SET updated_at = ? WHERE ingest_run_id = ?").run(
        mostRecentTimestamp(run.updatedAt, batch),
        run.ingestRunId
      );
    });
  }

  #assertBatchBounded(batch: EntityWriteBatch): void {
    const entries = Object.entries(batch).filter(([, value]) => Array.isArray(value));

    for (const [key, value] of entries) {
      if (value.length > this.#maxEntityBatchSize) {
        throw new Error(
          `The ${key} batch exceeds the ${this.#maxEntityBatchSize}-entity bounded ingestion limit.`
        );
      }
    }
  }

  #buildPageInfo(input: {
    hasMore: boolean;
    limit: number;
    nextCursor?: string;
    totalCount?: number;
  }): WorkbenchKeysetPageInfo {
    return {
      hasMore: input.hasMore,
      limit: input.limit,
      ...(input.nextCursor ? { nextCursor: input.nextCursor } : {}),
      ...(input.totalCount !== undefined ? { totalCount: input.totalCount } : {})
    };
  }

  #buildSessionRecord(ingestRunId: string, sourceId: string, session: Session): WorkbenchSessionRecord {
    const verificationRow = this.#getCurrentPayloadRow("verification_snapshots", sourceId, "session_id", session.id);
    const runAuditRow = this.#getCurrentPayloadRow("run_audit_snapshots", sourceId, "session_id", session.id);
    const verification = verificationRow
      ? parseJson<StoredSessionVerificationSnapshot>(verificationRow.payload_json).verification
      : undefined;
    const runAudit = runAuditRow
      ? parseJson<StoredSessionRunAuditSnapshot>(runAuditRow.payload_json).audit
      : undefined;
    const diagnosticIds = (
      this.#prepare(
        `SELECT diagnostic_id
         FROM diagnostic_relations
         WHERE ingest_run_id = ?
           AND source_id = ?
           AND related_entity_id = ?
         ORDER BY diagnostic_id ASC`
      ).all(ingestRunId, sourceId, session.id) as Array<{ diagnostic_id: string }>
    ).map((row) => row.diagnostic_id);
    const outputArtifactCountRow = this.#prepare(
      `SELECT COUNT(*) AS count
       FROM output_artifacts
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND session_id = ?`
    ).get(ingestRunId, sourceId, session.id) as { count: number };
    const rawArtifactCountRow = this.#prepare(
      `SELECT COUNT(*) AS count
       FROM raw_artifact_entries
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND session_id = ?`
    ).get(ingestRunId, sourceId, session.id) as { count: number };

    return {
      session,
      ...(verification ? { verification } : {}),
      ...(runAudit ? { runAudit } : {}),
      ...(diagnosticIds.length > 0 ? { diagnosticIds } : {}),
      outputArtifactCount: outputArtifactCountRow.count,
      rawArtifactCount: rawArtifactCountRow.count
    };
  }

  #currentRunId(sourceId: string): string | undefined {
    const row = this.#prepare("SELECT current_ingest_run_id FROM sources WHERE source_id = ?").get(sourceId) as
      | { current_ingest_run_id: string | null }
      | undefined;

    return row?.current_ingest_run_id ?? undefined;
  }

  #countRowsForRun(tableName: string, ingestRunId: string, sourceId: string): number {
    const row = this.#prepare(
      `SELECT COUNT(*) AS count
       FROM ${tableName}
       WHERE ingest_run_id = ?
         AND source_id = ?`
    ).get(ingestRunId, sourceId) as { count: number };

    return row.count;
  }

  #getCurrentPayloadRow(
    tableName: string,
    sourceId: string,
    keyColumn: string,
    keyValue: string
  ): SQLiteJsonRow | undefined {
    const ingestRunId = this.#currentRunId(sourceId);

    if (!ingestRunId) {
      return undefined;
    }

    return this.#prepare(
      `SELECT payload_json
       FROM ${tableName}
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND ${keyColumn} = ?`
    ).get(ingestRunId, sourceId, keyValue) as SQLiteJsonRow | undefined;
  }

  #getTimelineAttachments(
    ingestRunId: string,
    sourceId: string,
    eventId: string
  ): Omit<WorkbenchTimelineRecord, "event"> {
    const diagnostics = (
      this.#prepare(
        `SELECT diagnostics.payload_json
         FROM diagnostics
         INNER JOIN diagnostic_relations
           ON diagnostics.ingest_run_id = diagnostic_relations.ingest_run_id
          AND diagnostics.diagnostic_id = diagnostic_relations.diagnostic_id
         WHERE diagnostics.ingest_run_id = ?
           AND diagnostics.source_id = ?
           AND diagnostic_relations.related_entity_id = ?
         ORDER BY diagnostics.diagnostic_id ASC`
      ).all(ingestRunId, sourceId, eventId) as unknown as SQLiteJsonRow[]
    ).map((row) => parseJson<Diagnostic>(row.payload_json));
    const message = this.#selectPayloadByEventId<SessionMessage>("messages", ingestRunId, sourceId, eventId);
    const toolCall = this.#selectPayloadByEventId<ToolCall>("tool_calls", ingestRunId, sourceId, eventId);
    const shellCommand = this.#selectPayloadByEventId<ShellCommandEvidence>("shell_commands", ingestRunId, sourceId, eventId);
    const fileMutation = this.#selectPayloadByEventId<FileMutationEvidence>("file_mutations", ingestRunId, sourceId, eventId);
    const outputArtifacts = (
      this.#prepare(
        `SELECT payload_json
         FROM output_artifacts
         WHERE ingest_run_id = ?
           AND source_id = ?
           AND source_event_id = ?
         ORDER BY output_artifact_id ASC`
      ).all(ingestRunId, sourceId, eventId) as unknown as SQLiteJsonRow[]
    ).map((row) => parseJson<OutputArtifact>(row.payload_json));

    return {
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
      ...(fileMutation ? { fileMutation } : {}),
      ...(message ? { message } : {}),
      ...(outputArtifacts.length > 0 ? { outputArtifacts } : {}),
      ...(shellCommand ? { shellCommand } : {}),
      ...(toolCall ? { toolCall } : {})
    };
  }

  #migrate(): void {
    const currentVersionRow = this.#prepare("PRAGMA user_version").get() as { user_version: number };
    const currentVersion = currentVersionRow.user_version;

    if (currentVersion > SQLiteWorkbenchEntityStore.SCHEMA_VERSION) {
      throw new Error(
        `Unsupported workbench entity store schema version ${currentVersion}.`
      );
    }

    if (currentVersion === 0) {
      this.#withTransaction(() => {
        this.#db.exec(`
          CREATE TABLE IF NOT EXISTS sources (
            source_id TEXT PRIMARY KEY,
            adapter_id TEXT NOT NULL,
            current_ingest_run_id TEXT REFERENCES ingest_runs(ingest_run_id) ON DELETE SET NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS ingest_runs (
            ingest_run_id TEXT PRIMARY KEY,
            adapter_id TEXT NOT NULL,
            source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            published_at TEXT,
            replaced_ingest_run_id TEXT,
            diagnostic_ids_json TEXT
          );

          CREATE TABLE IF NOT EXISTS projects (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            latest_activity_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, project_id)
          );

          CREATE TABLE IF NOT EXISTS sessions (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            project_id TEXT,
            last_updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, session_id)
          );

          CREATE TABLE IF NOT EXISTS timeline_events (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            order_key TEXT NOT NULL,
            event_timestamp TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, event_id)
          );

          CREATE TABLE IF NOT EXISTS messages (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            source_event_id TEXT,
            message_timestamp TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, message_id)
          );

          CREATE TABLE IF NOT EXISTS tool_calls (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            source_event_id TEXT,
            started_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, tool_call_id)
          );

          CREATE TABLE IF NOT EXISTS shell_commands (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            shell_command_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            tool_call_id TEXT,
            source_event_id TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, shell_command_id)
          );

          CREATE TABLE IF NOT EXISTS output_artifacts (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            output_artifact_id TEXT NOT NULL,
            session_id TEXT,
            source_event_id TEXT,
            artifact_path TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, output_artifact_id)
          );

          CREATE TABLE IF NOT EXISTS file_mutations (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            file_mutation_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            tool_call_id TEXT,
            source_event_id TEXT,
            file_path TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, file_mutation_id)
          );

          CREATE TABLE IF NOT EXISTS diagnostics (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            diagnostic_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            severity TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, diagnostic_id)
          );

          CREATE TABLE IF NOT EXISTS diagnostic_relations (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            diagnostic_id TEXT NOT NULL,
            related_entity_id TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, diagnostic_id, related_entity_id)
          );

          CREATE TABLE IF NOT EXISTS raw_artifact_entries (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            artifact_id TEXT NOT NULL,
            session_id TEXT,
            output_artifact_id TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, artifact_id)
          );

          CREATE TABLE IF NOT EXISTS verification_snapshots (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, session_id)
          );

          CREATE TABLE IF NOT EXISTS run_audit_snapshots (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, session_id)
          );

          CREATE TABLE IF NOT EXISTS git_snapshots (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, project_id)
          );

          CREATE TABLE IF NOT EXISTS github_snapshots (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, project_id)
          );

          CREATE TABLE IF NOT EXISTS overview_rollups (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            latest_activity_at TEXT NOT NULL,
            needs_attention_count INTEGER NOT NULL,
            project_count INTEGER NOT NULL,
            session_count INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, source_id)
          );

          CREATE TABLE IF NOT EXISTS project_rollups (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            latest_activity_at TEXT NOT NULL,
            latest_session_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, project_id)
          );

          CREATE TABLE IF NOT EXISTS session_rollups (
            ingest_run_id TEXT NOT NULL REFERENCES ingest_runs(ingest_run_id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            project_id TEXT,
            latest_activity_at TEXT NOT NULL,
            diagnostic_count INTEGER NOT NULL,
            raw_artifact_count INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (ingest_run_id, session_id)
          );

          CREATE TABLE IF NOT EXISTS artifact_blobs (
            blob_id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            preview_text TEXT NOT NULL,
            byte_length INTEGER NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_sources_current_run
            ON sources (current_ingest_run_id);
          CREATE INDEX IF NOT EXISTS idx_sessions_source_activity
            ON sessions (source_id, ingest_run_id, last_updated_at DESC, session_id DESC);
          CREATE INDEX IF NOT EXISTS idx_sessions_source_project_activity
            ON sessions (source_id, ingest_run_id, project_id, last_updated_at DESC, session_id DESC);
          CREATE INDEX IF NOT EXISTS idx_timeline_session_order
            ON timeline_events (source_id, ingest_run_id, session_id, order_key ASC, event_id ASC);
          CREATE INDEX IF NOT EXISTS idx_diagnostics_scope
            ON diagnostics (source_id, ingest_run_id, scope, severity, diagnostic_id);
          CREATE INDEX IF NOT EXISTS idx_diagnostic_relations_entity
            ON diagnostic_relations (source_id, ingest_run_id, related_entity_id, diagnostic_id);
          CREATE INDEX IF NOT EXISTS idx_output_artifacts_session
            ON output_artifacts (source_id, ingest_run_id, session_id, output_artifact_id);
          CREATE INDEX IF NOT EXISTS idx_raw_artifacts_session
            ON raw_artifact_entries (source_id, ingest_run_id, session_id, artifact_id);
          CREATE INDEX IF NOT EXISTS idx_project_rollups_activity
            ON project_rollups (source_id, ingest_run_id, latest_activity_at DESC, project_id ASC);
          CREATE INDEX IF NOT EXISTS idx_session_rollups_activity
            ON session_rollups (source_id, ingest_run_id, latest_activity_at DESC, session_id ASC);

          PRAGMA user_version = ${SQLiteWorkbenchEntityStore.SCHEMA_VERSION};
        `);
      });
    }
  }

  #prepare(sql: string): StatementSync {
    const cached = this.#statements.get(sql);

    if (cached) {
      return cached;
    }

    const statement = this.#db.prepare(sql);
    this.#statements.set(sql, statement);
    return statement;
  }

  #requireRun(ingestRunId: string): WorkbenchIngestRun {
    const row = this.#prepare(
      `SELECT ingest_run_id, adapter_id, source_id, status, started_at, updated_at, published_at,
              replaced_ingest_run_id, diagnostic_ids_json
       FROM ingest_runs
       WHERE ingest_run_id = ?`
    ).get(ingestRunId) as SQLiteRunRow | undefined;

    if (!row) {
      throw new Error(`Missing run ${ingestRunId}.`);
    }

    return mapRunRow(row);
  }

  #requireRunForScope(input: { adapterId?: string; ingestRunId: string; sourceId: string }): WorkbenchIngestRun {
    const run = this.#requireRun(input.ingestRunId);

    if (run.sourceId !== input.sourceId || (input.adapterId && run.adapterId !== input.adapterId)) {
      throw new Error("The ingest run scope does not match the requested source or adapter.");
    }

    return run;
  }

  #selectPayloadByEventId<TPayload>(
    tableName: string,
    ingestRunId: string,
    sourceId: string,
    eventId: string
  ): TPayload | undefined {
    const row = this.#prepare(
      `SELECT payload_json
       FROM ${tableName}
       WHERE ingest_run_id = ?
         AND source_id = ?
         AND source_event_id = ?
       LIMIT 1`
    ).get(ingestRunId, sourceId, eventId) as SQLiteJsonRow | undefined;

    return row ? parseJson<TPayload>(row.payload_json) : undefined;
  }

  #withTransaction<TResult>(callback: () => TResult): TResult {
    this.#db.exec("BEGIN IMMEDIATE");

    try {
      const result = callback();

      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #writeDiagnostics(ingestRunId: string, sourceId: string, adapterId: string, diagnostics: Diagnostic[]): void {
    const insertDiagnostic = this.#prepare(
      `INSERT INTO diagnostics (
         ingest_run_id, source_id, adapter_id, diagnostic_id, scope, severity, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, diagnostic_id) DO UPDATE SET
         scope = excluded.scope,
         severity = excluded.severity,
         payload_json = excluded.payload_json`
    );
    const deleteRelations = this.#prepare(
      `DELETE FROM diagnostic_relations
       WHERE ingest_run_id = ?
         AND diagnostic_id = ?`
    );
    const insertRelation = this.#prepare(
      `INSERT INTO diagnostic_relations (
         ingest_run_id, source_id, diagnostic_id, related_entity_id
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, diagnostic_id, related_entity_id) DO NOTHING`
    );

    for (const diagnostic of diagnostics) {
      insertDiagnostic.run(
        ingestRunId,
        sourceId,
        adapterId,
        diagnostic.id,
        diagnostic.scope,
        diagnostic.severity,
        JSON.stringify(diagnostic)
      );
      deleteRelations.run(ingestRunId, diagnostic.id);

      for (const relatedEntityId of diagnostic.relatedEntityIds ?? []) {
        insertRelation.run(ingestRunId, sourceId, diagnostic.id, relatedEntityId);
      }
    }
  }

  #writeFileMutations(
    ingestRunId: string,
    sourceId: string,
    adapterId: string,
    fileMutations: FileMutationEvidence[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO file_mutations (
         ingest_run_id, source_id, adapter_id, file_mutation_id, session_id, tool_call_id, source_event_id, file_path, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, file_mutation_id) DO UPDATE SET
         session_id = excluded.session_id,
         tool_call_id = excluded.tool_call_id,
         source_event_id = excluded.source_event_id,
         file_path = excluded.file_path,
         payload_json = excluded.payload_json`
    );

    for (const fileMutation of fileMutations) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        fileMutation.id,
        fileMutation.sessionId,
        fileMutation.toolCallId ?? null,
        sourceEventIdFromValue(fileMutation.source),
        fileMutation.path,
        JSON.stringify(fileMutation)
      );
    }
  }

  #writeMessages(ingestRunId: string, sourceId: string, adapterId: string, messages: SessionMessage[]): void {
    const statement = this.#prepare(
      `INSERT INTO messages (
         ingest_run_id, source_id, adapter_id, message_id, session_id, source_event_id, message_timestamp, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, message_id) DO UPDATE SET
         session_id = excluded.session_id,
         source_event_id = excluded.source_event_id,
         message_timestamp = excluded.message_timestamp,
         payload_json = excluded.payload_json`
    );

    for (const message of messages) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        message.id,
        message.sessionId,
        message.eventIds?.[0] ?? null,
        message.timestamp ?? "",
        JSON.stringify(message)
      );
    }
  }

  #writeOutputArtifacts(
    ingestRunId: string,
    sourceId: string,
    adapterId: string,
    outputArtifacts: OutputArtifact[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO output_artifacts (
         ingest_run_id, source_id, adapter_id, output_artifact_id, session_id, source_event_id, artifact_path, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, output_artifact_id) DO UPDATE SET
         session_id = excluded.session_id,
         source_event_id = excluded.source_event_id,
         artifact_path = excluded.artifact_path,
         payload_json = excluded.payload_json`
    );

    for (const artifact of outputArtifacts) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        artifact.id,
        artifact.sessionId ?? null,
        sourceEventIdFromValue(artifact.source),
        artifact.path ?? null,
        JSON.stringify(artifact)
      );
    }
  }

  #writePayloadRows<TPayload extends object>(
    ingestRunId: string,
    sourceId: string,
    tableName: string,
    keyColumn: string,
    items: TPayload[],
    selectId: (item: TPayload) => string
  ): void {
    const statement = this.#prepare(
      `INSERT INTO ${tableName} (ingest_run_id, source_id, ${keyColumn}, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, ${keyColumn}) DO UPDATE SET
         payload_json = excluded.payload_json`
    );

    for (const item of items) {
      statement.run(ingestRunId, sourceId, selectId(item), JSON.stringify(item));
    }
  }

  #writeProjectRollups(
    ingestRunId: string,
    sourceId: string,
    rollups: WorkbenchProjectRollup[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO project_rollups (
         ingest_run_id, source_id, project_id, latest_activity_at, latest_session_id, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, project_id) DO UPDATE SET
         latest_activity_at = excluded.latest_activity_at,
         latest_session_id = excluded.latest_session_id,
         payload_json = excluded.payload_json`
    );

    for (const rollup of rollups) {
      statement.run(
        ingestRunId,
        sourceId,
        rollup.projectId ?? "",
        rollup.latestActivityAt ?? "",
        rollup.latestSessionId,
        JSON.stringify(rollup)
      );
    }
  }

  #writeProjects(ingestRunId: string, sourceId: string, adapterId: string, projects: Project[]): void {
    const statement = this.#prepare(
      `INSERT INTO projects (
         ingest_run_id, source_id, adapter_id, project_id, latest_activity_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, project_id) DO UPDATE SET
         latest_activity_at = excluded.latest_activity_at,
         payload_json = excluded.payload_json`
    );

    for (const project of projects) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        project.id,
        project.latestActivityAt ?? "",
        JSON.stringify(project)
      );
    }
  }

  #writeRawArtifacts(
    ingestRunId: string,
    sourceId: string,
    rawArtifacts: WorkbenchRawArtifactMetadataRecord[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO raw_artifact_entries (
         ingest_run_id, source_id, artifact_id, session_id, output_artifact_id, status, reason, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, artifact_id) DO UPDATE SET
         session_id = excluded.session_id,
         output_artifact_id = excluded.output_artifact_id,
         status = excluded.status,
         reason = excluded.reason,
         payload_json = excluded.payload_json`
    );

    for (const rawArtifact of rawArtifacts) {
      statement.run(
        ingestRunId,
        sourceId,
        rawArtifact.artifactId,
        rawArtifact.sessionId ?? null,
        rawArtifact.outputArtifactId ?? null,
        rawArtifact.status,
        rawArtifact.reason ?? null,
        JSON.stringify(rawArtifact)
      );
    }
  }

  #writeSessionRollups(
    ingestRunId: string,
    sourceId: string,
    rollups: WorkbenchSessionRollup[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO session_rollups (
         ingest_run_id, source_id, session_id, project_id, latest_activity_at, diagnostic_count, raw_artifact_count, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, session_id) DO UPDATE SET
         project_id = excluded.project_id,
         latest_activity_at = excluded.latest_activity_at,
         diagnostic_count = excluded.diagnostic_count,
         raw_artifact_count = excluded.raw_artifact_count,
         payload_json = excluded.payload_json`
    );

    for (const rollup of rollups) {
      statement.run(
        ingestRunId,
        sourceId,
        rollup.sessionId,
        rollup.projectId ?? null,
        rollup.latestActivityAt ?? "",
        rollup.diagnosticCount ?? 0,
        rollup.rawArtifactCount ?? 0,
        JSON.stringify(rollup)
      );
    }
  }

  #writeSessions(ingestRunId: string, sourceId: string, adapterId: string, sessions: Session[]): void {
    const statement = this.#prepare(
      `INSERT INTO sessions (
         ingest_run_id, source_id, adapter_id, session_id, project_id, last_updated_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, session_id) DO UPDATE SET
         project_id = excluded.project_id,
         last_updated_at = excluded.last_updated_at,
         payload_json = excluded.payload_json`
    );

    for (const session of sessions) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        session.id,
        session.projectId ?? null,
        session.lastUpdatedAt ?? session.startedAt ?? "",
        JSON.stringify(session)
      );
    }
  }

  #writeShellCommands(
    ingestRunId: string,
    sourceId: string,
    adapterId: string,
    shellCommands: ShellCommandEvidence[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO shell_commands (
         ingest_run_id, source_id, adapter_id, shell_command_id, session_id, tool_call_id, source_event_id, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, shell_command_id) DO UPDATE SET
         session_id = excluded.session_id,
         tool_call_id = excluded.tool_call_id,
         source_event_id = excluded.source_event_id,
         payload_json = excluded.payload_json`
    );

    for (const shellCommand of shellCommands) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        shellCommand.id,
        shellCommand.sessionId,
        shellCommand.toolCallId ?? null,
        sourceEventIdFromValue(shellCommand.source),
        JSON.stringify(shellCommand)
      );
    }
  }

  #writeTimelineEvents(
    ingestRunId: string,
    sourceId: string,
    adapterId: string,
    events: SessionEvent[]
  ): void {
    const statement = this.#prepare(
      `INSERT INTO timeline_events (
         ingest_run_id, source_id, adapter_id, event_id, session_id, order_key, event_timestamp, kind, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, event_id) DO UPDATE SET
         session_id = excluded.session_id,
         order_key = excluded.order_key,
         event_timestamp = excluded.event_timestamp,
         kind = excluded.kind,
         payload_json = excluded.payload_json`
    );

    for (const event of events) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        event.id,
        event.sessionId,
        event.orderKey ?? "",
        event.timestamp ?? "",
        event.kind,
        JSON.stringify(event)
      );
    }
  }

  #writeToolCalls(ingestRunId: string, sourceId: string, adapterId: string, toolCalls: ToolCall[]): void {
    const statement = this.#prepare(
      `INSERT INTO tool_calls (
         ingest_run_id, source_id, adapter_id, tool_call_id, session_id, source_event_id, started_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ingest_run_id, tool_call_id) DO UPDATE SET
         session_id = excluded.session_id,
         source_event_id = excluded.source_event_id,
         started_at = excluded.started_at,
         payload_json = excluded.payload_json`
    );

    for (const toolCall of toolCalls) {
      statement.run(
        ingestRunId,
        sourceId,
        adapterId,
        toolCall.id,
        toolCall.sessionId,
        sourceEventIdFromValue(toolCall.source),
        toolCall.startedAt ?? "",
        JSON.stringify(toolCall)
      );
    }
  }
}

function emptyPage(limit: number): WorkbenchSessionPage & WorkbenchTimelinePage {
  return {
    items: [],
    pageInfo: {
      hasMore: false,
      limit,
      totalCount: 0
    }
  };
}

function mapRunRow(row: SQLiteRunRow): WorkbenchIngestRun {
  return {
    ingestRunId: row.ingest_run_id,
    adapterId: row.adapter_id,
    sourceId: row.source_id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.replaced_ingest_run_id ? { replacedIngestRunId: row.replaced_ingest_run_id } : {}),
    ...(row.diagnostic_ids_json
      ? { diagnosticIds: parseJson<string[]>(row.diagnostic_ids_json) }
      : {})
  };
}

function mapArtifactBlobRow(row: SQLiteArtifactBlobRow): WorkbenchArtifactBlobRecord {
  return {
    blobId: row.blob_id,
    byteLength: row.byte_length,
    createdAt: row.created_at,
    previewText: row.preview_text,
    relativePath: row.relative_path
  };
}

function mostRecentTimestamp(current: string, batch: EntityWriteBatch): string {
  const timestamps = [
    current,
    ...(batch.sessions ?? []).map((session) => session.lastUpdatedAt ?? session.startedAt ?? ""),
    ...(batch.events ?? []).map((event) => event.timestamp ?? ""),
    ...(batch.messages ?? []).map((message) => message.timestamp ?? ""),
    ...(batch.toolCalls ?? []).map((toolCall) => toolCall.startedAt ?? toolCall.endedAt ?? ""),
    batch.overviewRollup?.latestActivityAt ?? "",
    ...(batch.projectRollups ?? []).map((rollup) => rollup.latestActivityAt ?? ""),
    ...(batch.sessionRollups ?? []).map((rollup) => rollup.latestActivityAt ?? "")
  ].filter((value) => value.length > 0);

  return timestamps.sort().at(-1) ?? current;
}

function parseJson<TValue>(json: string): TValue {
  return JSON.parse(json) as TValue;
}

function sourceEventIdFromValue(source: unknown): string | null {
  if (!source || typeof source !== "object") {
    return null;
  }

  const candidate = source as {
    eventId?: unknown;
    rawEvent?: { eventId?: unknown };
  };

  if (typeof candidate.eventId === "string" && candidate.eventId.length > 0) {
    return candidate.eventId;
  }

  if (typeof candidate.rawEvent?.eventId === "string" && candidate.rawEvent.eventId.length > 0) {
    return candidate.rawEvent.eventId;
  }

  return null;
}
