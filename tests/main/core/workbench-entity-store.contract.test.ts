import { describe, expect, it } from "vitest";

import type { EntityWriteBatch, EntityWriter, EntityWriterLifecycleMarker } from "../../../src/main/core/store/entity-writer.js";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  PaginationValidationError,
  validatePageLimit,
} from "../../../src/main/core/store/pagination.js";
import type {
  BeginWorkbenchIngestRunInput,
  IngestRunId,
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
  WorkbenchIngestRun,
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
  WorkbenchTimelineRecord
} from "../../../src/main/core/store/workbench-entity-store.js";
import type { Diagnostic } from "../../../src/main/core/diagnostics/diagnostic.js";
import { createConfidenceScore } from "../../../src/main/core/model/confidence.js";
import type {
  Project,
  Session,
  SessionEvent
} from "../../../src/main/core/model/entities.js";
import type { ProjectGitSnapshot } from "../../../src/main/core/git/git-snapshot-provider.js";
import type { ProjectGitHubSnapshot } from "../../../src/main/core/github/github-snapshot-provider.js";
import type { RunAuditResult } from "../../../src/main/core/audit/types.js";
import type { VerificationResult } from "../../../src/main/core/verification/types.js";

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 100;
const ADAPTER_ID = "fake-test";
const SOURCE_ID = "source_1";

