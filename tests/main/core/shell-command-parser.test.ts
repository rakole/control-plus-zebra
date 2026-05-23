import { describe, expect, it } from "vitest";

import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import type { ShellCommandEvidence } from "../../../src/main/core/model/entities.js";
import { parseShellCommandEvidence } from "../../../src/main/core/shell/shell-command-parser.js";
import {
  classifyShellIntent,
  extractExitCodeFromText,
  type ParsedShellCommand
} from "../../../src/main/core/shell/index.js";

function createShellCommand(overrides: Partial<ShellCommandEvidence> = {}): ShellCommandEvidence {
  return {
    kind: "shell-command",
    id: "shell-command-01",
    adapterId: "fake-test",
    sourceId: "source-01",
    sessionId: "session-01",
    nativeId: "native-shell-01",
    command: "npm run typecheck",
    outputSource: "combined",
    eventId: "event-01",
    confidence: HIGH_CONFIDENCE,
    ...overrides
  };
}

describe("shared shell command parser", () => {
  it("classifies verification, install, git, and unknown command intents", () => {
    expect(classifyShellIntent("npm run test -- tests/main/core/scanner-cache.test.ts")).toBe("test");
    expect(classifyShellIntent("pnpm run build")).toBe("build");
    expect(classifyShellIntent("tsc --noEmit")).toBe("typecheck");
    expect(classifyShellIntent("eslint .")).toBe("lint");
    expect(classifyShellIntent("npm install")).toBe("install");
    expect(classifyShellIntent("git status --short")).toBe("git");
    expect(classifyShellIntent("echo hello")).toBe("other");
    expect(classifyShellIntent("   ")).toBe("unknown");
  });

  it("extracts explicit exit codes from shell output text", () => {
    expect(extractExitCodeFromText("Command failed with exit code 2")).toBe(2);
    expect(extractExitCodeFromText("Process exited with code 17 after 5s")).toBe(17);
    expect(extractExitCodeFromText("> npm run typecheck\n\nTypecheck passed.")).toBeUndefined();
  });

  it("keeps explicit nonzero shell exit codes authoritative over raw tool success", () => {
    const parsed = parseShellCommandEvidence({
      shellCommand: createShellCommand({
        exitCode: 1,
        rawToolStatus: "succeeded",
        toolCallId: "tool-call-01",
        artifactIds: ["artifact-01"],
        outputSummary: "Typecheck passed"
      })
    });

    expect(parsed).toMatchObject<Partial<ParsedShellCommand>>({
      shellCommandId: "shell-command-01",
      intent: "typecheck",
      result: "failed",
      exitCode: 1,
      exitCodeSource: "evidence",
      rawToolStatus: "succeeded",
      toolCallId: "tool-call-01",
      artifactIds: ["artifact-01"]
    });
  });
});
