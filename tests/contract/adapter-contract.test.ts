import { expect } from "vitest";

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
import { capabilityState } from "../../src/main/core/model/capabilities.js";
import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE } from "../../src/main/core/model/confidence.js";

import { runAdapterContractSuite } from "./run-adapter-contract.js";

const stubCapabilities = {
  sessionDiscovery: capabilityState("supported"),
  liveSessionObservation: capabilityState("unsupported", "Static contract proof."),
  eventStreaming: capabilityState("unsupported", "The stub returns one parsed artifact."),
  messageCapture: capabilityState("supported"),
  toolCallCapture: capabilityState("supported"),
  shellCommandCapture: capabilityState("supported"),
  outputArtifactCapture: capabilityState("supported"),
  fileMutationCapture: capabilityState("supported"),
  sourceValidation: capabilityState("supported"),
  watchPlans: capabilityState("unsupported", "Watch plans are not part of the stub."),
  gitContextCapture: capabilityState("unsupported", "The stub does not emit git evidence."),
  githubContextCapture: capabilityState("unsupported", "The stub does not emit GitHub evidence."),
  verificationSignals: capabilityState(
    "unknown",
    "Verification remains a shared-core concern."
  )
};

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

const stubSourceId = "source_stub-contract";
const stubSessionId = "session_stub-contract";
const stubProjectId = "project_stub-contract";
const stubEventId = "session-event_stub-contract-message";
const stubMessageId = "session-message_stub-contract-message";
const stubToolCallId = "tool-call_stub-contract-write";
const stubShellCommandId = "shell-command_stub-contract-typecheck";
const stubArtifactEntityId = "output-artifact_stub-contract-note";
const stubFileMutationId = "file-mutation_stub-contract-entities";
const stubArtifactRefId = "raw-artifact_stub-contract";