describe("WorkbenchEntityStore contract", () => {
  it("supports opaque keyset pagination for session and timeline reads", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const run = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-1",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await writer.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [
        createSession("session-3", "2026-05-25T09:03:00.000Z"),
        createSession("session-2", "2026-05-25T09:02:00.000Z"),
        createSession("session-1", "2026-05-25T09:01:00.000Z")
      ],
      events: [
        createTimelineEvent("event-1", "session-3", "0001"),
        createTimelineEvent("event-2", "session-3", "0002"),
        createTimelineEvent("event-3", "session-3", "0003")
      ]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:04:00.000Z"
    });

    const firstPage = await store.listSessionsPage({
      sourceId: SOURCE_ID,
      limit: 2
    });
    const secondPage = await store.listSessionsPage({
      sourceId: SOURCE_ID,
      limit: 2,
      ...(firstPage.pageInfo.nextCursor ? { cursor: firstPage.pageInfo.nextCursor } : {})
    });

    expect(firstPage.items.map((item) => item.session.id)).toEqual(["session-3", "session-2"]);
    expect(decodeOpaqueCursor<WorkbenchSessionCursorKey>(firstPage.pageInfo.nextCursor ?? "")).toEqual({
      lastUpdatedAt: "2026-05-25T09:02:00.000Z",
      sessionId: "session-2"
    });
    expect(secondPage.items.map((item) => item.session.id)).toEqual(["session-1"]);
    expect(secondPage.pageInfo.hasMore).toBe(false);

    const firstTimelinePage = await store.getSessionTimelinePage({
      sourceId: SOURCE_ID,
      sessionId: "session-3",
      limit: 2
    });
    const secondTimelinePage = await store.getSessionTimelinePage({
      sourceId: SOURCE_ID,
      sessionId: "session-3",
      limit: 2,
      ...(firstTimelinePage.pageInfo.nextCursor
        ? { cursor: firstTimelinePage.pageInfo.nextCursor }
        : {})
    });

    expect(firstTimelinePage.items.map((item) => item.event.id)).toEqual(["event-1", "event-2"]);
    expect(decodeOpaqueCursor<WorkbenchTimelineCursorKey>(firstTimelinePage.pageInfo.nextCursor ?? "")).toEqual({
      eventId: "event-2",
      orderKey: "0002"
    });
    expect(secondTimelinePage.items.map((item) => item.event.id)).toEqual(["event-3"]);
  });

  it("rejects invalid cursors with a typed sanitized error", () => {
    expect(() => decodeOpaqueCursor("not-a-real-cursor")).toThrowError(PaginationValidationError);

    try {
      decodeOpaqueCursor("not-a-real-cursor");
      throw new Error("Expected invalid cursor.");
    } catch (error) {
      expect(error).toBeInstanceOf(PaginationValidationError);
      expect((error as PaginationValidationError).code).toBe("invalid-cursor");
      expect((error as PaginationValidationError).message).toBe("The pagination cursor is invalid.");
      expect((error as PaginationValidationError).message.includes("not-a-real-cursor")).toBe(false);
    }

    expect(() => validatePageLimit(0, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT })).toThrowError(
      PaginationValidationError
    );
  });

  it("rejects stale but well-formed cursors instead of returning a silent empty page", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const run = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-cursor",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await writer.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [createSession("session-1", "2026-05-25T09:01:00.000Z")],
      events: [createTimelineEvent("event-1", "session-1", "0001")]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });

    await expect(
      store.listSessionsPage({
        sourceId: SOURCE_ID,
        cursor: encodeOpaqueCursor<WorkbenchSessionCursorKey>({
          lastUpdatedAt: "2026-05-25T08:59:00.000Z",
          sessionId: "missing-session"
        })
      })
    ).rejects.toMatchObject({
      code: "invalid-cursor",
      message: "The pagination cursor is invalid."
    });
    await expect(
      store.getSessionTimelinePage({
        sourceId: SOURCE_ID,
        sessionId: "session-1",
        cursor: encodeOpaqueCursor<WorkbenchTimelineCursorKey>({
          eventId: "missing-event",
          orderKey: "0000"
        })
      })
    ).rejects.toMatchObject({
      code: "invalid-cursor",
      message: "The pagination cursor is invalid."
    });
  });

  it("publishes staged runs atomically and keeps reads scoped to the current run", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const run1 = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-1",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await writer.writeBatch({
      ingestRunId: run1.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [createSession("session-old", "2026-05-25T09:01:00.000Z")]
    });
    await store.publishIngestRun({
      ingestRunId: run1.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });

    const run2 = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-2",
      startedAt: "2026-05-25T09:03:00.000Z"
    });

    await writer.writeBatch({
      ingestRunId: run2.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [createSession("session-new", "2026-05-25T09:04:00.000Z")]
    });

    expect((await store.listSessionsPage({ sourceId: SOURCE_ID, limit: 10 })).items.map((item) => item.session.id)).toEqual([
      "session-old"
    ]);

    await store.publishIngestRun({
      ingestRunId: run2.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:05:00.000Z"
    });

    expect((await store.listSessionsPage({ sourceId: SOURCE_ID, limit: 10 })).items.map((item) => item.session.id)).toEqual([
      "session-new"
    ]);
    expect(await store.getCurrentIngestRun({ sourceId: SOURCE_ID })).toMatchObject({
      ingestRunId: "run-2",
      status: "published"
    });
  });

  it("rejects writes, lifecycle markers, and publishes when the ingest-run scope does not match", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const run = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-scoped",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await expect(
      writer.writeBatch({
        ingestRunId: run.ingestRunId,
        adapterId: "other-adapter",
        sourceId: SOURCE_ID,
        sessions: []
      })
    ).rejects.toThrow("does not match");
    await expect(
      writer.writeBatch({
        ingestRunId: run.ingestRunId,
        adapterId: ADAPTER_ID,
        sourceId: "source_other",
        sessions: []
      })
    ).rejects.toThrow("does not match");
    await expect(
      writer.markLifecycle({
        kind: "source-complete",
        ingestRunId: run.ingestRunId,
        adapterId: ADAPTER_ID,
        sourceId: "source_other",
        occurredAt: "2026-05-25T09:01:00.000Z"
      })
    ).rejects.toThrow("does not match");
    await expect(
      store.publishIngestRun({
        ingestRunId: run.ingestRunId,
        sourceId: "source_other",
        publishedAt: "2026-05-25T09:02:00.000Z"
      })
    ).rejects.toThrow("does not match");
    await expect(store.getCurrentIngestRun({ sourceId: SOURCE_ID })).resolves.toBeUndefined();
  });

  it("cleans up stale unpublished runs without deleting the current published run", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const currentRun = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-current",
      startedAt: "2026-05-25T09:00:00.000Z"
    });
    const staleRun = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-stale",
      startedAt: "2026-05-25T08:00:00.000Z"
    });

    await writer.writeBatch({
      ingestRunId: currentRun.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [createSession("session-current", "2026-05-25T09:01:00.000Z")]
    });
    await writer.writeBatch({
      ingestRunId: staleRun.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [createSession("session-stale", "2026-05-25T08:01:00.000Z")]
    });
    await writer.markLifecycle({
      kind: "source-complete",
      ingestRunId: staleRun.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      occurredAt: "2026-05-25T08:30:00.000Z"
    });
    await store.publishIngestRun({
      ingestRunId: currentRun.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });

    const result = await store.cleanupStaleRuns({
      beforeUpdatedAt: "2026-05-25T08:59:59.000Z"
    });

    expect(result).toEqual({
      removedCount: 1,
      removedIngestRunIds: ["run-stale"]
    });
    expect(await store.getIngestRun("run-stale")).toBeUndefined();
    expect(await store.getCurrentIngestRun({ sourceId: SOURCE_ID })).toMatchObject({
      ingestRunId: "run-current"
    });
  });

  it("returns overview, project, and session rollups in the stored query shape", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const run = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-rollups",
      startedAt: "2026-05-25T09:00:00.000Z"
    });
    const project = createProject("project-1");

    await writer.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [createSession("session-1", "2026-05-25T09:01:00.000Z", project.id)],
      overviewRollup: {
        sourceId: SOURCE_ID,
        latestActivityAt: "2026-05-25T09:01:00.000Z",
        needsAttentionCount: 1,
        projectCount: 1,
        sessionCount: 1
      },
      projectRollups: [{
        sourceId: SOURCE_ID,
        project,
        projectId: project.id,
        latestActivityAt: "2026-05-25T09:01:00.000Z",
        latestSessionId: "session-1",
        sessionIds: ["session-1"],
        rawArtifactCount: 2
      }],
      sessionRollups: [{
        sourceId: SOURCE_ID,
        sessionId: "session-1",
        session: createSession("session-1", "2026-05-25T09:01:00.000Z", project.id),
        projectId: project.id,
        latestActivityAt: "2026-05-25T09:01:00.000Z",
        diagnosticCount: 3,
        rawArtifactCount: 2
      }]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:02:00.000Z"
    });

    expect(await store.getOverviewRollup({ sourceId: SOURCE_ID })).toEqual({
      sourceId: SOURCE_ID,
      latestActivityAt: "2026-05-25T09:01:00.000Z",
      needsAttentionCount: 1,
      projectCount: 1,
      sessionCount: 1
    });
    expect(await store.listProjectRollups({ sourceId: SOURCE_ID })).toEqual([{
      sourceId: SOURCE_ID,
      project,
      projectId: project.id,
      latestActivityAt: "2026-05-25T09:01:00.000Z",
      latestSessionId: "session-1",
      sessionIds: ["session-1"],
      rawArtifactCount: 2
    }]);
    expect(await store.getSessionRollup({ sourceId: SOURCE_ID, sessionId: "session-1" })).toEqual({
      sourceId: SOURCE_ID,
      sessionId: "session-1",
      session: createSession("session-1", "2026-05-25T09:01:00.000Z", project.id),
      projectId: project.id,
      latestActivityAt: "2026-05-25T09:01:00.000Z",
      diagnosticCount: 3,
      rawArtifactCount: 2
    });
  });

  it("preserves Unknown, Unsupported, No Matching PR, Not Run, and Missing states exactly", async () => {
    const store = new FakeWorkbenchEntityStore();
    const writer: EntityWriter = store;
    const run = await store.beginIngestRun({
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      ingestRunId: "run-truth",
      startedAt: "2026-05-25T09:00:00.000Z"
    });

    await writer.writeBatch({
      ingestRunId: run.ingestRunId,
      adapterId: ADAPTER_ID,
      sourceId: SOURCE_ID,
      sessions: [
        createSession("session-not-run", "2026-05-25T09:01:00.000Z", "project-1"),
        createSession("session-unsupported", "2026-05-25T09:02:00.000Z", "project-1")
      ],
      verificationSnapshots: [
        {
          sessionId: "session-not-run",
          verification: createVerification("not-run")
        },
        {
          sessionId: "session-unsupported",
          verification: createVerification("unsupported")
        }
      ],
      runAuditSnapshots: [{
        sessionId: "session-not-run",
        audit: createRunAudit("unknown")
      }],
      gitSnapshots: [{
        projectId: "project-1",
        git: createGitSnapshot("unknown")
      }],
      githubSnapshots: [{
        projectId: "project-1",
        github: createGitHubSnapshot("no-matching-pr")
      }],
      rawArtifacts: [{
        artifactId: "raw-missing",
        sourceId: SOURCE_ID,
        sessionId: "session-not-run",
        status: "missing",
        reason: "Missing raw artifact content."
      }]
    });
    await store.publishIngestRun({
      ingestRunId: run.ingestRunId,
      sourceId: SOURCE_ID,
      publishedAt: "2026-05-25T09:03:00.000Z"
    });

    expect(await store.getSessionVerificationSnapshot({ sourceId: SOURCE_ID, sessionId: "session-not-run" })).toEqual({
      sessionId: "session-not-run",
      verification: createVerification("not-run")
    });
    expect(await store.getSessionVerificationSnapshot({ sourceId: SOURCE_ID, sessionId: "session-unsupported" })).toEqual({
      sessionId: "session-unsupported",
      verification: createVerification("unsupported")
    });
    expect(await store.getSessionRunAuditSnapshot({ sourceId: SOURCE_ID, sessionId: "session-not-run" })).toEqual({
      sessionId: "session-not-run",
      audit: createRunAudit("unknown")
    });
    expect(await store.getProjectGitSnapshot({ sourceId: SOURCE_ID, projectId: "project-1" })).toEqual({
      projectId: "project-1",
      git: createGitSnapshot("unknown")
    });
    expect(await store.getProjectGitHubSnapshot({ sourceId: SOURCE_ID, projectId: "project-1" })).toEqual({
      projectId: "project-1",
      github: createGitHubSnapshot("no-matching-pr")
    });
    expect(await store.getRawArtifactMetadata({ sourceId: SOURCE_ID, artifactId: "raw-missing" })).toEqual({
      artifactId: "raw-missing",
      sourceId: SOURCE_ID,
      sessionId: "session-not-run",
      status: "missing",
      reason: "Missing raw artifact content."
    });
  });
});

