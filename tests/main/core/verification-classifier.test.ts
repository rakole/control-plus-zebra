import { describe, expect, it } from "vitest";

import type { CapabilityEnvelope } from "../../../src/main/core/model/capabilities.js";
import { HIGH_CONFIDENCE, LOW_CONFIDENCE, MEDIUM_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import type { Session, SessionMessage } from "../../../src/main/core/model/entities.js";
import { deriveVerificationForSession } from "../../../src/main/core/verification/verification-classifier.js";
import type { ParsedShellCommand } from "../../../src/main/core/shell/types.js";

function createCapabilities(status: "supported" | "unsupported" | "unknown"): CapabilityEnvelope {
  return {
    adapterId: "fake-test",
    sourceId: "source-01",
    capabilities: {
      discovery: {
        defaultRoots: true,
        projectRootMapping: "native",
        stableProjectId: true,
        stableSessionId: true
      },
      replay: {
        transcriptReplay: false,
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
        shellCommands: status === "supported",
        shellOutputs: status === "supported",
        sidecarOutputs: true
      },
      usage: {
        modelNames: true,
        tokenCounts: false,
        costEstimates: false
      },
      live: {
        activeSessionDetection: "none",
        watchableArtifacts: false,
        incrementalParsing: false
      },
      audit: {
        agentClaimDetection: true,
        finalAnswerDetection: true,
        shellExitCodeEvidence: status === "supported",
        verificationCommandEvidence: status === "supported"
      },
      export: {
        rawArtifactExport: true,
        normalizedExport: true
      }
    }
  };
}

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    kind: "session",
    id: "session-01",
    adapterId: "fake-test",
    sourceId: "source-01",
    nativeId: "native-session-01",
    lifecycleStatus: "completed",
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    kind: "session-message",
    id: "message-01",
    adapterId: "fake-test",
    sourceId: "source-01",
    sessionId: "session-01",
    nativeId: "native-message-01",
    role: "assistant",
    text: "I completed the change and validated it.",
    eventIds: ["event-01"],
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createShellCommand(
  overrides: Partial<ParsedShellCommand> = {},
  options: { includeDefaultExitCode?: boolean } = {}
): ParsedShellCommand {
  const includeDefaultExitCode = options.includeDefaultExitCode ?? true;

  return {
    shellCommandId: "shell-01",
    command: "npm run test",
    intent: "test",
    result: "passed",
    outputSource: "combined",
    outputTextSource: "artifact",
    ...(includeDefaultExitCode ? { exitCode: 0 } : {}),
    exitCodeSource: "evidence",
    failureMarkers: [],
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

describe("verification classifier", () => {
  it("only consumes qualifying verification intents", () => {
    const result = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("supported"),
      parsedShellCommands: [
        createShellCommand({ shellCommandId: "install-01", command: "npm install", intent: "install" }),
        createShellCommand({ shellCommandId: "git-01", command: "git status", intent: "git" }),
        createShellCommand({ shellCommandId: "typecheck-01", command: "npm run typecheck", intent: "typecheck" })
      ],
      session: createSession(),
      sessionMessages: [createMessage()]
    });

    expect(result.status).toBe("passed");
    expect(result.intentResults).toEqual([
      expect.objectContaining({
        intent: "typecheck",
        latestCommandId: "typecheck-01"
      })
    ]);
  });

  it("uses the latest result per verification intent while preserving earlier attempts", () => {
    const result = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("supported"),
      parsedShellCommands: [
        createShellCommand({
          shellCommandId: "test-fail-01",
          command: "npm run test",
          intent: "test",
          result: "failed",
          exitCode: 1,
          confidence: HIGH_CONFIDENCE
        }),
        createShellCommand({
          shellCommandId: "test-pass-02",
          command: "npm run test",
          intent: "test",
          result: "passed",
          exitCode: 0,
          confidence: HIGH_CONFIDENCE
        })
      ],
      session: createSession(),
      sessionMessages: [createMessage()]
    });

    expect(result.status).toBe("passed");
    expect(result.intentResults).toEqual([
      expect.objectContaining({
        intent: "test",
        latestCommandId: "test-pass-02",
        commandIds: ["test-fail-01", "test-pass-02"],
        latestStatus: "passed"
      })
    ]);
  });

  it("keeps verification unknown when raw tool success has no usable shell outcome", () => {
    const result = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("supported"),
      parsedShellCommands: [
        createShellCommand({
          shellCommandId: "test-unknown-01",
          command: "npm run test",
          intent: "test",
          result: "passed",
          exitCodeSource: "unknown",
          outputTextSource: "missing",
          rawToolStatus: "succeeded",
          confidence: LOW_CONFIDENCE
        }, { includeDefaultExitCode: false })
      ],
      session: createSession(),
      sessionMessages: [createMessage()]
    });

    expect(result).toMatchObject({
      status: "unknown",
      confidence: LOW_CONFIDENCE
    });
    expect(result.intentResults).toEqual([
      expect.objectContaining({
        intent: "test",
        latestCommandId: "test-unknown-01",
        latestStatus: "unknown"
      })
    ]);
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["output-missing"]));
  });

  it("does not hide an unknown verification intent behind another passed intent", () => {
    const result = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("supported"),
      parsedShellCommands: [
        createShellCommand({
          shellCommandId: "test-pass-01",
          command: "npm run test",
          intent: "test",
          result: "passed",
          exitCode: 0,
          confidence: HIGH_CONFIDENCE
        }),
        createShellCommand({
          shellCommandId: "typecheck-unknown-01",
          command: "npm run typecheck",
          intent: "typecheck",
          result: "unknown",
          exitCodeSource: "unknown",
          outputTextSource: "missing",
          rawToolStatus: "succeeded",
          confidence: LOW_CONFIDENCE
        }, { includeDefaultExitCode: false })
      ],
      session: createSession(),
      sessionMessages: [createMessage()]
    });

    expect(result.status).toBe("unknown");
    expect(result.intentResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          intent: "test",
          latestStatus: "passed"
        }),
        expect.objectContaining({
          intent: "typecheck",
          latestStatus: "unknown"
        })
      ])
    );
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["output-missing"]));
  });

  it("marks completed runs with a terminal assistant response and no qualifying commands as not-run", () => {
    const result = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("supported"),
      parsedShellCommands: [],
      session: createSession(),
      sessionMessages: [createMessage()]
    });

    expect(result).toMatchObject({
      status: "not-run",
      reasonCodes: ["no-qualifying-commands"],
      confidence: HIGH_CONFIDENCE
    });
  });

  it("resolves missing shell capability to unsupported instead of passed", () => {
    const unsupported = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("unsupported"),
      parsedShellCommands: [],
      session: createSession(),
      sessionMessages: [createMessage()]
    });
    const unknown = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("unknown"),
      parsedShellCommands: [],
      session: createSession(),
      sessionMessages: [createMessage({ role: "user", text: "Still working?" })]
    });

    expect(unsupported.status).toBe("unsupported");
    expect(unknown.status).toBe("unsupported");
  });

  it("keeps explicit failures failed while surfacing parser-warning and output-missing reasons", () => {
    const result = deriveVerificationForSession({
      adapterCapabilities: createCapabilities("supported"),
      parsedShellCommands: [
        createShellCommand({
          shellCommandId: "typecheck-01",
          command: "npm run typecheck",
          intent: "typecheck",
          result: "failed",
          exitCode: 1,
          outputTextSource: "missing",
          confidence: LOW_CONFIDENCE,
          diagnosticIds: ["diag-01"]
        })
      ],
      session: createSession(),
      sessionMessages: [createMessage()]
    });

    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["output-missing", "parser-warning"]));
    expect(result.confidence).toBe(MEDIUM_CONFIDENCE);
  });
});
