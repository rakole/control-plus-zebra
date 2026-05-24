import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AdapterNormalizationResult } from "../../../src/main/core/adapter-contract/index.js";
import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";

import { exerciseAdapter } from "../../contract/run-adapter-contract.js";

const fixturePath = path.resolve("src/main/adapters/fake-test/fixtures/phase1-session.fixture.json");
const goldenPath = path.resolve("tests/fixtures/fake-test/phase1-session.normalized.json");

function buildStableIdMap(normalized: AdapterNormalizationResult) {
  const idMap = new Map<string, string>();

  normalized.projects.forEach((project) => {
    idMap.set(project.id, `project:${project.nativeId}`);
  });

  normalized.sessions.forEach((session) => {
    idMap.set(session.id, `session:${session.nativeId}`);
  });

  normalized.events.forEach((event) => {
    idMap.set(event.id, `session-event:${event.nativeId}`);
  });

  normalized.messages.forEach((message) => {
    idMap.set(message.id, `session-message:${message.nativeId}`);
  });

  normalized.toolCalls.forEach((toolCall) => {
    idMap.set(toolCall.id, `tool-call:${toolCall.nativeId}`);
  });

  normalized.shellCommands.forEach((shellCommand) => {
    idMap.set(shellCommand.id, `shell-command:${shellCommand.nativeId}`);
  });

  normalized.outputArtifacts.forEach((artifact) => {
    idMap.set(artifact.id, `output-artifact:${artifact.nativeId}`);
  });

  normalized.fileMutations.forEach((mutation) => {
    idMap.set(mutation.id, `file-mutation:${mutation.nativeId}`);
  });

  normalized.diagnostics.forEach((diagnostic, index) => {
    idMap.set(diagnostic.id, `diagnostic:${diagnostic.code}:${index + 1}`);
  });

  return idMap;
}

function rewriteId(id: string, idMap: Map<string, string>) {
  const stableId = idMap.get(id);

  if (!stableId) {
    throw new Error(`Missing stable ID mapping for '${id}'.`);
  }

  return stableId;
}

function rewriteOptionalId(id: string | undefined, idMap: Map<string, string>) {
  if (id === undefined) {
    return undefined;
  }

  return rewriteId(id, idMap);
}

function rewriteIdList(ids: string[] | undefined, idMap: Map<string, string>) {
  if (!ids || ids.length === 0) {
    return undefined;
  }

  return ids.map((id) => rewriteId(id, idMap));
}

function toStableSourcePointer(
  pointer: object | undefined,
  idMap: Map<string, string>
) {
  if (!pointer) {
    return undefined;
  }
  const record = pointer as Record<string, unknown>;

  return {
    ...(typeof record.path === "string" ? { path: normalizeSnapshotPath(record.path) } : {}),
    ...(record.nativeRef ? { nativeRef: record.nativeRef } : {}),
    ...(record.nativeId ? { nativeId: record.nativeId } : {}),
    ...(record.lineNumber !== undefined ? { lineNumber: record.lineNumber } : {}),
    ...(record.recordIndex !== undefined ? { recordIndex: record.recordIndex } : {}),
    ...(typeof record.eventId === "string"
      ? { eventId: rewriteOptionalId(record.eventId, idMap) ?? record.eventId }
      : {}),
    ...(record.pointer ? { pointer: record.pointer } : {})
  };
}

function normalizeSnapshotPath(value: string): string {
  const relative = path.relative(process.cwd(), value);

  return relative.startsWith("..") ? value : relative.split(path.sep).join(path.posix.sep);
}