class FakeWorkbenchEntityStore implements WorkbenchEntityStore, EntityWriter {
  readonly #runs = new Map<IngestRunId, FakeRunState>();
  readonly #currentRunBySourceId = new Map<string, IngestRunId>();

  async beginIngestRun(input: BeginWorkbenchIngestRunInput): Promise<WorkbenchIngestRun> {
    const run: WorkbenchIngestRun = {
      ingestRunId: input.ingestRunId ?? `run-${this.#runs.size + 1}`,
      adapterId: input.adapterId,
      sourceId: input.sourceId,
      status: "staging",
      startedAt: input.startedAt,
      updatedAt: input.startedAt
    };

    this.#runs.set(run.ingestRunId, createEmptyRunState(run));
    return run;
  }

  async cleanupStaleRuns(input: WorkbenchCleanupStaleRunsInput): Promise<WorkbenchCleanupStaleRunsResult> {
    const removableRuns = [...this.#runs.values()]
      .filter((state) => !input.sourceId || state.run.sourceId === input.sourceId)
      .filter((state) => state.run.updatedAt < input.beforeUpdatedAt)
      .filter((state) => {
        const isCurrent = this.#currentRunBySourceId.get(state.run.sourceId) === state.run.ingestRunId;
        const preservePublished = input.preservePublished ?? true;

        if (isCurrent) {
          return false;
        }

        return !(preservePublished && state.run.status === "published");
      })
      .slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);

    for (const state of removableRuns) {
      this.#runs.delete(state.run.ingestRunId);
    }

    return {
      removedCount: removableRuns.length,
      removedIngestRunIds: removableRuns.map((state) => state.run.ingestRunId)
    };
  }

