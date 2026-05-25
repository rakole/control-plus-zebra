import { describe, expect, it } from "vitest";

import type {
  AdapterNormalizationInput,
  AdapterNormalizationResult,
  DiscoveredHarnessSource,
  RawArtifactRef,
  RawHarnessEvent,
  SessionSourceAdapter,
  SourceRootConfig,
  SourceRootValidation
} from "../../src/main/core/adapter-contract/index.js";
import { buildDiagnostic } from "../../src/main/core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../src/main/core/model/confidence.js";

import {
  exerciseAdapter,
  runAdapterContractSuite,
  type AdapterScenarioManifestEntry
} from "./run-adapter-contract.js";

type StubRawPayload =
  | {
      kind: "metadata";
    }
  | {
      kind: "timeline-message";
      role: "assistant" | "user";
      text: string;
    };

type StubRawEvent = RawHarnessEvent<StubRawPayload>;

const groupedCapabilities = {
  discovery: {
    defaultRoots: true,
    projectRootMapping: "native",
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
    fileReads: false,
    fileSearches: false,
    fileMutations: true,
    diffStats: false,
    shellCommands: true,
    shellOutputs: true,
    sidecarOutputs: true
  },
  usage: {
    modelNames: false,
    tokenCounts: false,
    costEstimates: false
  },
  live: {
    activeSessionDetection: "none",
    watchableArtifacts: false,
    incrementalParsing: false
  },
  audit: {
    agentClaimDetection: false,
    finalAnswerDetection: true,
    shellExitCodeEvidence: true,
    verificationCommandEvidence: true
  },
  export: {
    rawArtifactExport: false,
    normalizedExport: true
  }
} as const;

const stubSourceId = "source:stub-contract";
const stubSessionId = "session:stub-contract";
const stubProjectId = "project:stub-contract";
const stubArtifactId = "raw-artifact:stub-contract-fixture";
const stubOutputArtifactId = "output-artifact:stub-contract-note";
const stubEventId = "session-event:stub-contract-message";
const stubMessageId = "session-message:stub-contract-message";
const stubToolCallId = "tool-call:stub-contract-write";
const stubShellCommandId = "shell-command:stub-contract-typecheck";
const stubFileMutationId = "file-mutation:stub-contract-entities";