function toStableNormalizedSnapshot(
  normalized: AdapterNormalizationResult,
  stableSourceId: string
) {
  const idMap = buildStableIdMap(normalized);

  return {
    adapterId: normalized.adapterId,
    sourceId: stableSourceId,
    capabilities: {
      adapter: {
        adapterId: normalized.capabilities.adapter.adapterId,
        capabilities: normalized.capabilities.adapter.capabilities
      },
      source: {
        adapterId: normalized.capabilities.source.adapterId,
        sourceId: stableSourceId,
        capabilities: normalized.capabilities.source.capabilities
      },
      sessions: normalized.capabilities.sessions.map((sessionSnapshot) => ({
        adapterId: sessionSnapshot.adapterId,
        sourceId: stableSourceId,
        sessionId: rewriteId(sessionSnapshot.sessionId, idMap),
        capabilities: sessionSnapshot.capabilities
      }))
    },
    projects: normalized.projects.map((project) => ({
      kind: project.kind,
      id: rewriteId(project.id, idMap),
      adapterId: project.adapterId,
      sourceId: stableSourceId,
      nativeId: project.nativeId,
      displayName: project.displayName,
      ...(project.primaryRootPath ? { primaryRootPath: project.primaryRootPath } : {}),
      rootConfidence: project.rootConfidence,
      harnessRefs: project.harnessRefs?.map((ref) => ({
        adapterId: ref.adapterId,
        sourceId: stableSourceId,
        nativeProjectId: ref.nativeProjectId,
        ...(ref.nativeProjectPath ? { nativeProjectPath: ref.nativeProjectPath } : {}),
        ...(ref.projectRootPath ? { projectRootPath: ref.projectRootPath } : {}),
        projectRootConfidence: ref.projectRootConfidence,
        rawArtifactRefs: ref.rawArtifactRefs.map((artifact) => ({
          nativeRef: artifact.nativeRef,
          artifactKind: artifact.artifactKind,
          parseStrategy: artifact.parseStrategy
        }))
      })),
      sessionIds: rewriteIdList(project.sessionIds, idMap),
      ...(project.latestActivityAt ? { latestActivityAt: project.latestActivityAt } : {}),
      ...(project.latestPrompt ? { latestPrompt: project.latestPrompt } : {}),
      confidence: project.confidence
    })),
    sessions: normalized.sessions.map((session) => ({
      kind: session.kind,
      id: rewriteId(session.id, idMap),
      adapterId: session.adapterId,
      sourceId: stableSourceId,
      nativeId: session.nativeId,
      ...(session.projectId ? { projectId: rewriteId(session.projectId, idMap) } : {}),
      ...(session.title ? { title: session.title } : {}),
      ...(session.startedAt ? { startedAt: session.startedAt } : {}),
      ...(session.lastUpdatedAt ? { lastUpdatedAt: session.lastUpdatedAt } : {}),
      ...(session.durationMs !== undefined ? { durationMs: session.durationMs } : {}),
      lifecycleStatus: session.lifecycleStatus,
      parseConfidence: session.parseConfidence,
      messageIds: rewriteIdList(session.messageIds, idMap),
      eventIds: rewriteIdList(session.eventIds, idMap),
      toolCallIds: rewriteIdList(session.toolCallIds, idMap),
      fileMutationIds: rewriteIdList(session.fileMutationIds, idMap),
      shellCommandIds: rewriteIdList(session.shellCommandIds, idMap),
      outputArtifactIds: rewriteIdList(session.outputArtifactIds, idMap),
      usage: session.usage,
      rawArtifactRefs: session.rawArtifactRefs?.map((artifact) => ({
        nativeRef: artifact.nativeRef,
        artifactKind: artifact.artifactKind,
        parseStrategy: artifact.parseStrategy
      })),
      confidence: session.confidence
    })),
    events: normalized.events.map((event) => ({
      kind: event.kind,
      id: rewriteId(event.id, idMap),
      adapterId: event.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(event.sessionId, idMap),
      nativeId: event.nativeId,
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      orderKey: event.orderKey,
      ...(event.actor ? { actor: event.actor } : {}),
      ...(event.title ? { title: event.title } : {}),
      ...(event.text ? { text: event.text } : {}),
      raw: toStableSourcePointer(event.raw, idMap),
      confidence: event.confidence
    })),
    messages: normalized.messages.map((message) => ({
      kind: message.kind,
      id: rewriteId(message.id, idMap),
      adapterId: message.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(message.sessionId, idMap),
      nativeId: message.nativeId,
      role: message.role,
      ...(message.text ? { text: message.text } : {}),
      ...(message.modelName ? { modelName: message.modelName } : {}),
      ...(message.usage ? { usage: message.usage } : {}),
      ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      toolCallIds: rewriteIdList(message.toolCallIds, idMap),
      eventIds: rewriteIdList(message.eventIds, idMap),
      source: toStableSourcePointer(message.source, idMap),
      confidence: message.confidence
    })),
    toolCalls: normalized.toolCalls.map((toolCall) => ({
      kind: toolCall.kind,
      id: rewriteId(toolCall.id, idMap),
      adapterId: toolCall.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(toolCall.sessionId, idMap),
      nativeId: toolCall.nativeId,
      nativeToolCallId: toolCall.nativeToolCallId,
      name: toolCall.name,
      normalizedKind: toolCall.normalizedKind,
      ...(toolCall.statusRaw ? { statusRaw: toolCall.statusRaw } : {}),
      ...(toolCall.statusNormalized ? { statusNormalized: toolCall.statusNormalized } : {}),
      ...(toolCall.argsPreview ? { argsPreview: toolCall.argsPreview } : {}),
      ...(toolCall.resultPreview ? { resultPreview: toolCall.resultPreview } : {}),
      outputArtifactIds: rewriteIdList(toolCall.outputArtifactIds, idMap),
      ...(toolCall.fileMutationId ? { fileMutationId: rewriteId(toolCall.fileMutationId, idMap) } : {}),
      ...(toolCall.shellCommandId ? { shellCommandId: rewriteId(toolCall.shellCommandId, idMap) } : {}),
      source: toStableSourcePointer(toolCall.source, idMap),
      confidence: toolCall.confidence
    })),
    shellCommands: normalized.shellCommands.map((shellCommand) => ({
      kind: shellCommand.kind,
      id: rewriteId(shellCommand.id, idMap),
      adapterId: shellCommand.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(shellCommand.sessionId, idMap),
      nativeId: shellCommand.nativeId,
      ...(shellCommand.toolCallId ? { toolCallId: rewriteId(shellCommand.toolCallId, idMap) } : {}),
      command: shellCommand.command,
      ...(shellCommand.cwd ? { cwd: shellCommand.cwd } : {}),
      ...(shellCommand.outputInline ? { outputInline: shellCommand.outputInline } : {}),
      outputArtifactIds: rewriteIdList(shellCommand.outputArtifactIds, idMap),
      ...(shellCommand.rawStatus ? { rawStatus: shellCommand.rawStatus } : {}),
      ...(shellCommand.rawExitCode !== undefined ? { rawExitCode: shellCommand.rawExitCode } : {}),
      source: toStableSourcePointer(shellCommand.source, idMap),
      confidence: shellCommand.confidence
    })),
    outputArtifacts: normalized.outputArtifacts.map((artifact) => ({
      kind: artifact.kind,
      id: rewriteId(artifact.id, idMap),
      adapterId: artifact.adapterId,
      sourceId: stableSourceId,
	      ...(artifact.sessionId ? { sessionId: rewriteId(artifact.sessionId, idMap) } : {}),
      nativeId: artifact.nativeId,
      ...(artifact.nativeRef ? { nativeRef: artifact.nativeRef } : {}),
      ...(artifact.path ? { path: artifact.path } : {}),
      ...(artifact.contentKind ? { contentKind: artifact.contentKind } : {}),
      ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
      ...(artifact.sizeBytes !== undefined ? { sizeBytes: artifact.sizeBytes } : {}),
      ...(artifact.preview ? { preview: artifact.preview } : {}),
      ...(artifact.loaded !== undefined ? { loaded: artifact.loaded } : {}),
      source: toStableSourcePointer(artifact.source, idMap),
      confidence: artifact.confidence
    })),
    fileMutations: normalized.fileMutations.map((mutation) => ({
      kind: mutation.kind,
      id: rewriteId(mutation.id, idMap),
      adapterId: mutation.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(mutation.sessionId, idMap),
      nativeId: mutation.nativeId,
      path: mutation.path,
      mutationKind: mutation.mutationKind,
      ...(mutation.toolCallId ? { toolCallId: rewriteId(mutation.toolCallId, idMap) } : {}),
      source: toStableSourcePointer(mutation.source, idMap),
      confidence: mutation.confidence
    })),
    diagnostics: normalized.diagnostics.map((diagnostic) => ({
      id: rewriteId(diagnostic.id, idMap),
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity,
      scope: diagnostic.scope,
      adapterId: diagnostic.adapterId,
      ...(diagnostic.sourceId ? { sourceId: stableSourceId } : {}),
      ...(diagnostic.relatedEntityIds
        ? {
            relatedEntityIds: diagnostic.relatedEntityIds.map((id, index) =>
              rewriteOptionalId(id, idMap) ?? `related-entity:${index + 1}`
            )
          }
        : {}),
      confidence: diagnostic.confidence,
      ...(diagnostic.metadata ? { metadata: diagnostic.metadata } : {})
    }))
  };
}

describe("fake-test adapter golden normalization", () => {
  it("matches the checked-in normalized Phase 1 fixture artifact", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { source: { id: string } };
    const stableSourceId = `source:${fixture.source.id}`;
    const exercised = await exerciseAdapter(fakeTestAdapter, fixturePath);
    const actual = `${JSON.stringify(
      toStableNormalizedSnapshot(exercised.normalized, stableSourceId),
      null,
      2
    )}\n`;

    if (process.env.UPDATE_GOLDENS === "1") {
      await mkdir(path.dirname(goldenPath), { recursive: true });
      await writeFile(goldenPath, actual, "utf8");
    }

    const expected = await readFile(goldenPath, "utf8");
    expect(actual).toBe(expected);
  });
});
