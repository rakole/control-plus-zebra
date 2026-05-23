import path from "node:path";

import { describe, expect, it } from "vitest";

import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";
import { exerciseAdapter } from "../../contract/run-adapter-contract.js";
import { WatchOrchestrator } from "../../../src/main/core/watcher/index.js";

const fixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);

describe("WatchOrchestrator", () => {
  it("records adapter watch support truth without starting watcher lifecycle in adapters", async () => {
    const orchestrator = new WatchOrchestrator();
    const exercised = await exerciseAdapter(fakeTestAdapter, fixturePath);

    const record = await orchestrator.planForSource(
      fakeTestAdapter,
      exercised.source,
      exercised.context
    );

    expect(record.status).toBe("unsupported");
    expect(record.strategy).toBe("none");
    expect(orchestrator.getRecord(exercised.source.id)).toEqual(record);
  });
});