const stubAdapter = {
  descriptor: {
    id: "stub-contract",
    displayName: "Stub Contract Harness",
    vendor: "Agent Workbench",
    adapterVersion: "0.2.0",
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultRoots: [
      {
        path: "tests/fixtures/stub-contract/session.fixture.json",
        label: "Stub contract fixture",
        kind: "file"
      }
    ]
  },
  async getDefaultSourceRoots() {
    return [
      {
        path: "tests/fixtures/stub-contract/session.fixture.json",
        label: "Stub contract fixture",
        kind: "file"
      }
    ];
  },
  async validateSourceRoot(root: SourceRootConfig): Promise<SourceRootValidation> {
    return {
      ok: true,
      normalizedPath: root.rootPath,
      diagnostics: []
    };
  },
  async *discoverSources(root: SourceRootConfig): AsyncIterable<DiscoveredHarnessSource> {
    yield {
      id: stubSourceId,
      adapterId: "stub-contract",
      nativeId: root.rootPath,
      rootPath: root.rootPath,
      displayName: "Stub contract source",
      confidence: HIGH_CONFIDENCE,
      metadata: {
        sourceKind: "stub"
      }
    };
  },
  async *discoverArtifacts(source: DiscoveredHarnessSource): AsyncIterable<RawArtifactRef> {
    yield {
      id: stubArtifactId,
      adapterId: "stub-contract",
      sourceId: source.id,
      path: source.rootPath,
      nativeRef: "stub-artifact",
      artifactKind: "session-log",
      parseStrategy: "json"
    } as unknown as RawArtifactRef;
  },
  async *parseArtifact(artifact: RawArtifactRef): AsyncIterable<StubRawEvent> {
    yield {
      id: `${artifact.id}:metadata`,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      artifactId: artifact.id,
      kind: "stub.metadata",
      payload: {
        kind: "metadata"
      }
    };

    yield {
      id: `${artifact.id}:message`,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      artifactId: artifact.id,
      kind: "stub.message",
      timestamp: "2026-05-23T10:00:01.000Z",
      payload: {
        kind: "timeline-message",
        role: "assistant",
        text: "Stub adapter contract normalized successfully."
      }
    };
  },
  async normalize(
    input: AdapterNormalizationInput<StubRawEvent>
  ): Promise<AdapterNormalizationResult> {
    return {
      adapterId: "stub-contract",
      sourceId: input.source.id,
      capabilities: {
        adapter: {
          adapterId: "stub-contract",
          capabilities: groupedCapabilities
        },
        source: {
          adapterId: "stub-contract",
          sourceId: input.source.id,
          capabilities: groupedCapabilities
        },
        sessions: [
          {
            adapterId: "stub-contract",
            sourceId: input.source.id,
            sessionId: stubSessionId,
            capabilities: groupedCapabilities
          }
        ]
      },
      projects: [
        {
          id: stubProjectId,
          displayName: "stub-project",
          primaryRootPath: input.source.rootPath,
          rootConfidence: "confirmed",
          harnessRefs: [
            {
              adapterId: "stub-contract",
              sourceId: input.source.id,
              nativeProjectId: "project-01",
              nativeProjectPath: input.source.rootPath,
              projectRootPath: input.source.rootPath,
              projectRootConfidence: "confirmed",
              rawArtifactRefs: [
                {
                  id: stubArtifactId,
                  adapterId: "stub-contract",
                  sourceId: input.source.id,
                  path: input.source.rootPath,
                  nativeRef: "stub-artifact",
                  artifactKind: "session-log",
                  parseStrategy: "json"
                }
              ]
            }
          ],
          sessionIds: [stubSessionId],
          latestActivityAt: "2026-05-23T10:00:03.000Z",
          latestPrompt: "Stub adapter contract normalized successfully.",
          diagnostics: []
        }
      ],
      sessions: [
        {
          id: stubSessionId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          nativeSessionId: "session-01",
          projectId: stubProjectId,
          title: "Stub contract proof",
          firstUserPrompt: "Stub adapter contract normalized successfully.",
          latestUserPrompt: "Stub adapter contract normalized successfully.",
          startedAt: "2026-05-23T10:00:00.000Z",
          lastUpdatedAt: "2026-05-23T10:00:03.000Z",
          durationMs: 3000,
          lifecycleStatus: "completed",
          attentionReasons: [],
          capabilities: groupedCapabilities,
          parseConfidence: "confirmed",
          messageIds: [stubMessageId],
          eventIds: [stubEventId],
          toolCallIds: [stubToolCallId],
          fileMutationIds: [stubFileMutationId],
          shellCommandIds: [stubShellCommandId],
          outputArtifactIds: [stubOutputArtifactId],
          usage: {},
          verification: {
            state: "unknown",
            commandsRun: 1,
            verificationCommandsRun: 1,
            buildRan: false,
            testsRan: false,
            typecheckRan: true,
            lintRan: false,
            failedCommandIds: [],
            passedCommandIds: [],
            summary: "Verification remains a shared-core concern.",
            confidence: "unknown",
            diagnostics: []
          },
          runAudit: {
            sessionId: stubSessionId,
            adapterId: "stub-contract",
            classification: "unknown",
            agentClaimedCompleted: "unknown",
            finalAnswerPresent: true,
            requestCancelled: false,
            verificationCommandsRun: true,
            shellExitCodes: [0],
            failedTestsDetected: false,
            attentionReasons: [],
            summary: "Run audit remains a shared-core concern.",
            confidence: "unknown",
            diagnostics: []
          },
          rawArtifactRefs: [
            {
              id: stubArtifactId,
              adapterId: "stub-contract",
              sourceId: input.source.id,
              path: input.source.rootPath,
              nativeRef: "stub-artifact",
              artifactKind: "session-log",
              parseStrategy: "json"
            }
          ],
          diagnostics: []
        }
      ],
      events: [
        {
          id: stubEventId,
          sessionId: stubSessionId,
          adapterId: "stub-contract",
          kind: "message",
          timestamp: "2026-05-23T10:00:01.000Z",
          orderKey: "000001:evt-01",
          actor: "assistant",
          title: "assistant message",
          text: "Stub adapter contract normalized successfully.",
          raw: {
            eventId: stubEventId,
            pointer: "message:evt-01"
          },
          diagnostics: []
        }
      ],
      messages: [
        {
          id: stubMessageId,
          sessionId: stubSessionId,
          adapterId: "stub-contract",
          role: "assistant",
          timestamp: "2026-05-23T10:00:01.000Z",
          text: "Stub adapter contract normalized successfully.",
          toolCallIds: [],
          eventIds: [stubEventId],
          source: {
            eventId: stubEventId,
            pointer: "message:evt-01"
          },
          confidence: "confirmed"
        }
      ],
      toolCalls: [
        {
          id: stubToolCallId,
          sessionId: stubSessionId,
          adapterId: "stub-contract",
          nativeToolCallId: "tool-01",
          name: "write_file",
          normalizedKind: "write",
          statusRaw: "succeeded",
          statusNormalized: "completed",
          argsPreview: "Created the shared contract harness.",
          resultPreview: "Harness file written.",
          outputArtifactIds: [stubOutputArtifactId],
          fileMutationId: stubFileMutationId,
          shellCommandId: stubShellCommandId,
          source: {
            eventId: stubEventId,
            pointer: "tool:tool-01"
          },
          confidence: "confirmed",
          diagnostics: []
        }
      ],
      shellCommands: [
        {
          id: stubShellCommandId,
          sessionId: stubSessionId,
          adapterId: "stub-contract",
          toolCallId: stubToolCallId,
          command: "npm run test -- tests/contract",
          cwd: "/workspace/stub-contract",
          outputInline: "Contract tests passed.",
          outputArtifactIds: [],
          rawStatus: "succeeded",
          rawExitCode: 0,
          source: {
            eventId: stubEventId,
            pointer: "shell:cmd-01"
          },
          confidence: "confirmed"
        }
      ],
      outputArtifacts: [
        {
          id: stubOutputArtifactId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeRef: "artifact-01",
          path: "artifacts/contract-note.txt",
          kind: "sidecar",
          contentKind: "plain-text",
          sizeBytes: 84,
          preview: "Harness file written.",
          loaded: false,
          source: {
            eventId: stubEventId,
            pointer: "artifact:artifact-01"
          },
          diagnostics: []
        }
      ],
      fileMutations: [
        {
          id: stubFileMutationId,
          sessionId: stubSessionId,
          adapterId: "stub-contract",
          path: "src/main/core/model/entities.ts",
          mutationKind: "created",
          toolCallId: stubToolCallId,
          source: {
            eventId: stubEventId,
            pointer: "file:mutation-01"
          },
          confidence: "confirmed",
          diagnostics: []
        }
      ],
      diagnostics: [
        buildDiagnostic(
          "stub-contract",
          "stub.partial-proof",
          "The stub covers the Wave 2 normalization surface only.",
          "warning",
          "source",
          HIGH_CONFIDENCE,
          {
            sourceId: input.source.id,
            nativeId: input.source.id
          }
        )
      ]
    } as unknown as AdapterNormalizationResult;
  },
  async getWatchPlan(source: DiscoveredHarnessSource) {
    return {
      adapterId: "stub-contract",
      sourceId: source.id,
      status: "supported",
      scopePaths: [source.rootPath],
      strategy: "poll"
    };
  }
} as unknown as SessionSourceAdapter<StubRawEvent>;

