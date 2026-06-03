import { afterEach, describe, expect, it } from "vitest";

import { createSessionDetailViewModelService } from "../../../src/main/app/session-detail-view-model-service.js";
import { syncLatestSourceCacheRecordToEntityStore } from "../../../src/main/app/workbench-entity-store-sync.js";
import {
  cleanupTempDirs,
  createScannedRuntime
} from "./triage-test-runtime.js";

describe("session detail view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("returns a sanitized mixed timeline for a scanned session", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createSessionDetailViewModelService({ runtime });
    const sessions = await runtime.cacheStore.listLatestRecords();
    const sessionId = sessions[0]?.normalized.sessions[0]?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a scanned session.");
    }

    const detail = await service.getSessionDetail({ sessionId });

    expect(detail?.timeline.length).toBeGreaterThan(0);
    expect(detail?.timeline.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["message", "shell-command"])
    );
    expect(JSON.stringify(detail)).not.toContain("artifacts/implementation-note.txt");
  });

  it("keeps multiple output artifacts for one timeline event reachable", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.normalized.sessions[0]);
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session).toBeDefined();
    if (!record || !session) {
      throw new Error("Expected a cached session.");
    }

    const eventId = "event-multiple-artifacts";
    record.normalized.events.push({
      id: eventId,
      entityType: "session-event",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      kind: "tool-result",
      title: "Multiple output artifacts",
      text: "Generated multiple output artifacts.",
      orderKey: "zz-multiple-artifacts",
      diagnostics: [],
      diagnosticIds: []
    });
    const firstArtifact = {
      id: "artifact-multiple-1",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      entityType: "output-artifact" as const,
      nativeRef: "artifact-multiple-1",
      path: "artifacts/multiple-1.txt",
      kind: "sidecar" as const,
      contentKind: "plain-text" as const,
      loaded: false,
      diagnostics: [],
      diagnosticIds: [],
      source: { eventId }
    };
    const secondArtifact = {
      ...firstArtifact,
      id: "artifact-multiple-2",
      nativeRef: "artifact-multiple-2",
      path: "artifacts/multiple-2.txt"
    };
    record.normalized.outputArtifacts.push(firstArtifact, secondArtifact);
    await runtime.cacheStore.save(records);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const service = createSessionDetailViewModelService({ runtime });
    const detail = await service.getSessionDetail({ sessionId: session.id });
    const artifactTimelineIds =
      detail?.timeline
        .filter((event) => event.kind === "output-artifact")
        .map((event) => event.id) ?? [];

    expect(artifactTimelineIds).toEqual(
      expect.arrayContaining([firstArtifact.id, secondArtifact.id])
    );
  });

  it("renders Gemini metadata events as metadata instead of unknown evidence markers", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createSessionDetailViewModelService({ runtime });
    const records = await runtime.cacheStore.listLatestRecords();
    const geminiSession = records
      .flatMap((record) => record.normalized.sessions)
      .find((session) => session.adapterId === "gemini-cli");

    expect(geminiSession).toBeDefined();
    if (!geminiSession) {
      throw new Error("Expected a Gemini session.");
    }

    const detail = await service.getSessionDetail({ sessionId: geminiSession.id });
    const metadataEvent = detail?.timeline.find((event) => event.kind === "metadata");

    expect(metadataEvent).toEqual(
      expect.objectContaining({
        kind: "metadata",
        title: "Session metadata"
      })
    );
    expect(metadataEvent?.summary).not.toContain("Unknown evidence marker");
  });

  it("falls back to safe non-empty copy when timeline events expose whitespace-only title or text", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.normalized.sessions[0]);
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session).toBeDefined();
    if (!record || !session) {
      throw new Error("Expected a cached session.");
    }

    record.normalized.events.push({
      id: "event-empty-lifecycle",
      entityType: "session-event",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      kind: "lifecycle",
      title: "   ",
      text: "   ",
      orderKey: "zz-empty-lifecycle",
      diagnostics: [],
      diagnosticIds: []
    });
    await runtime.cacheStore.save(records);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const service = createSessionDetailViewModelService({ runtime });
    const detail = await service.getSessionDetail({ sessionId: session.id });
    const lifecycleEvent = detail?.timeline.find((event) => event.id === "event-empty-lifecycle");

    expect(lifecycleEvent).toEqual(
      expect.objectContaining({
        kind: "lifecycle",
        title: "Lifecycle event",
        summary: "Chronological lifecycle evidence"
      })
    );
  });

  it("pages timeline records with opaque store cursors", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.normalized.sessions[0]);
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session).toBeDefined();
    if (!record || !session) {
      throw new Error("Expected a cached session.");
    }

    for (let index = 0; index < 55; index += 1) {
      record.normalized.events.push({
        id: `event-opaque-cursor-${index}`,
        entityType: "session-event",
        adapterId: record.adapterId,
        sourceId: record.sourceId,
        sessionId: session.id,
        kind: "lifecycle",
        title: `Paged lifecycle ${index}`,
        text: `Paged timeline evidence ${index}`,
        orderKey: `zz-opaque-cursor-${String(index).padStart(2, "0")}`,
        diagnostics: [],
        diagnosticIds: []
      });
    }
    await runtime.cacheStore.save(records);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const service = createSessionDetailViewModelService({ runtime });
    const firstPage = await service.getSessionTimeline?.({
      sessionId: session.id,
      limit: 50
    });

    expect(firstPage?.pageInfo.hasMore).toBe(true);
    expect(firstPage?.pageInfo.nextCursor).toEqual(expect.any(String));
    expect(firstPage?.pageInfo.nextCursor).not.toMatch(/^\d+$/u);

    const secondPage = await service.getSessionTimeline?.({
      sessionId: session.id,
      cursor: firstPage?.pageInfo.nextCursor,
      limit: 50
    });

    expect(secondPage?.timeline?.length).toBeGreaterThan(0);
  });

  it("bounds oversized shell command timeline summaries", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.normalized.sessions[0]);
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session).toBeDefined();
    if (!record || !session) {
      throw new Error("Expected a cached session.");
    }

    const eventId = "event-oversized-shell-output";
    record.normalized.events.push({
      id: eventId,
      entityType: "session-event",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      kind: "shell-command",
      title: "npm test oversized",
      text: "Shell output is available.",
      orderKey: "zz-oversized-shell-output",
      diagnostics: [],
      diagnosticIds: []
    });
    record.normalized.shellCommands.push({
      id: "shell-command-oversized-output",
      entityType: "shell-command-evidence",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      kind: "shell-command",
      command: "npm test oversized",
      outputInline: "x".repeat(5_000),
      outputArtifactIds: [],
      source: { eventId },
      confidence: "confirmed"
    });
    await runtime.cacheStore.save(records);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const service = createSessionDetailViewModelService({ runtime });
    const detail = await service.getSessionDetail({ sessionId: session.id });
    const shellEvent = detail?.timeline.find((event) => event.id === eventId);

    expect(shellEvent?.summary).toHaveLength(2_000);
    expect(shellEvent?.summary).toMatch(/\.\.\.$/u);
  });

  it("uses parsed shell command metadata in session details", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const records = await runtime.cacheStore.load();
    const record = records.find((candidate) => candidate.normalized.sessions[0]);
    const session = record?.normalized.sessions[0];

    expect(record).toBeDefined();
    expect(session).toBeDefined();
    if (!record || !session) {
      throw new Error("Expected a cached session.");
    }

    const eventId = "event-shell-command-parsed-metadata";
    record.normalized.events.push({
      id: eventId,
      entityType: "session-event",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      kind: "shell-command",
      title: "npm run typecheck",
      text: "Typecheck command completed.",
      orderKey: "zz-shell-command-parsed-metadata",
      diagnostics: [],
      diagnosticIds: []
    });
    record.normalized.shellCommands.push({
      id: "shell-command-parsed-metadata",
      entityType: "shell-command-evidence",
      adapterId: record.adapterId,
      sourceId: record.sourceId,
      sessionId: session.id,
      kind: "shell-command",
      command: "npm run typecheck",
      outputInline: "TypeScript checks passed.\nExit code: 0",
      outputArtifactIds: [],
      source: { eventId },
      confidence: "confirmed"
    });
    const existingShellCommandSession = record.shellCommands?.sessions.find(
      (entry) => entry.sessionId === session.id
    );

    if (existingShellCommandSession) {
      existingShellCommandSession.shellCommands.push({
        shellCommandId: "shell-command-parsed-metadata",
        command: "npm run typecheck",
        intent: "typecheck",
        result: "passed",
        outputSource: "combined",
        outputTextSource: "summary",
        exitCode: 0,
        exitCodeSource: "summary",
        failureMarkers: [],
        confidence: {
          level: "high",
          normalizedLevel: "confirmed"
        }
      });
    } else {
      record.shellCommands = {
        version: 1,
        sessions: [{
          sessionId: session.id,
          shellCommands: [{
            shellCommandId: "shell-command-parsed-metadata",
            command: "npm run typecheck",
            intent: "typecheck",
            result: "passed",
            outputSource: "combined",
            outputTextSource: "summary",
            exitCode: 0,
            exitCodeSource: "summary",
            failureMarkers: [],
            confidence: {
              level: "high",
              normalizedLevel: "confirmed"
            }
          }]
        }]
      };
    }
    await runtime.cacheStore.save(records);
    await syncLatestSourceCacheRecordToEntityStore(runtime, record.sourceId);

    const service = createSessionDetailViewModelService({ runtime });
    const detail = await service.getSessionDetail({ sessionId: session.id });
    const shellEvent = detail?.timeline.find((event) => event.id === eventId);

    expect(shellEvent?.metadata).toEqual(
      expect.arrayContaining([
        { label: "Intent", value: "Typecheck" },
        { label: "Result", value: "Succeeded" },
        { label: "Exit Code", value: "0" }
      ])
    );
  });
});