  async getCurrentIngestRun(scope: WorkbenchCurrentRunScope): Promise<WorkbenchIngestRun | undefined> {
    const currentRunId = this.#currentRunBySourceId.get(scope.sourceId);
    return currentRunId ? this.#runs.get(currentRunId)?.run : undefined;
  }

  async getIngestRun(ingestRunId: IngestRunId): Promise<WorkbenchIngestRun | undefined> {
    return this.#runs.get(ingestRunId)?.run;
  }

  async getOverviewRollup(scope: WorkbenchCurrentRunScope): Promise<WorkbenchOverviewRollup | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.overviewRollup;
  }

  async getProjectGitHubSnapshot(
    scope: WorkbenchCurrentRunScope & { projectId: string }
  ): Promise<StoredProjectGitHubSnapshot | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.githubSnapshots.get(scope.projectId);
  }

  async getProjectGitSnapshot(
    scope: WorkbenchCurrentRunScope & { projectId: string }
  ): Promise<StoredProjectGitSnapshot | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.gitSnapshots.get(scope.projectId);
  }

  async getRawArtifactMetadata(
    scope: WorkbenchCurrentRunScope & { artifactId: string }
  ): Promise<WorkbenchRawArtifactMetadataRecord | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.rawArtifacts.get(scope.artifactId);
  }

  async getSessionRollup(
    scope: WorkbenchCurrentRunScope & { sessionId: string }
  ): Promise<WorkbenchSessionRollup | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.sessionRollups.get(scope.sessionId);
  }

  async getSessionRunAuditSnapshot(
    scope: WorkbenchCurrentRunScope & { sessionId: string }
  ): Promise<StoredSessionRunAuditSnapshot | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.runAuditSnapshots.get(scope.sessionId);
  }

  async getSessionTimelinePage(query: WorkbenchTimelinePageQuery): Promise<WorkbenchTimelinePage> {
    const limit = validatePageLimit(query.limit, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
    const run = this.#getCurrentRunState(query.sourceId);
    const items = run ? sortTimelineRecords(run.timelineBySessionId.get(query.sessionId) ?? []) : [];
    const startIndex = query.cursor
      ? findCursorStartIndex(items, query.cursor, (item) => ({
          eventId: item.event.id,
          orderKey: item.event.orderKey ?? ""
        }))
      : 0;
    const pageItems = items.slice(startIndex, startIndex + limit);
    const nextItem = pageItems.at(-1);
    const nextStartIndex = startIndex + pageItems.length;

    return {
      items: pageItems,
      pageInfo: {
        hasMore: nextStartIndex < items.length,
        limit,
        ...(nextStartIndex < items.length && nextItem
          ? {
              nextCursor: encodeOpaqueCursor<WorkbenchTimelineCursorKey>({
                eventId: nextItem.event.id,
                orderKey: nextItem.event.orderKey ?? ""
              })
            }
          : {}),
        totalCount: items.length
      }
    };
  }

  async getSessionVerificationSnapshot(
    scope: WorkbenchCurrentRunScope & { sessionId: string }
  ): Promise<StoredSessionVerificationSnapshot | undefined> {
    return this.#getCurrentRunState(scope.sourceId)?.verificationSnapshots.get(scope.sessionId);
  }

  async listDiagnostics(query: WorkbenchDiagnosticQuery): Promise<Diagnostic[]> {
    return (this.#getCurrentRunState(query.sourceId)?.diagnostics ?? []).filter((diagnostic) => {
      if (query.scope && diagnostic.scope !== query.scope) {
        return false;
      }

      if (query.severity && diagnostic.severity !== query.severity) {
        return false;
      }

      if (query.relatedEntityId && !diagnostic.relatedEntityIds?.includes(query.relatedEntityId)) {
        return false;
      }

      if (query.sessionId && !diagnostic.relatedEntityIds?.includes(query.sessionId)) {
        return false;
      }

      if (query.projectId && !diagnostic.relatedEntityIds?.includes(query.projectId)) {
        return false;
      }

      return true;
    });
  }

  async listProjectRollups(scope: WorkbenchCurrentRunScope): Promise<WorkbenchProjectRollup[]> {
    return this.#getCurrentRunState(scope.sourceId)?.projectRollups ?? [];
  }

  async listSessionsPage(query: WorkbenchSessionPageQuery): Promise<WorkbenchSessionPage> {
    const limit = validatePageLimit(query.limit, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
    const run = this.#getCurrentRunState(query.sourceId);
    const rows = run
      ? sortSessionRecords(
          run.sessions
            .filter((session) => !query.adapterId || session.adapterId === query.adapterId)
            .filter((session) => !query.projectId || session.projectId === query.projectId)
            .map((session) => this.#toSessionRecord(run, session))
        )
      : [];
    const startIndex = query.cursor
      ? findCursorStartIndex(rows, query.cursor, (item) => ({
          lastUpdatedAt: item.session.lastUpdatedAt ?? "",
          sessionId: item.session.id
        }))
      : 0;
    const pageItems = rows.slice(startIndex, startIndex + limit);
    const nextItem = pageItems.at(-1);
    const nextStartIndex = startIndex + pageItems.length;

    return {
      items: pageItems,
      pageInfo: {
        hasMore: nextStartIndex < rows.length,
        limit,
        ...(nextStartIndex < rows.length && nextItem
          ? {
              nextCursor: encodeOpaqueCursor<WorkbenchSessionCursorKey>({
                lastUpdatedAt: nextItem.session.lastUpdatedAt ?? "",
                sessionId: nextItem.session.id
              })
            }
          : {}),
        totalCount: rows.length
      }
    };
  }

  async markLifecycle(marker: EntityWriterLifecycleMarker): Promise<void> {
    const run = this.#requireRunForScope(marker);

    run.run.updatedAt = marker.occurredAt;
  }

  async publishIngestRun(input: PublishWorkbenchIngestRunInput): Promise<WorkbenchIngestRun> {
    const run = this.#requireRunForScope(input);
    const previousCurrentRunId = this.#currentRunBySourceId.get(input.sourceId);

    run.run.status = "published";
    run.run.publishedAt = input.publishedAt;
    run.run.updatedAt = input.publishedAt;
    if (previousCurrentRunId && previousCurrentRunId !== input.ingestRunId) {
      run.run.replacedIngestRunId = previousCurrentRunId;
    }

    this.#currentRunBySourceId.set(input.sourceId, input.ingestRunId);

    return run.run;
  }

  async writeBatch(batch: EntityWriteBatch): Promise<void> {
    const run = this.#requireRunForScope(batch);

    if (batch.projects) {
      run.projects.push(...batch.projects);
    }

    if (batch.sessions) {
      run.sessions.push(...batch.sessions);
    }

    if (batch.events) {
      for (const event of batch.events) {
        run.events.push(event);
        const timeline = run.timelineBySessionId.get(event.sessionId) ?? [];

        timeline.push({ event });
        run.timelineBySessionId.set(event.sessionId, timeline);
      }
    }

    if (batch.diagnostics) {
      run.diagnostics.push(...batch.diagnostics);
    }

    if (batch.verificationSnapshots) {
      for (const snapshot of batch.verificationSnapshots) {
        run.verificationSnapshots.set(snapshot.sessionId, snapshot);
      }
    }

    if (batch.runAuditSnapshots) {
      for (const snapshot of batch.runAuditSnapshots) {
        run.runAuditSnapshots.set(snapshot.sessionId, snapshot);
      }
    }

    if (batch.gitSnapshots) {
      for (const snapshot of batch.gitSnapshots) {
        run.gitSnapshots.set(snapshot.projectId, snapshot);
      }
    }

    if (batch.githubSnapshots) {
      for (const snapshot of batch.githubSnapshots) {
        run.githubSnapshots.set(snapshot.projectId, snapshot);
      }
    }

    if (batch.rawArtifacts) {
      for (const artifact of batch.rawArtifacts) {
        run.rawArtifacts.set(artifact.artifactId, artifact);
      }
    }

    if (batch.overviewRollup) {
      run.overviewRollup = batch.overviewRollup;
    }

    if (batch.projectRollups) {
      run.projectRollups = batch.projectRollups;
    }

    if (batch.sessionRollups) {
      for (const rollup of batch.sessionRollups) {
        run.sessionRollups.set(rollup.sessionId, rollup);
      }
    }

    run.run.updatedAt = mostRecentTimestamp(run.run.updatedAt, batch);
  }

  #getCurrentRunState(sourceId: string): FakeRunState | undefined {
    const currentRunId = this.#currentRunBySourceId.get(sourceId);
    return currentRunId ? this.#runs.get(currentRunId) : undefined;
  }

  #requireRun(ingestRunId: string): FakeRunState {
    const run = this.#runs.get(ingestRunId);

    if (!run) {
      throw new Error(`Missing run ${ingestRunId}.`);
    }

    return run;
  }

  #requireRunForScope(input: {
    adapterId?: string;
    ingestRunId: string;
    sourceId: string;
  }): FakeRunState {
    const run = this.#requireRun(input.ingestRunId);

    if (
      run.run.sourceId !== input.sourceId ||
      (input.adapterId !== undefined && run.run.adapterId !== input.adapterId)
    ) {
      throw new Error("The ingest run scope does not match the requested source or adapter.");
    }

    return run;
  }

  #toSessionRecord(run: FakeRunState, session: Session): WorkbenchSessionRecord {
    const diagnosticIds = run.diagnostics
      .filter((diagnostic) => diagnostic.relatedEntityIds?.includes(session.id))
      .map((diagnostic) => diagnostic.id);
    const rawArtifactCount = [...run.rawArtifacts.values()].filter(
      (artifact) => artifact.sessionId === session.id
    ).length;

    const verification = run.verificationSnapshots.get(session.id)?.verification;
    const runAudit = run.runAuditSnapshots.get(session.id)?.audit;

    return {
      session,
      ...(verification ? { verification } : {}),
      ...(runAudit ? { runAudit } : {}),
      ...(diagnosticIds.length > 0 ? { diagnosticIds } : {}),
      rawArtifactCount
    };
  }
}

