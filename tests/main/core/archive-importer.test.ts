import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadTriageData } from "../../../src/main/app/triage-view-model-service.js";
import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import { createSessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import { ArchiveExporter } from "../../../src/main/core/archive/archive-exporter.js";
import { ArchiveImporter } from "../../../src/main/core/archive/archive-importer.js";
import {
  createFileMutationEvidenceId,
  createOutputArtifactId,
  createProjectId,
  createSessionEventId,
  createSessionId,
  createSessionMessageId,
  createShellCommandEvidenceId,
  createToolCallId
} from "../../../src/main/core/model/identifiers.js";
import {
  cleanupTempDirs,
  createScannedRuntime,
  createTempRuntime
} from "../ipc/triage-test-runtime.js";

describe("ArchiveImporter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("imports archives as persistent read-only sources and hydrates archived sessions without the original root", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "import-me.awb-archive.json");

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const sessionService = createSessionViewModelService({ runtime: importRuntime });
    const sessions = await sessionService.listSessions();

    expect(importedSource).toMatchObject({
      sourceId: result.sourceId,
      adapterId: expect.not.stringMatching(/^archive-reader$/u),
      sourceKind: "imported-archive",
      addedBy: "import",
      readOnly: true,
      rootPath: archivePath,
      validation: { status: "unsupported" },
      scan: { status: "unsupported" },
      cache: { status: "cached" }
    });
    expect(importedSource?.archive).toMatchObject({
      archivePath,
      manifestVersion: 1,
      scopeKind: "project",
      scopeId: projectId
    });
    expect((await importRuntime.cacheStore.listLatestRecords()).map((record) => record.sourceId)).toEqual([
      result.sourceId
    ]);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.sourceId).toBe(result.sourceId);
    expect(sessions[0]?.adapterId).toBe(importedSource?.adapterId);
    expect(sessions[0]?.adapterDisplayName).toBeTruthy();
  });

  it("falls back to archived entity ids when Wave 2 compatibility data omits native ids", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(exportRuntime.appDataDir, "exports", "wave-2-compat.awb-archive.json");

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = JSON.parse(await readFile(archivePath, "utf8")) as {
      payload: {
        cacheRecords: Array<{
          normalized: {
            sessions: Array<{
              adapterId: string;
              id: string;
              nativeId?: string;
              sourceId: string;
            }>;
          };
        }>;
      };
    };
    const archivedSession = archive.payload.cacheRecords
      .flatMap((record) => record.normalized.sessions)
      .find((session) => session.nativeId);

    expect(archivedSession).toBeDefined();
    if (!archivedSession) {
      throw new Error("Expected an archived session with stable identity fields.");
    }

    delete archivedSession.nativeId;
    await writeFile(archivePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSessions = (await importRuntime.cacheStore.listLatestRecords()).flatMap(
      (record) => record.normalized.sessions
    );
    const expectedImportedSessionId = createSessionId({
      adapterId: archivedSession.adapterId,
      sourceId: result.sourceId,
      nativeId: archivedSession.id
    });

    expect(importedSessions.map((session) => session.id)).toContain(expectedImportedSessionId);
    expect(importedSessions.some((session) => session.id.includes("unknown-source"))).toBe(false);
    expect(importedSessions.some((session) => session.id.includes("unknown-native"))).toBe(false);
  });

  it("rebases linked entity references across imported archive graphs", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageService = createTriageViewModelService({ runtime: exportRuntime });
    const projectId = await getExportProjectId(triageService);

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "rebased-graph.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = JSON.parse(await readFile(archivePath, "utf8")) as {
      payload: {
        cacheRecords: Array<{
          normalized: {
            projects: MutableArchivedEntity[];
            sessions: MutableArchivedEntity[];
            events: MutableArchivedEntity[];
            messages: MutableArchivedEntity[];
            toolCalls: MutableArchivedEntity[];
            shellCommands: MutableArchivedEntity[];
            outputArtifacts: MutableArchivedEntity[];
            fileMutations: MutableArchivedEntity[];
          };
        }>;
      };
    };
    const normalized = archive.payload.cacheRecords[0]?.normalized;

    expect(normalized).toBeDefined();
    if (!normalized) {
      throw new Error("Expected an exported normalized payload.");
    }

    const project = normalized.projects[0];
    const session = normalized.sessions[0];
    const event = normalized.events[0];
    const message = normalized.messages[0];
    const toolCall = normalized.toolCalls[0];
    const shellCommand = normalized.shellCommands[0];
    const outputArtifact = normalized.outputArtifacts[0];

    expect(project).toBeDefined();
    expect(session).toBeDefined();
    expect(event).toBeDefined();
    expect(message).toBeDefined();
    expect(toolCall).toBeDefined();
    expect(shellCommand).toBeDefined();
    expect(outputArtifact).toBeDefined();

    if (
      !project ||
      !session ||
      !event ||
      !message ||
      !toolCall ||
      !shellCommand ||
      !outputArtifact
    ) {
      throw new Error("Expected at least one archived entity of each linked type.");
    }

    const fileMutation =
      normalized.fileMutations[0] ??
      ({
        id: "archived-file-mutation-link-test",
        adapterId: String(session.adapterId),
        sourceId: String(session.sourceId),
        sessionId: String(session.id),
        path: "src/generated-importer-link-test.ts",
        mutationKind: "updated",
        source: { path: "src/generated-importer-link-test.ts" },
        confidence: "observed",
        diagnostics: []
      } satisfies MutableArchivedEntity);

    if (normalized.fileMutations.length === 0) {
      normalized.fileMutations.push(fileMutation);
    }

    project.sessionIds = [session.id];
    session.projectId = project.id;
    session.messageIds = [message.id];
    session.eventIds = [event.id];
    session.toolCallIds = [toolCall.id];
    session.fileMutationIds = [fileMutation.id];
    session.shellCommandIds = [shellCommand.id];
    session.outputArtifactIds = [outputArtifact.id];
    session.verification = {
      state: "failed",
      commandsRun: 1,
      verificationCommandsRun: 1,
      buildRan: false,
      testsRan: false,
      typecheckRan: true,
      lintRan: false,
      failedCommandIds: [shellCommand.id],
      passedCommandIds: [shellCommand.id],
      summary: "Archive importer should rebase verification command refs.",
      confidence: "observed",
      diagnostics: []
    };
    session.runAudit = {
      sessionId: session.id,
      adapterId: String(session.adapterId),
      classification: "needs-review",
      agentClaimedCompleted: "unknown",
      finalAnswerPresent: true,
      requestCancelled: false,
      verificationCommandsRun: true,
      shellExitCodes: [1],
      failedTestsDetected: false,
      attentionReasons: ["parser-warning"],
      summary: "Archive importer should rebase run-audit session refs.",
      confidence: "observed",
      diagnostics: []
    };
    event.sessionId = session.id;
    message.sessionId = session.id;
    message.toolCallIds = [toolCall.id];
    message.eventIds = [event.id];
    toolCall.sessionId = session.id;
    toolCall.outputArtifactIds = [outputArtifact.id];
    toolCall.fileMutationId = fileMutation.id;
    toolCall.shellCommandId = shellCommand.id;
    shellCommand.sessionId = session.id;
    shellCommand.toolCallId = toolCall.id;
    shellCommand.outputArtifactIds = [outputArtifact.id];
    outputArtifact.sessionId = session.id;
    outputArtifact.ref = {
      adapterId: String(outputArtifact.adapterId),
      sourceId: String(outputArtifact.sourceId),
      id: String(outputArtifact.id),
      sessionId: String(session.id),
      ...(outputArtifact.nativeRef
        ? { nativeRef: String(outputArtifact.nativeRef) }
        : {}),
      ...(outputArtifact.path ? { path: String(outputArtifact.path) } : {})
    };
    fileMutation.sessionId = session.id;
    fileMutation.toolCallId = toolCall.id;

    await writeFile(archivePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedNormalized = (await importRuntime.cacheStore.listLatestRecords())[0]
      ?.normalized;

    expect(importedNormalized).toBeDefined();
    if (!importedNormalized) {
      throw new Error("Expected imported normalized payload.");
    }

    const expectedProjectId = buildExpectedImportedId("project", project, result.sourceId);
    const expectedSessionId = buildExpectedImportedId("session", session, result.sourceId);
    const expectedEventId = buildExpectedImportedId("event", event, result.sourceId);
    const expectedMessageId = buildExpectedImportedId("message", message, result.sourceId);
    const expectedToolCallId = buildExpectedImportedId(
      "toolCall",
      toolCall,
      result.sourceId
    );
    const expectedShellCommandId = buildExpectedImportedId(
      "shellCommand",
      shellCommand,
      result.sourceId
    );
    const expectedOutputArtifactId = buildExpectedImportedId(
      "outputArtifact",
      outputArtifact,
      result.sourceId
    );
    const expectedFileMutationId = buildExpectedImportedId(
      "fileMutation",
      fileMutation,
      result.sourceId
    );

    const importedProject = importedNormalized.projects.find(
      (item) => item.id === expectedProjectId
    );
    const importedSession = importedNormalized.sessions.find(
      (item) => item.id === expectedSessionId
    );
    const importedEvent = importedNormalized.events.find(
      (item) => item.id === expectedEventId
    );
    const importedMessage = importedNormalized.messages.find(
      (item) => item.id === expectedMessageId
    );
    const importedToolCall = importedNormalized.toolCalls.find(
      (item) => item.id === expectedToolCallId
    );
    const importedShellCommand = importedNormalized.shellCommands.find(
      (item) => item.id === expectedShellCommandId
    );
    const importedOutputArtifact = importedNormalized.outputArtifacts.find(
      (item) => item.id === expectedOutputArtifactId
    );
    const importedFileMutation = importedNormalized.fileMutations.find(
      (item) => item.id === expectedFileMutationId
    );

    expect(importedProject?.sessionIds).toEqual([expectedSessionId]);
    expect(importedSession).toMatchObject({
      projectId: expectedProjectId,
      messageIds: [expectedMessageId],
      eventIds: [expectedEventId],
      toolCallIds: [expectedToolCallId],
      fileMutationIds: [expectedFileMutationId],
      shellCommandIds: [expectedShellCommandId],
      outputArtifactIds: [expectedOutputArtifactId]
    });
    expect(importedSession?.verification).toMatchObject({
      failedCommandIds: [expectedShellCommandId],
      passedCommandIds: [expectedShellCommandId]
    });
    expect(importedSession?.runAudit).toMatchObject({
      sessionId: expectedSessionId
    });
    expect(importedEvent).toMatchObject({
      sessionId: expectedSessionId
    });
    expect(importedMessage).toMatchObject({
      sessionId: expectedSessionId,
      toolCallIds: [expectedToolCallId],
      eventIds: [expectedEventId]
    });
    expect(importedToolCall).toMatchObject({
      sessionId: expectedSessionId,
      outputArtifactIds: [expectedOutputArtifactId],
      fileMutationId: expectedFileMutationId,
      shellCommandId: expectedShellCommandId
    });
    expect(importedShellCommand).toMatchObject({
      sessionId: expectedSessionId,
      toolCallId: expectedToolCallId,
      outputArtifactIds: [expectedOutputArtifactId]
    });
    expect(importedOutputArtifact).toMatchObject({
      sessionId: expectedSessionId,
      ref: {
        sourceId: result.sourceId,
        id: expectedOutputArtifactId,
        sessionId: expectedSessionId
      }
    });
    expect(importedFileMutation).toMatchObject({
      sessionId: expectedSessionId,
      toolCallId: expectedToolCallId
    });
  });

  it("materializes archived raw artifacts into an import-owned root and rebases durable index paths", async () => {
    const exportRuntime = await createScannedRuntime(tempDirs);
    const triageData = await loadTriageData(exportRuntime);
    const sessionId = [...triageData.sessionsById.values()].find(
      (session) =>
        session.adapterId === "gemini-cli" && (session.outputArtifactIds?.length ?? 0) > 0
    )?.id;

    expect(sessionId).toBeDefined();
    if (!sessionId) {
      throw new Error("Expected a Gemini session with output artifacts to export.");
    }

    const exporter = new ArchiveExporter({
      cacheStore: exportRuntime.cacheStore,
      rawArtifactIndex: exportRuntime.rawArtifactIndex,
      sourceRegistry: exportRuntime.sourceRegistry
    });
    const archivePath = path.join(
      exportRuntime.appDataDir,
      "exports",
      "materialized-raw-artifacts.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath: archivePath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId }
    });

    const importRuntime = await createTempRuntime(tempDirs);
    const importer = new ArchiveImporter({
      appDataDir: importRuntime.appDataDir,
      cacheStore: importRuntime.cacheStore,
      rawArtifactIndex: importRuntime.rawArtifactIndex,
      sourceRegistry: importRuntime.sourceRegistry
    });
    const result = await importer.importArchive({ archivePath });
    const importedSource = await importRuntime.sourceRegistry.getSource(result.sourceId);
    const importedEntries = await importRuntime.rawArtifactIndex.listSourceEntries(result.sourceId);
    const importedOutputArtifactEntry = importedEntries.find(
      (entry) => entry.artifactKind === "output-artifact"
    );
    const cachedRecord = (await importRuntime.cacheStore.listLatestRecords()).find(
      (record) => record.sourceId === result.sourceId
    );

    expect(importedSource).toBeDefined();
    expect(importedSource?.archive?.archivePath).toBe(archivePath);
    expect(importedSource?.rootPath).not.toBe(archivePath);
    expect(importedSource?.rootPath).toContain(
      path.join(importRuntime.appDataDir, "imports", "archives")
    );
    expect(importedEntries.length).toBeGreaterThan(0);
    expect(importedOutputArtifactEntry?.path).toBeDefined();
    expect(importedOutputArtifactEntry?.path).toContain(importedSource?.rootPath ?? "");
    expect(importedOutputArtifactEntry?.path?.includes("gemini-root")).toBe(false);
    expect(await readFile(importedOutputArtifactEntry?.path ?? "", "utf8")).toContain(
      "Contract types"
    );
    expect((await stat(importedOutputArtifactEntry?.path ?? "")).isFile()).toBe(true);
    expect(cachedRecord?.rawArtifactIndex?.entries.some((entry) => entry.path)).toBe(true);
    expect(
      cachedRecord?.rawArtifactIndex?.entries
        .filter((entry) => entry.path)
        .every((entry) => entry.path?.startsWith(importedSource?.rootPath ?? ""))
    ).toBe(true);
    expect(JSON.stringify(cachedRecord?.normalized)).not.toContain(
      path.join(exportRuntime.appDataDir, "gemini-root")
    );
  });
});

