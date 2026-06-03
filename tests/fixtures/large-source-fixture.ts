import path from "node:path";

import type {
  DerivedSessionCacheRecord,
  NormalizedCacheRecord
} from "../../src/main/core/cache/file-backed-cache-store.js";
import type { Diagnostic } from "../../src/main/core/diagnostics/diagnostic.js";
import type { RawArtifactIndexEntry } from "../../src/main/core/ingestion/raw-artifact-index.js";
import type { HarnessCapabilities } from "../../src/main/core/model/capabilities.js";
import { CONFIRMED_CONFIDENCE } from "../../src/main/core/model/confidence.js";
import type {
  FileMutationEvidence,
  OutputArtifact,
  Project,
  Session,
  SessionEvent,
  SessionMessage,
  ShellCommandEvidence,
  ToolCall
} from "../../src/main/core/model/entities.js";
import type { SourceRecord } from "../../src/main/core/registry/source-registry.js";
import type { ParsedShellCommand } from "../../src/main/core/shell/types.js";

export interface LargeSourceFixtureOptions {
  rootBasePath?: string;
  sourceCount?: number;
  sessionsPerSource?: number;
  messagesPerSession?: number;
  toolCallsPerSession?: number;
  shellCommandsPerSession?: number;
  outputArtifactsPerSession?: number;
  diagnosticsPerSession?: number;
}

export interface LargeSourceHydrationSummary {
  sourceCount: number;
  sessionCount: number;
  eventCount: number;
  messageCount: number;
  toolCallCount: number;
  shellCommandCount: number;
  outputArtifactCount: number;
  fileMutationCount: number;
  diagnosticCount: number;
}

export interface LargeSourceFixture {
  records: NormalizedCacheRecord[];
  rawArtifactEntries: RawArtifactIndexEntry[];
  sources: SourceRecord[];
  target: {
    sourceId: string;
    sessionId: string;
    outputArtifactId: string;
    outputArtifactPreview: string;
    timelineEntryCount: number;
  };
  unrelated: {
    sourceId: string;
    sessionId: string;
  };
  summary: LargeSourceHydrationSummary & {
    rawArtifactEntryCount: number;
  };
}

const DEFAULT_CAPABILITIES: HarnessCapabilities = {
  discovery: {
    defaultRoots: true,
    projectRootMapping: "inferred",
    stableProjectId: true,
    stableSessionId: true
  },
  replay: {
    transcriptReplay: true,
    messageRoles: true,
    assistantMessages: true,
    lifecycleEvents: true,
    cancellationEvents: true,
    topicEvents: false,
    rawEventPointers: true
  },
  tools: {
    toolCalls: true,
    toolResults: true,
    fileReads: true,
    fileSearches: true,
    fileMutations: true,
    diffStats: false,
    shellCommands: true,
    shellOutputs: true,
    sidecarOutputs: true
  },
  usage: {
    modelNames: true,
    tokenCounts: true,
    costEstimates: false
  },
  live: {
    activeSessionDetection: "native",
    watchableArtifacts: true,
    incrementalParsing: false
  },
  audit: {
    agentClaimDetection: true,
    finalAnswerDetection: true,
    shellExitCodeEvidence: true,
    verificationCommandEvidence: true
  },
  export: {
    rawArtifactExport: true,
    normalizedExport: true
  }
};