interface FakeRunState {
  run: WorkbenchIngestRun;
  diagnostics: Diagnostic[];
  events: SessionEvent[];
  gitSnapshots: Map<string, StoredProjectGitSnapshot>;
  githubSnapshots: Map<string, StoredProjectGitHubSnapshot>;
  overviewRollup?: WorkbenchOverviewRollup;
  projectRollups: WorkbenchProjectRollup[];
  projects: Project[];
  rawArtifacts: Map<string, WorkbenchRawArtifactMetadataRecord>;
  runAuditSnapshots: Map<string, StoredSessionRunAuditSnapshot>;
  sessionRollups: Map<string, WorkbenchSessionRollup>;
  sessions: Session[];
  timelineBySessionId: Map<string, WorkbenchTimelineRecord[]>;
  verificationSnapshots: Map<string, StoredSessionVerificationSnapshot>;
}

function createEmptyRunState(run: WorkbenchIngestRun): FakeRunState {
  return {
    run,
    diagnostics: [],
    events: [],
    gitSnapshots: new Map(),
    githubSnapshots: new Map(),
    projectRollups: [],
    projects: [],
    rawArtifacts: new Map(),
    runAuditSnapshots: new Map(),
    sessionRollups: new Map(),
    sessions: [],
    timelineBySessionId: new Map(),
    verificationSnapshots: new Map()
  };
}

