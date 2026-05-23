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
      name: project.name,
      ...(project.rootPath ? { rootPath: project.rootPath } : {}),
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
      ...(session.endedAt ? { endedAt: session.endedAt } : {}),
      lifecycleState: session.lifecycleState,
      confidence: session.confidence
    })),
    events: normalized.events.map((event) => ({
      kind: event.kind,
      id: rewriteId(event.id, idMap),
      adapterId: event.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(event.sessionId, idMap),
      nativeId: event.nativeId,
      eventKind: event.eventKind,
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      ordinal: event.ordinal,
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.messageId ? { messageId: rewriteId(event.messageId, idMap) } : {}),
      ...(event.toolCallId ? { toolCallId: rewriteId(event.toolCallId, idMap) } : {}),
      ...(event.shellCommandId ? { shellCommandId: rewriteId(event.shellCommandId, idMap) } : {}),
      ...(event.outputArtifactId
        ? { outputArtifactId: rewriteId(event.outputArtifactId, idMap) }
        : {}),
      ...(event.fileMutationId ? { fileMutationId: rewriteId(event.fileMutationId, idMap) } : {}),
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
      content: message.content,
      ordinal: message.ordinal,
      ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      ...(message.eventId ? { eventId: rewriteId(message.eventId, idMap) } : {}),
      confidence: message.confidence
    })),
    toolCalls: normalized.toolCalls.map((toolCall) => ({
      kind: toolCall.kind,
      id: rewriteId(toolCall.id, idMap),
      adapterId: toolCall.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(toolCall.sessionId, idMap),
      nativeId: toolCall.nativeId,
      toolName: toolCall.toolName,
      status: toolCall.status,
      ...(toolCall.startedAt ? { startedAt: toolCall.startedAt } : {}),
      ...(toolCall.endedAt ? { endedAt: toolCall.endedAt } : {}),
      ...(toolCall.inputSummary ? { inputSummary: toolCall.inputSummary } : {}),
      ...(toolCall.outputSummary ? { outputSummary: toolCall.outputSummary } : {}),
      ...(toolCall.eventId ? { eventId: rewriteId(toolCall.eventId, idMap) } : {}),
      ...(toolCall.artifactIds ? { artifactIds: rewriteIdList(toolCall.artifactIds, idMap) } : {}),
      ...(toolCall.fileMutationIds
        ? { fileMutationIds: rewriteIdList(toolCall.fileMutationIds, idMap) }
        : {}),
      confidence: toolCall.confidence
    })),
    shellCommands: normalized.shellCommands.map((shellCommand) => ({
      kind: shellCommand.kind,
      id: rewriteId(shellCommand.id, idMap),
      adapterId: shellCommand.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(shellCommand.sessionId, idMap),
      nativeId: shellCommand.nativeId,
      command: shellCommand.command,
      outputSource: shellCommand.outputSource,
      ...(shellCommand.cwd ? { cwd: shellCommand.cwd } : {}),
      ...(shellCommand.exitCode !== undefined ? { exitCode: shellCommand.exitCode } : {}),
      ...(shellCommand.startedAt ? { startedAt: shellCommand.startedAt } : {}),
      ...(shellCommand.endedAt ? { endedAt: shellCommand.endedAt } : {}),
      ...(shellCommand.outputSummary ? { outputSummary: shellCommand.outputSummary } : {}),
      ...(shellCommand.eventId ? { eventId: rewriteId(shellCommand.eventId, idMap) } : {}),
      confidence: shellCommand.confidence
    })),
    outputArtifacts: normalized.outputArtifacts.map((artifact) => ({
      kind: artifact.kind,
      id: rewriteId(artifact.id, idMap),
      adapterId: artifact.adapterId,
      sourceId: stableSourceId,
      sessionId: rewriteId(artifact.sessionId, idMap),
      nativeId: artifact.nativeId,
      artifactKind: artifact.artifactKind,
      ...(artifact.path ? { path: artifact.path } : {}),
      ...(artifact.uri ? { uri: artifact.uri } : {}),
      ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
      ...(artifact.byteLength !== undefined ? { byteLength: artifact.byteLength } : {}),
      ...(artifact.eventId ? { eventId: rewriteId(artifact.eventId, idMap) } : {}),
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
      ...(mutation.eventId ? { eventId: rewriteId(mutation.eventId, idMap) } : {}),
      ...(mutation.toolCallId ? { toolCallId: rewriteId(mutation.toolCallId, idMap) } : {}),
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