type MutableArchivedEntity = {
  id: string;
  adapterId?: string;
  nativeId?: string;
  sourceId?: string;
  [key: string]: unknown;
};

async function getExportProjectId(
  triageService: ReturnType<typeof createTriageViewModelService>
): Promise<string | undefined> {
  const projects = await triageService.listProjects();

  return (
    projects.find(
      (project) =>
        project.projectName === "control-plus-zebra" ||
        project.projectDisplayName === "control-plus-zebra"
    ) ?? projects[0]
  )?.projectId;
}

function buildExpectedImportedId(
  entityKind:
    | "project"
    | "session"
    | "event"
    | "message"
    | "toolCall"
    | "shellCommand"
    | "outputArtifact"
    | "fileMutation",
  entity: {
    adapterId?: string;
    id: string;
    nativeId?: string;
    sourceId?: string;
  },
  importedSourceId: string
): string {
  const adapterId = entity.adapterId ?? "unknown-adapter";
  const archivedId = entity.id;
  const nativeId =
    entity.sourceId && entity.nativeId
      ? `${entity.sourceId}:${entity.nativeId}`
      : archivedId;

  switch (entityKind) {
    case "project":
      return createProjectId({ adapterId, sourceId: importedSourceId, nativeId });
    case "session":
      return createSessionId({ adapterId, sourceId: importedSourceId, nativeId });
    case "event":
      return createSessionEventId({ adapterId, sourceId: importedSourceId, nativeId });
    case "message":
      return createSessionMessageId({ adapterId, sourceId: importedSourceId, nativeId });
    case "toolCall":
      return createToolCallId({ adapterId, sourceId: importedSourceId, nativeId });
    case "shellCommand":
      return createShellCommandEvidenceId({
        adapterId,
        sourceId: importedSourceId,
        nativeId
      });
    case "outputArtifact":
      return createOutputArtifactId({
        adapterId,
        sourceId: importedSourceId,
        nativeId
      });
    case "fileMutation":
      return createFileMutationEvidenceId({
        adapterId,
        sourceId: importedSourceId,
        nativeId
      });
  }
}