function findCursorStartIndex<TItem, TCursor extends object>(
  items: TItem[],
  encodedCursor: string | undefined,
  selectCursor: (item: TItem) => TCursor
): number {
  const cursor = decodeOpaqueCursor<TCursor>(encodedCursor ?? "");
  const index = items.findIndex((item) => shallowCursorEquals(selectCursor(item), cursor));

  if (index < 0) {
    throw new PaginationValidationError("invalid-cursor");
  }

  return index + 1;
}

function shallowCursorEquals(left: object, right: object): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  const rightRecord = right as Record<string, unknown>;

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => rightRecord[key] === value)
  );
}

function sortSessionRecords(records: WorkbenchSessionRecord[]): WorkbenchSessionRecord[] {
  return records.slice().sort((left, right) => {
    const byUpdatedAt = (right.session.lastUpdatedAt ?? "").localeCompare(left.session.lastUpdatedAt ?? "");

    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }

    return right.session.id.localeCompare(left.session.id);
  });
}

function sortTimelineRecords(records: WorkbenchTimelineRecord[]): WorkbenchTimelineRecord[] {
  return records.slice().sort((left, right) => {
    const byOrderKey = (left.event.orderKey ?? "").localeCompare(right.event.orderKey ?? "");

    if (byOrderKey !== 0) {
      return byOrderKey;
    }

    return left.event.id.localeCompare(right.event.id);
  });
}

