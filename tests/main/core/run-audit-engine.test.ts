import { describe, expect, it } from "vitest";

import { capabilityState, type CapabilityEnvelope } from "../../../src/main/core/model/capabilities.js";
import { HIGH_CONFIDENCE, LOW_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import type { Diagnostic } from "../../../src/main/core/diagnostics/diagnostic.js";
import type {
  Session,
  SessionEvent,
  SessionMessage,
  ToolCall
} from "../../../src/main/core/model/entities.js";
import type { ProjectGitSnapshot } from "../../../src/main/core/git/git-snapshot-provider.js";
import type { ParsedShellCommand } from "../../../src/main/core/shell/types.js";
import { deriveRunAuditForSession } from "../../../src/main/core/audit/run-audit-engine.js";
import type { VerificationResult } from "../../../src/main/core/verification/types.js";

function createCapabilities(gitStatus: "supported" | "unsupported" | "unknown"): CapabilityEnvelope {
  return {
    adapterId: "fake-test",
    sourceId: "source-01",
    capabilities: {
      sessionDiscovery: capabilityState("supported"),
      liveSessionObservation: capabilityState("unsupported"),
      eventStreaming: capabilityState("unsupported"),
      messageCapture: capabilityState("supported"),
      toolCallCapture: capabilityState("supported"),
      shellCommandCapture: capabilityState("supported"),
      outputArtifactCapture: capabilityState("supported"),
      fileMutationCapture: capabilityState("supported"),
      sourceValidation: capabilityState("supported"),
      watchPlans: capabilityState("unsupported"),
      gitContextCapture: capabilityState(gitStatus),
      githubContextCapture: capabilityState("unsupported"),
      verificationSignals: capabilityState("unknown")
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
    lifecycleState: "completed",
    confidence: HIGH_CONFIDENCE,
    diagnosticIds: [],
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
    content: "I completed the change and verified it.",
    ordinal: 2,
    timestamp: "2026-05-24T10:00:00.000Z",
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    kind: "session-event",
    id: "event-01",
    adapterId: "fake-test",
    sourceId: "source-01",
    sessionId: "session-01",
    nativeId: "native-event-01",
    eventKind: "message",
    ordinal: 2,
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createVerification(status: VerificationResult["status"]): VerificationResult {
  return {
    status,
    confidence: status === "unknown" ? LOW_CONFIDENCE : HIGH_CONFIDENCE,
    commandIds: status === "not-run" ? [] : ["shell-01"],
    intentResults: status === "not-run" ? [] : [],
    reasonCodes: status === "not-run" ? ["no-qualifying-commands"] : []
  };
}

function createShellCommand(overrides: Partial<ParsedShellCommand> = {}): ParsedShellCommand {
  return {
    shellCommandId: "shell-01",
    command: "npm run typecheck",
    intent: "typecheck",
    result: "passed",
    outputSource: "combined",
    outputTextSource: "artifact",
    exitCodeSource: "evidence",
    failureMarkers: [],
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    kind: "tool-call",
    id: "tool-call-01",
    adapterId: "fake-test",
    sourceId: "source-01",
    sessionId: "session-01",
    nativeId: "native-tool-01",
    toolName: "run_shell_command",
    status: "succeeded",
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    id: "diagnostic-01",
    code: "gemini-cli.normalize.missing-sidecar",
    message: "Missing sidecar.",
    severity: "warning",
    scope: "tool-call",
    adapterId: "fake-test",
    sourceId: "source-01",
    relatedEntityIds: ["session-01", "tool-call-01"],
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

function createProjectGitSnapshot(
  status: ProjectGitSnapshot["status"] = "available",
  overrides: Partial<ProjectGitSnapshot> = {}
): ProjectGitSnapshot {
  if (status === "available") {
    return {
      status,
      rootConfidence: "confirmed",
      candidateRootPath: "/tmp/control-plus-zebra",
      validatedRootPath: "/tmp/control-plus-zebra",
      diagnosticIds: [],
      snapshot: {
        additions: 0,
        branch: "main",
        changedFiles: 0,
        deletions: 0,
        dirty: false,
        headSha: "abc123",
        untrackedFiles: 0
      },
      ...overrides
    };
  }

  return {
    status,
    rootConfidence: "unknown",
    diagnosticIds: [],
    reason:
      status === "unsupported"
        ? "Shared read-only git is unavailable."
        : "Shared git snapshot could not be collected for this project.",
    ...overrides
  };
}

describe("run audit engine", () => {
  it("applies the documented status precedence order", () => {
    const baseArgs = {
      adapterCapabilities: createCapabilities("supported"),
      diagnostics: [] as Diagnostic[],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot(),
      sessionMessages: [createMessage()],
      sessionToolCalls: [createToolCall()],
      sourceCapabilities: createCapabilities("supported")
    };

    const active = deriveRunAuditForSession({
      ...baseArgs,
      session: createSession({ lifecycleState: "active" }),
      sessionEvents: [],
      sessionFileMutations: [],
      verification: createVerification("failed")
    });
    const cancelled = deriveRunAuditForSession({
      ...baseArgs,
      session: createSession({ lifecycleState: "cancelled" }),
      sessionEvents: [],
      sessionFileMutations: [],
      verification: createVerification("failed")
    });
    const verificationFailed = deriveRunAuditForSession({
      ...baseArgs,
      session: createSession(),
      sessionEvents: [],
      sessionFileMutations: [],
      verification: createVerification("failed")
    });
    const incomplete = deriveRunAuditForSession({
      ...baseArgs,
      session: createSession(),
      sessionEvents: [
        createEvent({ id: "message-event-01", messageId: "message-01", eventKind: "message", ordinal: 2 }),
        createEvent({ id: "tool-event-02", eventKind: "tool-call", ordinal: 3, toolCallId: "tool-call-01" })
      ],
      sessionFileMutations: [],
      verification: createVerification("passed")
    });
    const needsReview = deriveRunAuditForSession({
      ...baseArgs,
      diagnostics: [createDiagnostic()],
      session: createSession(),
      sessionEvents: [createEvent({ id: "message-event-01", messageId: "message-01" })],
      sessionFileMutations: [],
      verification: createVerification("passed")
    });
    const clean = deriveRunAuditForSession({
      ...baseArgs,
      session: createSession(),
      sessionEvents: [createEvent({ id: "message-event-01", messageId: "message-01" })],
      sessionFileMutations: [],
      sessionToolCalls: [],
      verification: createVerification("passed")
    });
    const unknown = deriveRunAuditForSession({
      ...baseArgs,
      session: createSession({ lifecycleState: "unknown" }),
      sessionEvents: [],
      sessionFileMutations: [],
      sessionMessages: [],
      sessionToolCalls: [],
      verification: createVerification("unknown")
    });

    expect(active.status).toBe("active");
    expect(cancelled.status).toBe("cancelled");
    expect(verificationFailed.status).toBe("verification-failed");
    expect(incomplete.status).toBe("incomplete");
    expect(needsReview.status).toBe("needs-review");
    expect(clean.status).toBe("clean");
    expect(unknown.status).toBe("unknown");
  });

  it("keeps failed verification as an attention reason when cancellation wins primary status", () => {
    const result = deriveRunAuditForSession({
      adapterCapabilities: createCapabilities("supported"),
      diagnostics: [],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot(),
      session: createSession({ lifecycleState: "cancelled" }),
      sessionEvents: [],
      sessionFileMutations: [],
      sessionMessages: [createMessage()],
      sessionToolCalls: [],
      verification: createVerification("failed")
    });

    expect(result.status).toBe("cancelled");
    expect(result.attentionReasons).toContain("failed-verification");
  });

  it("marks a claimed-complete run with later pending tool work as incomplete", () => {
    const result = deriveRunAuditForSession({
      adapterCapabilities: createCapabilities("supported"),
      diagnostics: [],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot(),
      session: createSession(),
      sessionEvents: [
        createEvent({ id: "message-event-01", messageId: "message-01", eventKind: "message", ordinal: 2 }),
        createEvent({ id: "tool-event-02", eventKind: "tool-call", ordinal: 3, toolCallId: "tool-call-02" })
      ],
      sessionFileMutations: [],
      sessionMessages: [createMessage()],
      sessionToolCalls: [createToolCall({ id: "tool-call-02", status: "started" })],
      verification: createVerification("passed")
    });

    expect(result.status).toBe("incomplete");
    expect(result.attentionReasons).toEqual(
      expect.arrayContaining(["pending-tool-calls", "post-claim-activity"])
    );
  });

  it("degrades parser warnings and capability gaps to needs-review when the run is otherwise classifiable", () => {
    const result = deriveRunAuditForSession({
      adapterCapabilities: createCapabilities("unsupported"),
      diagnostics: [createDiagnostic()],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot("unknown"),
      session: createSession(),
      sessionEvents: [createEvent({ id: "message-event-01", messageId: "message-01" })],
      sessionFileMutations: [],
      sessionMessages: [createMessage()],
      sessionToolCalls: [],
      verification: createVerification("passed")
    });

    expect(result.status).toBe("needs-review");
    expect(result.attentionReasons).toEqual(
      expect.arrayContaining(["missing-sidecar", "parser-warning", "capability-missing"])
    );
  });

  it("keeps clean runs clean when shared git evidence is available even if adapter git capture is unsupported", () => {
    const result = deriveRunAuditForSession({
      adapterCapabilities: createCapabilities("unsupported"),
      diagnostics: [],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot(),
      session: createSession(),
      sessionEvents: [createEvent({ id: "message-event-01", messageId: "message-01" })],
      sessionFileMutations: [],
      sessionMessages: [createMessage()],
      sessionToolCalls: [],
      verification: createVerification("passed")
    });

    expect(result.status).toBe("clean");
    expect(result.attentionReasons).not.toContain("capability-missing");
  });

  it("marks claimed-complete runs for review when shared git evidence shows dirty or untracked state", () => {
    const result = deriveRunAuditForSession({
      adapterCapabilities: createCapabilities("unsupported"),
      diagnostics: [],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot("available", {
        snapshot: {
          additions: 4,
          branch: "main",
          changedFiles: 2,
          deletions: 1,
          dirty: true,
          headSha: "def456",
          untrackedFiles: 1
        }
      }),
      session: createSession(),
      sessionEvents: [createEvent({ id: "message-event-01", messageId: "message-01" })],
      sessionFileMutations: [],
      sessionMessages: [createMessage()],
      sessionToolCalls: [],
      verification: createVerification("passed")
    });

    expect(result.status).toBe("needs-review");
    expect(result.attentionReasons).toContain("dirty-after-claim");
    expect(result.attentionReasons).not.toContain("capability-missing");
  });

  it("blocks clean when a claimed completion has no shared git assessment", () => {
    const result = deriveRunAuditForSession({
      adapterCapabilities: createCapabilities("supported"),
      diagnostics: [],
      parsedShellCommands: [createShellCommand()],
      projectGitSnapshot: createProjectGitSnapshot("unknown"),
      session: createSession(),
      sessionEvents: [createEvent({ id: "message-event-01", messageId: "message-01" })],
      sessionFileMutations: [],
      sessionMessages: [createMessage()],
      sessionToolCalls: [],
      verification: createVerification("passed")
    });

    expect(result.status).toBe("needs-review");
    expect(result.attentionReasons).toContain("capability-missing");
  });
});
