import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fixtures = [
  path.resolve("tests/fixtures/fake-test/phase1-session.normalized.json"),
  path.resolve("tests/fixtures/gemini-cli/alpha-project.normalized.json")
] as const;

describe("Wave 2 normalized fixtures", () => {
	  it.each(fixtures)("keeps %s on the grouped capability contract", async (fixturePath) => {
	    const payload = JSON.parse(await readFile(fixturePath, "utf8"));
	    const capabilities = payload.capabilities.adapter.capabilities;

	    expect(capabilities.discovery).toHaveProperty("defaultRoots");
	    expect(capabilities.replay).toHaveProperty("rawEventPointers");
	    expect(capabilities.tools).toHaveProperty("sidecarOutputs");
	    expect(capabilities.live).toHaveProperty("activeSessionDetection");
	    expect(capabilities.sessionDiscovery).toBeUndefined();
	    expect(capabilities.verificationSignals).toBeUndefined();
	  });
});