runAdapterContractSuite({
  name: "stub-contract",
  adapter: stubAdapter,
  root: {
    rootPath: "tests/fixtures/stub-contract/session.fixture.json",
    displayName: "Stub contract fixture"
  },
  expectedDiagnosticCodes: ["stub.partial-proof"],
  scenarios: [
    { name: "basic-session", status: "supported" },
    {
      name: "assistant-final-answer",
      status: "supported",
      capability: { group: "audit", key: "finalAnswerDetection" }
    },
    {
      name: "tool-call",
      status: "supported",
      capability: { group: "tools", key: "toolCalls" }
    },
    {
      name: "file-read",
      status: "unsupported",
      capability: { group: "tools", key: "fileReads" }
    },
    {
      name: "file-search",
      status: "unsupported",
      capability: { group: "tools", key: "fileSearches" }
    },
    {
      name: "file-mutation",
      status: "supported",
      capability: { group: "tools", key: "fileMutations" }
    },
    {
      name: "shell-command",
      status: "supported",
      capability: { group: "tools", key: "shellCommands" }
    },
    {
      name: "sidecar-output-artifact",
      status: "supported",
      capability: { group: "tools", key: "sidecarOutputs" }
    },
    {
      name: "model-name",
      status: "unsupported",
      capability: { group: "usage", key: "modelNames" }
    },
    {
      name: "token-usage",
      status: "unsupported",
      capability: { group: "usage", key: "tokenCounts" }
    },
    {
      name: "cost-estimates",
      status: "unsupported",
      capability: { group: "usage", key: "costEstimates" }
    },
    {
      name: "raw-pointers",
      status: "supported",
      capability: { group: "replay", key: "rawEventPointers" }
    },
    { name: "diagnostics", status: "supported" }
  ] satisfies AdapterScenarioManifestEntry[],
  assertExercisedAdapter(adapterRun) {
    expect(adapterRun.defaultRoots).toHaveLength(1);
    expect(adapterRun.watchPlan).toMatchObject({
      status: "supported",
      strategy: "poll"
    });
  },
  assertNormalized(normalized) {
    expect(normalized.sessions[0]).toMatchObject({
      lifecycleStatus: "completed",
      parseConfidence: "confirmed"
    });
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run test -- tests/contract",
      rawExitCode: 0
    });
  }
});

describe("adapter contract streaming seam", () => {
  it("prefers normalizeStream over legacy normalize when an adapter exposes both", async () => {
    const streamBatchSizes: number[] = [];
    const streamingAdapter: SessionSourceAdapter<StubRawEvent> = {
      ...stubAdapter,
      async normalize() {
        throw new Error("Legacy normalize should not run when normalizeStream is available.");
      },
      async normalizeStream(input, context) {
        streamBatchSizes.push(input.rawEvents.length);
        return stubAdapter.normalize(input, context);
      }
    };

    const exercised = await exerciseAdapter(streamingAdapter, {
      rootPath: "tests/fixtures/stub-contract/session.fixture.json",
      displayName: "Stub contract fixture"
    });

    expect(streamBatchSizes).toEqual([2]);
    expect(exercised.normalized.sessions[0]?.id).toBe(stubSessionId);
  });
});