function mostRecentTimestamp(current: string, batch: EntityWriteBatch): string {
  const timestamps = [
    current,
    ...(batch.sessions ?? []).map((session) => session.lastUpdatedAt ?? session.startedAt ?? ""),
    ...(batch.events ?? []).map((event) => event.timestamp ?? ""),
    batch.overviewRollup?.latestActivityAt ?? "",
    ...(batch.projectRollups ?? []).map((rollup) => rollup.latestActivityAt ?? ""),
    ...(batch.sessionRollups ?? []).map((rollup) => rollup.latestActivityAt ?? "")
  ].filter((value) => value.length > 0);

  return timestamps.sort().at(-1) ?? current;
}

function createProject(projectId: string): Project {
  return {
    id: projectId,
    adapterId: ADAPTER_ID,
    sourceId: SOURCE_ID
  };
}

function createSession(sessionId: string, lastUpdatedAt: string, projectId?: string): Session {
  return {
    id: sessionId,
    adapterId: ADAPTER_ID,
    sourceId: SOURCE_ID,
    ...(projectId ? { projectId } : {}),
    startedAt: lastUpdatedAt,
    lastUpdatedAt,
    confidence: createConfidenceScore("confirmed")
  };
}

function createTimelineEvent(eventId: string, sessionId: string, orderKey: string): SessionEvent {
  return {
    id: eventId,
    adapterId: ADAPTER_ID,
    sourceId: SOURCE_ID,
    sessionId,
    kind: "message",
    orderKey,
    timestamp: `2026-05-25T09:${orderKey.slice(-2)}:00.000Z`,
    confidence: createConfidenceScore("confirmed")
  };
}

function createVerification(status: VerificationResult["status"]): VerificationResult {
  return {
    status,
    confidence: createConfidenceScore("confirmed"),
    commandIds: [],
    intentResults: [],
    reasonCodes: []
  };
}

function createRunAudit(status: RunAuditResult["status"]): RunAuditResult {
  return {
    status,
    attentionReasons: [],
    confidence: createConfidenceScore("confirmed"),
    completionClaim: "unknown",
    supportingCommandIds: [],
    supportingMessageIds: [],
    supportingToolCallIds: []
  };
}

function createGitSnapshot(status: ProjectGitSnapshot["status"]): ProjectGitSnapshot {
  return {
    status,
    rootConfidence: "unknown",
    reason: "Git state is unavailable.",
    diagnosticIds: []
  };
}

function createGitHubSnapshot(status: ProjectGitHubSnapshot["status"]): ProjectGitHubSnapshot {
  return {
    status,
    reason:
      status === "no-matching-pr"
        ? "No matching pull request was found for the current remote and branch snapshot."
        : "GitHub state is unavailable.",
    diagnosticIds: []
  };
}