export function createLargeSourceFixture(
  options: LargeSourceFixtureOptions = {}
): LargeSourceFixture {
  const config = {
    sourceCount: options.sourceCount ?? 3,
    sessionsPerSource: options.sessionsPerSource ?? 4,
    messagesPerSession: options.messagesPerSession ?? 2,
    toolCallsPerSession: options.toolCallsPerSession ?? 2,
    shellCommandsPerSession: options.shellCommandsPerSession ?? 2,
    outputArtifactsPerSession: options.outputArtifactsPerSession ?? 2,
    diagnosticsPerSession: options.diagnosticsPerSession ?? 2
  };
  const records: NormalizedCacheRecord[] = [];
  const rawArtifactEntries: RawArtifactIndexEntry[] = [];
  const sources: SourceRecord[] = [];
  const targetTimelineEntryCount =
    config.messagesPerSession +
    config.toolCallsPerSession +
    config.shellCommandsPerSession +
    config.outputArtifactsPerSession +
    1;

  let targetSourceId = "";
  let targetSessionId = "";
  let targetOutputArtifactId = "";
  let targetOutputArtifactPreview = "";
  let unrelatedSourceId = "";
  let unrelatedSessionId = "";

  for (let sourceIndex = 0; sourceIndex < config.sourceCount; sourceIndex += 1) {
    const sourceNumber = pad(sourceIndex + 1);
    const adapterId = "fake-test";
    const sourceId = `source-${sourceNumber}`;
    const projectId = `project-${sourceNumber}`;
    const rootPath = path.join(options.rootBasePath ?? "/virtual/agent-workbench", sourceId);
    const sessions: Session[] = [];
    const events: SessionEvent[] = [];
    const messages: SessionMessage[] = [];
    const toolCalls: ToolCall[] = [];
    const shellCommands: ShellCommandEvidence[] = [];
    const outputArtifacts: OutputArtifact[] = [];
    const fileMutations: FileMutationEvidence[] = [];
    const diagnostics: Diagnostic[] = [];
    const derivedSessions: DerivedSessionCacheRecord[] = [];

    for (let sessionIndex = 0; sessionIndex < config.sessionsPerSource; sessionIndex += 1) {
      const sessionNumber = pad(sessionIndex + 1);
      const sessionId = `session-${sourceNumber}-${sessionNumber}`;
      const nativeSessionId = `native-session-${sourceNumber}-${sessionNumber}`;
      const startedAt = timestampFor(sourceIndex, sessionIndex, 0);
      const lastUpdatedAt = timestampFor(
        sourceIndex,
        sessionIndex,
        targetTimelineEntryCount + 5
      );
      const messageIds: string[] = [];
      const eventIds: string[] = [];
      const toolCallIds: string[] = [];
      const shellCommandIds: string[] = [];
      const outputArtifactIds: string[] = [];
      const fileMutationIds: string[] = [];
      const parsedShellCommands: ParsedShellCommand[] = [];
      let order = 0;

      for (let messageIndex = 0; messageIndex < config.messagesPerSession; messageIndex += 1) {
        const eventId = `${sessionId}-event-message-${pad(messageIndex + 1)}`;
        const messageId = `${sessionId}-message-${pad(messageIndex + 1)}`;
        const isFirstPrompt = messageIndex === 0;

        events.push({
          id: eventId,
          entityType: "session-event",
          adapterId,
          sourceId,
          sessionId,
          kind: "message",
          actor: isFirstPrompt ? "user" : "assistant",
          timestamp: timestampFor(sourceIndex, sessionIndex, order),
          orderKey: orderKey(order),
          title: isFirstPrompt ? "User message" : "Assistant message",
          text: isFirstPrompt
            ? `Investigate hydration seam for ${sessionId}`
            : `Assistant response ${messageIndex + 1} for ${sessionId}`
        });
        messages.push({
          id: messageId,
          entityType: "session-message",
          adapterId,
          sourceId,
          sessionId,
          role: isFirstPrompt ? "user" : "assistant",
          timestamp: timestampFor(sourceIndex, sessionIndex, order),
          text: isFirstPrompt
            ? `Investigate hydration seam for ${sessionId}`
            : `Assistant response ${messageIndex + 1} for ${sessionId}`,
          modelName: "fixture-model",
          usage: {
            inputTokens: 20 + messageIndex,
            outputTokens: 10 + messageIndex,
            totalTokens: 30 + messageIndex
          },
          eventIds: [eventId],
          confidence: CONFIRMED_CONFIDENCE
        });
        messageIds.push(messageId);
        eventIds.push(eventId);
        order += 1;
      }

      for (let toolCallIndex = 0; toolCallIndex < config.toolCallsPerSession; toolCallIndex += 1) {
        const eventId = `${sessionId}-event-tool-call-${pad(toolCallIndex + 1)}`;
        const toolCallId = `${sessionId}-tool-call-${pad(toolCallIndex + 1)}`;

        events.push({
          id: eventId,
          entityType: "session-event",
          adapterId,
          sourceId,
          sessionId,
          kind: "tool-call",
          actor: "tool",
          timestamp: timestampFor(sourceIndex, sessionIndex, order),
          orderKey: orderKey(order),
          title: "read_file",
          text: `Tool call ${toolCallIndex + 1} for ${sessionId}`
        });
        toolCalls.push({
          id: toolCallId,
          entityType: "tool-call",
          adapterId,
          sourceId,
          sessionId,
          name: "read_file",
          normalizedKind: "read",
          statusRaw: "succeeded",
          statusNormalized: "completed",
          argsPreview: `src/file-${toolCallIndex + 1}.ts`,
          resultPreview: `Loaded file ${toolCallIndex + 1}`,
          source: {
            eventId
          },
          confidence: CONFIRMED_CONFIDENCE
        });
        toolCallIds.push(toolCallId);
        eventIds.push(eventId);
        order += 1;
      }

      for (
        let shellCommandIndex = 0;
        shellCommandIndex < config.shellCommandsPerSession;
        shellCommandIndex += 1
      ) {
        const eventId = `${sessionId}-event-shell-command-${pad(shellCommandIndex + 1)}`;
        const shellCommandId = `${sessionId}-shell-command-${pad(shellCommandIndex + 1)}`;
        const command = shellCommandIndex === 0 ? "npm test" : "npm run typecheck";

        events.push({
          id: eventId,
          entityType: "session-event",
          adapterId,
          sourceId,
          sessionId,
          kind: "shell-command",
          actor: "tool",
          timestamp: timestampFor(sourceIndex, sessionIndex, order),
          orderKey: orderKey(order),
          title: command,
          text: `Shell command ${shellCommandIndex + 1} for ${sessionId}`
        });
        shellCommands.push({
          id: shellCommandId,
          entityType: "shell-command-evidence",
          adapterId,
          sourceId,
          sessionId,
          command,
          cwd: rootPath,
          outputInline: `Completed ${command}`,
          rawStatus: "succeeded",
          rawExitCode: 0,
          source: {
            eventId
          },
          confidence: CONFIRMED_CONFIDENCE
        });
        parsedShellCommands.push({
          shellCommandId,
          command,
          cwd: rootPath,
          intent: shellCommandIndex === 0 ? "test" : "typecheck",
          result: "passed",
          outputSource: "combined",
          outputTextSource: "summary",
          exitCode: 0,
          exitCodeSource: "evidence",
          failureMarkers: [],
          confidence: CONFIRMED_CONFIDENCE
        });
        shellCommandIds.push(shellCommandId);
        eventIds.push(eventId);
        order += 1;
      }

      for (
        let artifactIndex = 0;
        artifactIndex < config.outputArtifactsPerSession;
        artifactIndex += 1
      ) {
        const eventId = `${sessionId}-event-output-artifact-${pad(artifactIndex + 1)}`;
        const outputArtifactId = `${sessionId}-output-artifact-${pad(artifactIndex + 1)}`;
        const rawArtifactId = `${sessionId}-raw-output-artifact-${pad(artifactIndex + 1)}`;
        const relativePath = `artifacts/${outputArtifactId}.txt`;
        const preview = `Preview text for ${outputArtifactId}`;

        events.push({
          id: eventId,
          entityType: "session-event",
          adapterId,
          sourceId,
          sessionId,
          kind: "tool-result",
          actor: "tool",
          timestamp: timestampFor(sourceIndex, sessionIndex, order),
          orderKey: orderKey(order),
          title: "Output artifact",
          text: `Output artifact ${artifactIndex + 1} for ${sessionId}`
        });
        outputArtifacts.push({
          id: outputArtifactId,
          entityType: "output-artifact",
          adapterId,
          sourceId,
          sessionId,
          nativeRef: `native-${outputArtifactId}`,
          path: relativePath,
          kind: "sidecar",
          contentKind: "plain-text",
          mediaType: "text/plain",
          preview,
          loaded: false,
          source: {
            eventId,
            rawArtifactId
          },
          confidence: CONFIRMED_CONFIDENCE,
          diagnosticIds: []
        });
        rawArtifactEntries.push({
          id: rawArtifactId,
          adapterId,
          sourceId,
          nativeRef: `native-${outputArtifactId}`,
          nativeId: `native-${outputArtifactId}`,
          path: path.join(rootPath, relativePath),
          artifactKind: "output-artifact",
          artifactType: "output-artifact",
          mediaType: "text/plain",
          sizeBytes: preview.length,
          byteLength: preview.length,
          mtime: timestampFor(sourceIndex, sessionIndex, order),
          mtimeMs: Date.parse(timestampFor(sourceIndex, sessionIndex, order)),
          inode: `${sourceNumber}-${sessionNumber}-${artifactIndex + 1}`,
          parseStrategy: "text",
          parserVersion: "fixture-parser",
          adapterVersion: "fixture-adapter",
          schemaVersion: "2",
          diagnosticsHash: `diagnostics-${outputArtifactId}`
        });
        outputArtifactIds.push(outputArtifactId);
        eventIds.push(eventId);
        order += 1;

        if (!targetOutputArtifactId) {
          targetOutputArtifactId = outputArtifactId;
          targetOutputArtifactPreview = preview;
        }
      }

      const fileEventId = `${sessionId}-event-file-mutation`;
      const fileMutationId = `${sessionId}-file-mutation`;

      events.push({
        id: fileEventId,
        entityType: "session-event",
        adapterId,
        sourceId,
        sessionId,
        kind: "file-event",
        actor: "tool",
        timestamp: timestampFor(sourceIndex, sessionIndex, order),
        orderKey: orderKey(order),
        title: "Updated src/main/app/session-view-model-service.ts",
        text: "Updated a production seam."
      });
      fileMutations.push({
        id: fileMutationId,
        entityType: "file-mutation",
        adapterId,
        sourceId,
        sessionId,
        path: "src/main/app/session-view-model-service.ts",
        mutationKind: "updated",
        source: {
          eventId: fileEventId
        },
        confidence: CONFIRMED_CONFIDENCE,
        diagnosticIds: []
      });
      fileMutationIds.push(fileMutationId);
      eventIds.push(fileEventId);

      for (
        let diagnosticIndex = 0;
        diagnosticIndex < config.diagnosticsPerSession;
        diagnosticIndex += 1
      ) {
        diagnostics.push({
          id: `${sessionId}-diagnostic-${pad(diagnosticIndex + 1)}`,
          code: "fixture.hydration",
          message: `Fixture diagnostic ${diagnosticIndex + 1} for ${sessionId}`,
          severity: diagnosticIndex === 0 ? "warning" : "info",
          scope: "session",
          adapterId,
          sourceId,
          relatedEntityIds: [sessionId],
          confidence: CONFIRMED_CONFIDENCE,
          metadata: {
            sessionId: nativeSessionId
          }
        });
      }

      sessions.push({
        id: sessionId,
        entityType: "session",
        adapterId,
        sourceId,
        nativeSessionId,
        projectId,
        title: `Fixture Session ${sourceNumber}-${sessionNumber}`,
        firstUserPrompt: `Investigate hydration seam for ${sessionId}`,
        latestUserPrompt: `Follow up for ${sessionId}`,
        startedAt,
        lastUpdatedAt,
        durationMs: targetTimelineEntryCount * 1_000,
        lifecycleStatus: "completed",
        capabilities: DEFAULT_CAPABILITIES,
        messageIds,
        eventIds,
        toolCallIds,
        fileMutationIds,
        shellCommandIds,
        outputArtifactIds,
        usage: {
          inputTokens: 120,
          outputTokens: 80,
          totalTokens: 200
        },
        confidence: CONFIRMED_CONFIDENCE
      });
      derivedSessions.push({
        sessionId,
        shellCommands: parsedShellCommands
      });

      if (!targetSourceId) {
        targetSourceId = sourceId;
        targetSessionId = sessionId;
      } else if (!unrelatedSessionId && sourceId !== targetSourceId) {
        unrelatedSourceId = sourceId;
        unrelatedSessionId = sessionId;
      }
    }

    const latestSession = sessions[0];
    const project: Project = {
      id: projectId,
      entityType: "project",
      adapterId,
      sourceId,
      displayName: `Fixture Project ${sourceNumber}`,
      primaryRootPath: rootPath,
      rootConfidence: "confirmed",
      sessionIds: sessions.map((session) => session.id),
      latestActivityAt: latestSession?.lastUpdatedAt ?? timestampFor(sourceIndex, 0, 0),
      latestPrompt: latestSession?.latestUserPrompt ?? `Fixture Project ${sourceNumber}`,
      latestVerificationState: "unknown",
      confidence: CONFIRMED_CONFIDENCE,
      name: `Fixture Project ${sourceNumber}`,
      rootPath
    };

    records.push({
      cacheKey: `cache-${sourceId}`,
      adapterId,
      sourceId,
      artifactFingerprint: `fingerprint-${sourceId}`,
      createdAt: timestampFor(sourceIndex, 0, 0),
      updatedAt: timestampFor(
        sourceIndex,
        config.sessionsPerSource - 1,
        targetTimelineEntryCount + 10
      ),
      normalized: {
        adapterId,
        sourceId,
        capabilities: {
          adapter: {
            adapterId,
            capabilities: DEFAULT_CAPABILITIES
          },
          source: {
            adapterId,
            sourceId,
            capabilities: DEFAULT_CAPABILITIES
          },
          sessions: sessions.map((session) => ({
            adapterId,
            sourceId,
            sessionId: session.id,
            capabilities: DEFAULT_CAPABILITIES
          }))
        },
        projects: [project],
        sessions,
        events,
        messages,
        toolCalls,
        shellCommands,
        outputArtifacts,
        fileMutations,
        diagnostics
      },
      derived: {
        version: 1,
        sessions: derivedSessions
      }
    });

    sources.push({
      sourceId,
      adapterId,
      displayName: `Fixture Source ${sourceNumber}`,
      rootPath,
      enabled: true,
      sourceKind: "local-root",
      addedBy: "user",
      readOnly: false,
      validation: {
        status: "valid",
        diagnostics: [],
        normalizedPath: rootPath,
        updatedAt: timestampFor(sourceIndex, 0, 0)
      },
      scan: {
        status: "cached",
        diagnostics: [],
        artifactCount: rawArtifactEntries.filter((entry) => entry.sourceId === sourceId).length,
        sessionCount: sessions.length,
        updatedAt: timestampFor(sourceIndex, config.sessionsPerSource - 1, targetTimelineEntryCount)
      },
      cache: {
        status: "cached",
        diagnostics: [],
        cacheKey: `cache-${sourceId}`,
        updatedAt: timestampFor(
          sourceIndex,
          config.sessionsPerSource - 1,
          targetTimelineEntryCount + 10
        )
      },
      watch: {
        status: "unknown",
        scopePaths: [rootPath]
      },
      diagnostics: [],
      createdAt: timestampFor(sourceIndex, 0, 0),
      updatedAt: timestampFor(
        sourceIndex,
        config.sessionsPerSource - 1,
        targetTimelineEntryCount + 10
      )
    });
  }

  if (!unrelatedSourceId) {
    unrelatedSourceId = targetSourceId;
    unrelatedSessionId = targetSessionId;
  }

  return {
    records,
    rawArtifactEntries,
    sources,
    target: {
      sourceId: targetSourceId,
      sessionId: targetSessionId,
      outputArtifactId: targetOutputArtifactId,
      outputArtifactPreview: targetOutputArtifactPreview,
      timelineEntryCount: targetTimelineEntryCount
    },
    unrelated: {
      sourceId: unrelatedSourceId,
      sessionId: unrelatedSessionId
    },
    summary: {
      ...summarizeHydratedRecords(records),
      rawArtifactEntryCount: rawArtifactEntries.length
    }
  };
}

