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
});
