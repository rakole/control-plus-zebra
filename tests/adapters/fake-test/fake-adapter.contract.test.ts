import path from "node:path";

import { expect } from "vitest";

import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";

import {
  runAdapterContractSuite,
  type AdapterScenarioManifestEntry
} from "../../contract/run-adapter-contract.js";

const fixturePath = path.resolve("src/main/adapters/fake-test/fixtures/phase1-session.fixture.json");
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
    status: "unsupported",
    capability: { group: "tools", key: "fileReads" },
    reason: "The fake adapter fixture proves unsupported file reads stay absent."
  },
  {
    name: "file-search",
    status: "unsupported",
    capability: { group: "tools", key: "fileSearches" },
    reason: "The fake adapter fixture does not fabricate search evidence."
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
    status: "unknown",
    assertNotFabricated(adapterRun) {
      expect(
        adapterRun.normalized.shellCommands.some(
          (command) => typeof command.rawExitCode === "number" && command.rawExitCode !== 0
        )
      ).toBe(false);
    }
  },
  {
    name: "cancellation-lifecycle",
    status: "unknown",
    assertNotFabricated(adapterRun) {
      expect(
        adapterRun.normalized.sessions.some((session) => session.lifecycleStatus === "cancelled")
      ).toBe(false);
    }
  },
  {
    name: "sidecar-output-artifact",
    status: "supported",
    capability: { group: "tools", key: "sidecarOutputs" }
  },
  {
    name: "duplicate-intermediate-raw-records",
    status: "unknown",
    reason: "Duplicate raw records are adapter-scenario specific and not fabricated here."
  },
  {
    name: "partial-corrupt-raw-data",
    status: "unknown",
    reason: "The primary fake contract fixture is valid but includes a warning diagnostic."
  },
  {
    name: "active-changing-artifact",
    status: "unsupported",
    capability: { group: "live", key: "activeSessionDetection" }
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
] satisfies AdapterScenarioManifestEntry[];

runAdapterContractSuite({
  name: "fake-test",
  adapter: fakeTestAdapter,
  root: {
    rootPath: fixturePath,
    displayName: "Phase 1 Fixture Source"
  },
  expectedDiagnosticCodes: ["fake.partial-shell-history"],
  scenarios,
  assertExercisedAdapter(adapterRun) {
    expect(adapterRun.validation.capabilities?.tools.shellCommands).toBe(true);
    expect(adapterRun.sources[0]?.metadata).toMatchObject({
      sourceKind: "fixture-file",
      artifactType: "fake-session-fixture"
    });
    expect(
      adapterRun.rawEvents.some(
        (event) => (event.payload as { kind?: string }).kind === "fixture-metadata"
      )
    ).toBe(true);
  },
  assertNormalized(normalized, adapterRun) {
    expect(normalized.projects[0]).toMatchObject({
      adapterId: "fake-test",
      sourceId: adapterRun.source.id,
      nativeId: "project-01",
      name: "control-plus-zebra"
    });
    expect(normalized.sessions[0]).toMatchObject({
      adapterId: "fake-test",
      sourceId: adapterRun.source.id,
      nativeId: "session-01",
      lifecycleStatus: "completed"
    });
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck",
      rawExitCode: 0,
      outputInline: "Type checking passed."
    });
  }
});