export function summarizeHydratedRecords(
  records: NormalizedCacheRecord[]
): LargeSourceHydrationSummary {
  return {
    sourceCount: records.length,
    sessionCount: records.reduce(
      (count, record) => count + record.normalized.sessions.length,
      0
    ),
    eventCount: records.reduce(
      (count, record) => count + record.normalized.events.length,
      0
    ),
    messageCount: records.reduce(
      (count, record) => count + record.normalized.messages.length,
      0
    ),
    toolCallCount: records.reduce(
      (count, record) => count + record.normalized.toolCalls.length,
      0
    ),
    shellCommandCount: records.reduce(
      (count, record) => count + record.normalized.shellCommands.length,
      0
    ),
    outputArtifactCount: records.reduce(
      (count, record) => count + record.normalized.outputArtifacts.length,
      0
    ),
    fileMutationCount: records.reduce(
      (count, record) => count + record.normalized.fileMutations.length,
      0
    ),
    diagnosticCount: records.reduce(
      (count, record) => count + record.normalized.diagnostics.length,
      0
    )
  };
}

function timestampFor(sourceIndex: number, sessionIndex: number, order: number): string {
  return new Date(
    Date.UTC(2026, 4, 25, 12, sourceIndex, sessionIndex * 10 + order)
  ).toISOString();
}

function orderKey(order: number): string {
  return `order-${pad(order + 1, 4)}`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}
