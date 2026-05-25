import { randomUUID } from "node:crypto";

import type { NormalizedCacheRecord } from "../core/cache/file-backed-cache-store.js";
import { NormalizedCacheRecordEntityImporter } from "../core/store/index.js";
import type { SessionMessage } from "../core/model/entities.js";
import type { WorkbenchRuntime } from "./workbench-runtime.js";
import { buildRecordDerivedSessions, sanitizeText } from "./triage-view-model-service.js";

export async function syncAllLatestCacheRecordsToEntityStore(
  runtime: WorkbenchRuntime
): Promise<void> {
  const records = await runtime.cacheStore.listLatestRecords();

  for (const record of records) {
    await syncCacheRecordToEntityStore(runtime, record);
  }
}

export async function syncLatestSourceCacheRecordToEntityStore(
  runtime: WorkbenchRuntime,
  sourceId: string
): Promise<void> {
  const [records, source, sources] = await Promise.all([
    runtime.cacheStore.listLatestRecords(),
    runtime.sourceRegistry.getSource(sourceId),
    runtime.sourceRegistry.listSources()
  ]);
  const record = records.find((candidate) => {
    if (source?.cache.cacheKey && candidate.cacheKey === source.cache.cacheKey) {
      return true;
    }

    return candidate.sourceId === sourceId;
  });

  if (!record) {
    return;
  }

  const matchedSource =
    source ??
    sources.find((candidate) => candidate.cache.cacheKey === record.cacheKey) ??
    (() => {
      const sameAdapter = sources.filter((candidate) => candidate.adapterId === record.adapterId);
      return sameAdapter.length === 1 ? sameAdapter[0] : undefined;
    })();

  await syncCacheRecordToEntityStore(runtime, record, matchedSource?.sourceId ?? sourceId);
}

export async function syncCacheRecordToEntityStore(
  runtime: WorkbenchRuntime,
  record: NormalizedCacheRecord,
  targetSourceId?: string
): Promise<void> {
  const importer = new NormalizedCacheRecordEntityImporter({
    store: runtime.entityStore
  });
  const prepared = prepareCacheRecordForEntityStore(record, targetSourceId);

  await importer.importRecord(prepared, {
    ingestRunId: buildEntityStoreImportRunId(prepared),
    publishAt: record.updatedAt
  });
}

function prepareCacheRecordForEntityStore(
  record: NormalizedCacheRecord,
  targetSourceId?: string
): NormalizedCacheRecord {
  const sourceId = targetSourceId ?? record.sourceId;
  const messagesBySessionId = groupMessagesBySessionId(record.normalized.messages);
  const derivedSessions = buildRecordDerivedSessions(record);
  const derivedSessionBySessionId = new Map(
    derivedSessions.map((session) => [session.sessionId, session] as const)
  );
  const verificationBySessionId = new Map(
    derivedSessions.map((session) => [session.sessionId, session.verification] as const)
  );
  const runAuditBySessionId = new Map(
    derivedSessions.map((session) => [session.sessionId, session.audit] as const)
  );

  return {
    ...record,
    sourceId,
    normalized: {
      ...record.normalized,
      projects: record.normalized.projects.map((project) => ({
        ...project,
        sourceId
      })),
      sessions: record.normalized.sessions.map((session) => {
        const derivedSession = derivedSessionBySessionId.get(session.id);
        const verification = verificationBySessionId.get(session.id);
        const runAudit = runAuditBySessionId.get(session.id);
        const modelNames = unique(
          (messagesBySessionId.get(session.id) ?? [])
            .map((message) => message.modelName)
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map((value) => sanitizeText(value))
        );

        return {
          ...session,
          sourceId,
          ...(runAudit?.attentionReasons
            ? { attentionReasons: runAudit.attentionReasons }
            : session.attentionReasons
              ? { attentionReasons: session.attentionReasons }
              : {}),
          ...(derivedSession?.shellCommands
            ? { parsedShellCommands: derivedSession.shellCommands }
            : session.parsedShellCommands
              ? { parsedShellCommands: session.parsedShellCommands }
              : {}),
          ...(verification
            ? { verification }
            : {}),
          ...(runAudit
            ? { runAudit }
            : {}),
          ...(modelNames.length > 0
            ? {
                metadata: {
                  ...(session.metadata ?? {}),
                  modelNames
                }
              }
            : session.metadata
              ? { metadata: session.metadata }
              : {})
        };
      }),
      events: record.normalized.events.map((event) => ({
        ...event,
        sourceId
      })),
      messages: record.normalized.messages.map((message) => ({
        ...message,
        sourceId
      })),
      toolCalls: record.normalized.toolCalls.map((toolCall) => ({
        ...toolCall,
        sourceId
      })),
      shellCommands: record.normalized.shellCommands.map((shellCommand) => ({
        ...shellCommand,
        sourceId
      })),
      outputArtifacts: record.normalized.outputArtifacts.map((artifact) => ({
        ...artifact,
        sourceId
      })),
      fileMutations: record.normalized.fileMutations.map((fileMutation) => ({
        ...fileMutation,
        sourceId
      })),
      diagnostics: (record.normalized.diagnostics ?? []).map((diagnostic) => ({
        ...diagnostic,
        sourceId
      }))
    },
    runAudits: {
      sessions: derivedSessions
        .filter(
          (
            session
          ): session is typeof session & { audit: NonNullable<typeof session.audit> } =>
            Boolean(session.audit)
        )
        .map((session) => ({
          sessionId: session.sessionId,
          audit: session.audit
        }))
    },
    verificationResults: {
      sessions: derivedSessions
        .filter(
          (
            session
          ): session is typeof session & {
            verification: NonNullable<typeof session.verification>;
          } => Boolean(session.verification)
        )
        .map((session) => ({
          sessionId: session.sessionId,
          verification: session.verification
        }))
    },
    ...(record.diagnostics
      ? {
          diagnostics: {
            entries: record.diagnostics.entries.map((diagnostic) => ({
              ...diagnostic,
              sourceId
            }))
          }
        }
      : {}),
    ...(record.rawArtifactIndex
      ? {
          rawArtifactIndex: {
            ...record.rawArtifactIndex,
            entries: record.rawArtifactIndex.entries.map((entry) => ({
              ...entry,
              sourceId
            }))
          }
        }
      : {})
  };
}

function buildEntityStoreImportRunId(record: NormalizedCacheRecord): string {
  return `cache-import-${record.sourceId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function groupMessagesBySessionId(messages: SessionMessage[]): Map<string, SessionMessage[]> {
  const grouped = new Map<string, SessionMessage[]>();

  for (const message of messages) {
    const current = grouped.get(message.sessionId) ?? [];

    current.push(message);
    grouped.set(message.sessionId, current);
  }

  return grouped;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
