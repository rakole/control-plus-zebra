import type { NormalizedCacheRecord } from "../cache/file-backed-cache-store.js";
import { DEFAULT_BOUNDED_INGESTION_LIMITS } from "../ingestion/bounded-ingestion.js";
import type { OutputArtifact, Project, Session } from "../model/entities.js";
import type { RawArtifactId } from "../model/identifiers.js";
import type { EntityWriteBatch, EntityWriter } from "./entity-writer.js";
import type {
  WorkbenchEntityStore,
  WorkbenchProjectRollup,
  WorkbenchRawArtifactMetadataRecord,
  WorkbenchSessionRollup
} from "./workbench-entity-store.js";

export interface NormalizedCacheRecordEntityImporterOptions {
  maxBatchSize?: number;
  store: WorkbenchEntityStore & EntityWriter;
}

export interface ImportNormalizedCacheRecordOptions {
  ingestRunId?: string;
  publishAt?: string;
}

export class NormalizedCacheRecordEntityImporter {
  readonly #maxBatchSize: number;
  readonly #store: WorkbenchEntityStore & EntityWriter;

  constructor(options: NormalizedCacheRecordEntityImporterOptions) {
    this.#maxBatchSize = options.maxBatchSize ?? DEFAULT_BOUNDED_INGESTION_LIMITS.maxEntityBatchSize;
    this.#store = options.store;
  }

  async importRecord(
    record: NormalizedCacheRecord,
    options: ImportNormalizedCacheRecordOptions = {}
  ): Promise<{ ingestRunId: string }> {
    const ingestRunId = options.ingestRunId ?? `cache-import-${record.cacheKey}`;
    const startedAt = record.createdAt || record.updatedAt;

    await this.#store.beginIngestRun({
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      ingestRunId,
      startedAt
    });

    await this.#writeChunked(ingestRunId, record.adapterId, record.sourceId, "projects", record.normalized.projects);
    await this.#writeChunked(ingestRunId, record.adapterId, record.sourceId, "sessions", record.normalized.sessions);
    await this.#writeChunked(ingestRunId, record.adapterId, record.sourceId, "events", record.normalized.events);
    await this.#writeChunked(ingestRunId, record.adapterId, record.sourceId, "messages", record.normalized.messages);
    await this.#writeChunked(ingestRunId, record.adapterId, record.sourceId, "toolCalls", record.normalized.toolCalls);
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "shellCommands",
      record.normalized.shellCommands
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "outputArtifacts",
      record.normalized.outputArtifacts
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "fileMutations",
      record.normalized.fileMutations
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "diagnostics",
      record.diagnostics?.entries ?? record.normalized.diagnostics ?? []
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "verificationSnapshots",
      (record.verificationResults?.sessions ?? []).map((entry) => ({
        sessionId: entry.sessionId,
        verification: entry.verification
      }))
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "runAuditSnapshots",
      (record.runAudits?.sessions ?? []).map((entry) => ({
        sessionId: entry.sessionId,
        audit: entry.audit
      }))
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "gitSnapshots",
      (record.gitSnapshots?.projects ?? []).map((entry) => ({
        projectId: entry.projectId,
        git: entry.git
      }))
    );
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "githubSnapshots",
      (record.githubSnapshots?.projects ?? []).map((entry) => ({
        projectId: entry.projectId,
        github: entry.github
      }))
    );

    const rawArtifactMetadata = buildRawArtifactMetadata(record);
    await this.#writeChunked(
      ingestRunId,
      record.adapterId,
      record.sourceId,
      "rawArtifacts",
      rawArtifactMetadata
    );

    const projectRollups = buildProjectRollups(record, rawArtifactMetadata);
    const sessionRollups = buildSessionRollups(record, rawArtifactMetadata);
    const latestActivityAt = maxIsoTimestamp(
      record.normalized.sessions.map((session) => session.lastUpdatedAt ?? session.startedAt)
    );

    await this.#store.writeBatch({
      ingestRunId,
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      overviewRollup: {
        sourceId: record.sourceId,
        needsAttentionCount: 0,
        projectCount: record.normalized.projects.length,
        sessionCount: record.normalized.sessions.length,
        ...(latestActivityAt ? { latestActivityAt } : {})
      },
      projectRollups,
      sessionRollups
    });

    await this.#store.markLifecycle({
      kind: "source-complete",
      ingestRunId,
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      occurredAt: record.updatedAt
    });

    if (options.publishAt) {
      await this.#store.publishIngestRun({
        ingestRunId,
        sourceId: record.sourceId,
        publishedAt: options.publishAt
      });
    }

    return { ingestRunId };
  }

  async #writeChunked<TItem>(
    ingestRunId: string,
    adapterId: string,
    sourceId: string,
    key: keyof EntityWriteBatch,
    items: TItem[]
  ): Promise<void> {
    for (const chunk of chunkItems(items, this.#maxBatchSize)) {
      await this.#store.writeBatch({
        ingestRunId,
        adapterId,
        sourceId,
        [key]: chunk
      } as EntityWriteBatch);
    }
  }
}

