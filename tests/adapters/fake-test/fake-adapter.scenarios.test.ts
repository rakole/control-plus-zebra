import path from "node:path";

import { describe, expect, it } from "vitest";

import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";

import { exerciseAdapter } from "../../contract/run-adapter-contract.js";

const fixtureRoot = path.resolve("src/main/adapters/fake-test/fixtures");

describe("fake-test adapter scenario fixtures", () => {
  it("covers shell command failure without trusting raw tool success", async () => {
    const exercised = await exerciseAdapter(
      fakeTestAdapter,
      path.join(fixtureRoot, "phase5-exit-code-precedence.fixture.json")
    );

    expect(exercised.normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck",
      rawStatus: "succeeded",
      rawExitCode: 1
    });
  });

  it("covers duplicate/intermediate command evidence without collapsing unknown output", async () => {
    const exercised = await exerciseAdapter(
      fakeTestAdapter,
      path.join(fixtureRoot, "phase5-incomplete-run.fixture.json")
    );

    expect(exercised.normalized.toolCalls.map((toolCall) => toolCall.statusNormalized)).toEqual([
      "completed",
      "pending"
    ]);
    expect(exercised.normalized.shellCommands[1]).toMatchObject({
      command: "npm run lint",
      rawStatus: "started"
    });
    expect(exercised.normalized.shellCommands[1]?.rawExitCode).toBeUndefined();
  });

  it("surfaces corrupt raw data as parse diagnostics instead of fabricated sessions", async () => {
    const rootPath = path.join(fixtureRoot, "partial-corrupt.fixture.json");
    const exercised = await exerciseAdapter(fakeTestAdapter, rootPath);

    expect(exercised.rawEvents.map((event) => (event.payload as { kind?: string }).kind)).toEqual([
      "parse-diagnostic"
    ]);
    expect(exercised.normalized.sessions).toEqual([]);
    expect(exercised.normalized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "fake-test.parse.json"
    );
  });
});
