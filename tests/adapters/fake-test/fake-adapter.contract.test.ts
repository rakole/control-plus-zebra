import path from "node:path";

import { expect } from "vitest";

import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";

import { runAdapterContractSuite } from "../../contract/run-adapter-contract.js";

const fixturePath = path.resolve("src/main/adapters/fake-test/fixtures/phase1-session.fixture.json");

runAdapterContractSuite({
  name: "fake-test",
  adapter: fakeTestAdapter,
  root: {
    rootPath: fixturePath,
    displayName: "Phase 1 Fixture Source"
  },
  expectedCapabilityStatuses: {
    liveSessionObservation: "unsupported",
    eventStreaming: "unsupported",
    watchPlans: "unsupported",
    gitContextCapture: "unsupported",
    githubContextCapture: "unsupported",
    verificationSignals: "unknown"
  },
  expectedDiagnosticCodes: ["fake.partial-shell-history"],
  minimums: {
    messages: 2,
    toolCalls: 1,
    shellCommands: 1,
    outputArtifacts: 1,
    fileMutations: 1,
    diagnostics: 1
  },
	  assertExercisedAdapter(adapterRun) {
	    expect(adapterRun.validation.capabilities?.tools.shellCommands).toBe(true);
    expect(adapterRun.sources[0]?.metadata).toMatchObject({
      sourceKind: "fixture-file",
      artifactType: "fake-session-fixture"
    });
    expect(adapterRun.rawEvents.some((event) => event.payload.kind === "fixture-metadata")).toBe(
      true
    );
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