function chunkItems<TItem>(items: TItem[], chunkSize: number): TItem[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: TItem[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildRawArtifactMetadata(record: NormalizedCacheRecord): WorkbenchRawArtifactMetadataRecord[] {
  const sessionByRawArtifactId = new Map<RawArtifactId, string>();
  const outputArtifactByRawArtifactId = new Map<RawArtifactId, string>();

  for (const session of record.normalized.sessions) {
    for (const rawArtifactRef of session.rawArtifactRefs ?? []) {
      sessionByRawArtifactId.set(rawArtifactRef.id, session.id);
    }
  }

  for (const outputArtifact of record.normalized.outputArtifacts) {
    const rawArtifactId = outputArtifact.ref?.id;

    if (rawArtifactId) {
      outputArtifactByRawArtifactId.set(rawArtifactId, outputArtifact.id);
    }
  }

  return (record.rawArtifactIndex?.entries ?? []).map((entry) => ({
    artifactId: entry.id,
    sourceId: entry.sourceId,
    status: "available",
    entry,
    ...(sessionByRawArtifactId.get(entry.id)
      ? { sessionId: sessionByRawArtifactId.get(entry.id)! }
      : {}),
    ...(outputArtifactByRawArtifactId.get(entry.id)
      ? { outputArtifactId: outputArtifactByRawArtifactId.get(entry.id)! }
      : {})
  }));
}

function buildProjectRollups(
  record: NormalizedCacheRecord,
  rawArtifacts: WorkbenchRawArtifactMetadataRecord[]
): WorkbenchProjectRollup[] {
  const gitByProjectId = new Map((record.gitSnapshots?.projects ?? []).map((entry) => [entry.projectId, entry.git]));
  const githubByProjectId = new Map(
    (record.githubSnapshots?.projects ?? []).map((entry) => [entry.projectId, entry.github])
  );
  const sessionsByProjectId = groupBy(record.normalized.sessions.filter(hasProjectId), (session) => session.projectId);

  return record.normalized.projects.map((project) => {
    const sessions = sessionsByProjectId.get(project.id) ?? [];
    const rawArtifactCount = rawArtifacts.filter((artifact) => {
      const sessionId = artifact.sessionId;
      return sessionId ? sessions.some((session) => session.id === sessionId) : false;
    }).length;
    const latestSession = sessions
      .slice()
      .sort((left, right) => (right.lastUpdatedAt ?? "").localeCompare(left.lastUpdatedAt ?? ""))[0];
    const latestActivityAt =
      latestSession?.lastUpdatedAt ??
      latestSession?.startedAt ??
      project.latestActivityAt;
    const git = gitByProjectId.get(project.id);
    const github = githubByProjectId.get(project.id);

    return {
      sourceId: record.sourceId,
      project,
      projectId: project.id,
      latestSessionId: latestSession?.id ?? sessions[0]?.id ?? "",
      sessionIds: sessions.map((session) => session.id),
      rawArtifactCount,
      ...(latestActivityAt ? { latestActivityAt } : {}),
      ...(git ? { git } : {}),
      ...(github ? { github } : {})
    };
  });
}

function buildSessionRollups(
  record: NormalizedCacheRecord,
  rawArtifacts: WorkbenchRawArtifactMetadataRecord[]
): WorkbenchSessionRollup[] {
  const diagnosticsBySessionId = new Map<string, number>();
  const verificationBySessionId = new Map(
    (record.verificationResults?.sessions ?? []).map((entry) => [entry.sessionId, entry.verification])
  );
  const runAuditBySessionId = new Map(
    (record.runAudits?.sessions ?? []).map((entry) => [entry.sessionId, entry.audit])
  );

  for (const diagnostic of record.diagnostics?.entries ?? record.normalized.diagnostics ?? []) {
    for (const relatedEntityId of diagnostic.relatedEntityIds ?? []) {
      diagnosticsBySessionId.set(relatedEntityId, (diagnosticsBySessionId.get(relatedEntityId) ?? 0) + 1);
    }
  }

  return record.normalized.sessions.map((session) => {
    const latestActivityAt = session.lastUpdatedAt ?? session.startedAt;
    const verification = verificationBySessionId.get(session.id);
    const runAudit = runAuditBySessionId.get(session.id);

    return {
      sourceId: record.sourceId,
      sessionId: session.id,
      session,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      diagnosticCount: diagnosticsBySessionId.get(session.id) ?? 0,
      rawArtifactCount: rawArtifacts.filter((artifact) => artifact.sessionId === session.id).length,
      ...(latestActivityAt ? { latestActivityAt } : {}),
      ...(verification ? { verification } : {}),
      ...(runAudit ? { runAudit } : {})
    };
  });
}

function groupBy<TItem, TKey>(items: TItem[], selectKey: (item: TItem) => TKey): Map<TKey, TItem[]> {
  const map = new Map<TKey, TItem[]>();

  for (const item of items) {
    const key = selectKey(item);
    const current = map.get(key) ?? [];

    current.push(item);
    map.set(key, current);
  }

  return map;
}

function hasProjectId(session: Session): session is Session & { projectId: string } {
  return typeof session.projectId === "string" && session.projectId.length > 0;
}

function maxIsoTimestamp(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).sort().at(-1);
}
