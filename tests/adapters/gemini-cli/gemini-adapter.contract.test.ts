import { expect } from "vitest";

import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import { runAdapterContractSuite } from "../../contract/run-adapter-contract.js";

import { geminiFixtureRoot } from "./test-helpers.js";

runAdapterContractSuite({
  name: "gemini-cli",
  adapter: geminiCliAdapter,
  root: {
    rootPath: geminiFixtureRoot,
    displayName: "Gemini CLI fixture root"
  },
  expectedCapabilityStatuses: {
    liveSessionObservation: "unsupported",
    eventStreaming: "unsupported",
    watchPlans: "unsupported",
    gitContextCapture: "unsupported",
    githubContextCapture: "unsupported",
    verificationSignals: "unknown"
  },
  minimums: {
    sources: 3,
    messages: 5,
    toolCalls: 4,
    shellCommands: 1,
    outputArtifacts: 4,
    fileMutations: 1
  },
  assertExercisedAdapter(adapterRun) {
    expect(adapterRun.validation.capabilities?.messageCapture.status).toBe("supported");
    expect(adapterRun.sources[0]?.metadata).toMatchObject({
      sourceKind: "gemini-project-directory",
      evidenceCount: 4
    });
    expect(
      adapterRun.rawEvents.some((event) => event.payload.kind === "tool-output-sidecar")
    ).toBe(true);
  },
  assertNormalized(normalized) {
    expect(normalized.projects[0]).toMatchObject({
      adapterId: "gemini-cli",
      name: "alpha-project"
    });
    expect(normalized.sessions.map((session) => session.lifecycleState)).toEqual([
      "completed",
      "cancelled"
    ]);
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck",
      outputSource: "combined"
    });
  }
});
