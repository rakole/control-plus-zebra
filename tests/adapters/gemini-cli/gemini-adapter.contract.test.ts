import { expect } from "vitest";

import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import {
  runAdapterContractSuite,
  type AdapterScenarioManifestEntry
} from "../../contract/run-adapter-contract.js";

import { geminiFixtureRoot } from "./test-helpers.js";

const scenarios = [
  { name: "basic-session", status: "supported" },
  {
    name: "multi-message-session",
    status: "supported",
    capability: { group: "replay", key: "transcriptReplay" }
  },
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
    status: "supported",
    capability: { group: "tools", key: "fileReads" }
  },
  {
    name: "file-search",
    status: "supported",
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
    name: "shell-command-failure",
    status: "supported",
    assertSupported(adapterRun) {
      expect(
        adapterRun.normalized.shellCommands.some((command) =>
          /failed|error|1 test failed/iu.test(command.outputInline ?? "")
        )
      ).toBe(true);
      expect(
        adapterRun.normalized.shellCommands.some(
          (command) => command.outputInline === "1 test failed" && command.rawExitCode === undefined
        )
      ).toBe(true);
    }
  },
  {
    name: "cancellation-lifecycle",
    status: "supported",
    capability: { group: "replay", key: "cancellationEvents" }
  },
  {
    name: "sidecar-output-artifact",
    status: "supported",
    capability: { group: "tools", key: "sidecarOutputs" }
  },
  {
    name: "duplicate-intermediate-raw-records",
    status: "supported",
    reason: "The multi-source fixture root contains intermediate tool records and sidecars."
  },
  {
    name: "partial-corrupt-raw-data",
    status: "supported",
    reason: "The gamma fixture includes malformed chat and sidecar records."
  },
  {
    name: "active-changing-artifact",
    status: "supported",
    capability: { group: "live", key: "activeSessionDetection" },
    assertSupported(adapterRun) {
      expect(
        adapterRun.normalized.outputArtifacts.some((artifact) =>
          /active|changing|watch/iu.test(JSON.stringify(artifact))
        )
      ).toBe(false);
    }
  },
  {
    name: "model-name",
    status: "supported",
    capability: { group: "usage", key: "modelNames" }
  },
  {
    name: "token-usage",
    status: "supported",
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
  { name: "diagnostics", status: "unknown" }
] satisfies AdapterScenarioManifestEntry[];

runAdapterContractSuite({
  name: "gemini-cli",
  adapter: geminiCliAdapter,
  root: {
    rootPath: geminiFixtureRoot,
    displayName: "Gemini CLI fixture root"
  },
  scenarios,
  assertExercisedAdapter(adapterRun) {
    expect(geminiCliAdapter.normalizeBatches).toEqual(expect.any(Function));
    expect(adapterRun.sources.map((source) => source.displayName).sort()).toEqual([
      "alpha-project",
      "beta-project",
      "delta-project",
      "gamma-project"
    ]);
    expect(adapterRun.validation.capabilities?.replay.assistantMessages).toBe(true);
    expect(adapterRun.sources[0]?.metadata).toMatchObject({
      sourceKind: "gemini-project-directory",
      evidenceCount: 4
    });
    expect(
      adapterRun.rawEvents.some(
        (event) => (event.payload as { kind?: string }).kind === "tool-output-sidecar"
      )
    ).toBe(true);
  },
  assertNormalized(normalized) {
    expect(normalized.projects[0]).toMatchObject({
      adapterId: "gemini-cli",
      name: "alpha-project"
    });
    expect(normalized.sessions.map((session) => session.lifecycleStatus)).toEqual([
      "completed",
      "cancelled"
    ]);
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck",
      outputInline: "Typecheck passed"
    });
  }
});