const stubAdapter: SessionSourceAdapter<StubRawEvent> = {
  descriptor: {
    id: "stub-contract",
    displayName: "Stub Contract Harness",
    vendor: "Agent Workbench",
    adapterVersion: "0.1.0",
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultRoots: [
      {
        path: "tests/fixtures/stub-contract/session.fixture.json",
        label: "Stub contract fixture",
        kind: "file"
      }
    ],
    capabilities: stubCapabilities
  },
  async validateSourceRoot(root: SourceRootConfig): Promise<SourceRootValidation> {
    return {
      ok: true,
      normalizedPath: root.rootPath,
      diagnostics: [],
      capabilities: stubCapabilities
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
      id: stubArtifactRefId,
      adapterId: "stub-contract",
      sourceId: source.id,
      nativeId: "stub-artifact",
      path: source.rootPath,
      artifactType: "stub-session-fixture",
      mediaType: "application/json"
    };
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
          capabilities: stubCapabilities
        },
        source: {
          adapterId: "stub-contract",
          sourceId: input.source.id,
          capabilities: stubCapabilities
        },
        sessions: [
          {
            adapterId: "stub-contract",
            sourceId: input.source.id,
            sessionId: stubSessionId,
            capabilities: stubCapabilities
          }
        ]
      },
      projects: [
        {
          kind: "project",
          id: stubProjectId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          nativeId: "project-01",
          name: "stub-project",
          confidence: HIGH_CONFIDENCE
        }
      ],
      sessions: [
        {
          kind: "session",
          id: stubSessionId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          nativeId: "session-01",
          projectId: stubProjectId,
          title: "Stub contract proof",
          startedAt: "2026-05-23T10:00:00.000Z",
          lifecycleState: "completed",
          confidence: HIGH_CONFIDENCE
        }
      ],
      events: [
        {
          kind: "session-event",
          id: stubEventId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeId: "evt-01",
          eventKind: "message",
          timestamp: "2026-05-23T10:00:01.000Z",
          ordinal: 1,
          summary: "assistant message",
          messageId: stubMessageId,
          confidence: HIGH_CONFIDENCE
        }
      ],
      messages: [
        {
          kind: "session-message",
          id: stubMessageId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeId: "evt-01",
          role: "assistant",
          content: "Stub adapter contract normalized successfully.",
          ordinal: 1,
          timestamp: "2026-05-23T10:00:01.000Z",
          eventId: stubEventId,
          confidence: HIGH_CONFIDENCE
        }
      ],
      toolCalls: [
        {
          kind: "tool-call",
          id: stubToolCallId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeId: "tool-01",
          toolName: "write_file",
          status: "succeeded",
          startedAt: "2026-05-23T10:00:02.000Z",
          inputSummary: "Created the shared contract harness.",
          outputSummary: "Harness file written.",
          artifactIds: [stubArtifactEntityId],
          fileMutationIds: [stubFileMutationId],
          confidence: HIGH_CONFIDENCE
        }
      ],
      shellCommands: [
        {
          kind: "shell-command",
          id: stubShellCommandId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeId: "cmd-01",
          command: "npm run test -- tests/contract",
          outputSource: "combined",
          exitCode: 0,
          startedAt: "2026-05-23T10:00:03.000Z",
          outputSummary: "Contract tests passed.",
          confidence: HIGH_CONFIDENCE
        }
      ],
      outputArtifacts: [
        {
          kind: "output-artifact",
          id: stubArtifactEntityId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeId: "artifact-01",
          artifactKind: "text",
          path: "artifacts/contract-note.txt",
          mediaType: "text/plain",
          byteLength: 64,
          confidence: HIGH_CONFIDENCE
        }
      ],
      fileMutations: [
        {
          kind: "file-mutation",
          id: stubFileMutationId,
          adapterId: "stub-contract",
          sourceId: input.source.id,
          sessionId: stubSessionId,
          nativeId: "mutation-01",
          path: "tests/contract/run-adapter-contract.ts",
          mutationKind: "created",
          toolCallId: stubToolCallId,
          confidence: HIGH_CONFIDENCE
        }
      ],
      diagnostics: [
        buildDiagnostic(
          "stub-contract",
          "stub-contract.fixture.warning",
          "The reusable contract harness is validated with a stub adapter first.",
          "warning",
          "source",
          MEDIUM_CONFIDENCE,
          {
            sourceId: input.source.id,
            nativeId: "diagnostic-01"
          }
        )
      ]
    };
  },
  loadOutputArtifact(artifact) {
    return Promise.resolve({
      artifact,
      text: "Harness note"
    });
  }
};

runAdapterContractSuite({
  name: "reusable contract harness",
  adapter: stubAdapter,
  root: {
    rootPath: "tests/fixtures/stub-contract/session.fixture.json",
    displayName: "Stub contract source"
  },
  expectedCapabilityStatuses: {
    liveSessionObservation: "unsupported",
    eventStreaming: "unsupported",
    watchPlans: "unsupported",
    verificationSignals: "unknown"
  },
  expectedDiagnosticCodes: ["stub-contract.fixture.warning"],
  minimums: {
    messages: 1,
    toolCalls: 1,
    shellCommands: 1,
    outputArtifacts: 1,
    fileMutations: 1,
    diagnostics: 1
  },
  assertExercisedAdapter(adapterRun) {
    if (!adapterRun.validation.ok) {
      throw new Error("Expected the stub adapter validation to succeed.");
    }

    if (!adapterRun.validation.capabilities) {
      throw new Error("Expected validation capabilities for the stub adapter.");
    }
  },
  assertNormalized(normalized) {
    expect(normalized.sessions[0]?.projectId).toBe(stubProjectId);
    expect(normalized.messages[0]?.eventId).toBe(stubEventId);
    expect(normalized.toolCalls[0]?.artifactIds).toEqual([stubArtifactEntityId]);
    expect(normalized.fileMutations[0]?.toolCallId).toBe(stubToolCallId);
  }
});
