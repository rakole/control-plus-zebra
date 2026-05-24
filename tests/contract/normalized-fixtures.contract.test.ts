import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fixtures = [
  path.resolve("tests/fixtures/fake-test/phase1-session.normalized.json"),
  path.resolve("tests/fixtures/gemini-cli/alpha-project.normalized.json"),
  path.resolve("tests/fixtures/gemini-cli/beta-project.normalized.json"),
  path.resolve("tests/fixtures/gemini-cli/gamma-project.normalized.json"),
  path.resolve("tests/fixtures/gemini-cli/delta-project.normalized.json")
] as const;

describe("normalized fixture contract", () => {
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

  it.each(fixtures)("keeps %s spec-shaped without adapter-private raw payloads", async (fixturePath) => {
    const payload = JSON.parse(await readFile(fixturePath, "utf8"));

    assertSourcePointers(fixturePath, "event", payload.events ?? [], "raw");
    assertSourcePointers(fixturePath, "message", payload.messages ?? []);
    assertSourcePointers(fixturePath, "tool call", payload.toolCalls ?? []);
    assertSourcePointers(fixturePath, "shell command", payload.shellCommands ?? []);
    assertSourcePointers(fixturePath, "file mutation", payload.fileMutations ?? []);

    for (const artifact of payload.outputArtifacts ?? []) {
      expect(artifact.contentKind, `${fixturePath} artifact ${artifact.id}`).toEqual(
        expect.any(String)
      );
      assertSourcePointer(fixturePath, "artifact", artifact, "source");
    }
  });

  it("locks usage/model evidence in at least one Gemini golden", async () => {
    const payloads = await Promise.all(
      fixtures
        .filter((fixturePath) => fixturePath.includes("fixtures/gemini-cli/"))
        .map(async (fixturePath) => JSON.parse(await readFile(fixturePath, "utf8")))
    );

    expect(
      payloads.some((payload) =>
        (payload.messages ?? []).some((message: { modelName?: string }) => Boolean(message.modelName))
      )
    ).toBe(true);
    expect(
      payloads.some((payload) =>
        (payload.sessions ?? []).some(
          (session: { usage?: { totalTokens?: number } }) =>
            typeof session.usage?.totalTokens === "number"
        )
      )
    ).toBe(true);
  });
});

function assertSourcePointers(
  fixturePath: string,
  label: string,
  records: unknown[],
  pointerKey: "raw" | "source" = "source"
) {
  for (const record of records) {
    assertSourcePointer(fixturePath, label, record, pointerKey);
  }
}

function assertSourcePointer(
  fixturePath: string,
  label: string,
  record: unknown,
  pointerKey: "raw" | "source"
) {
  const entity = record as {
    id?: string;
    raw?: Record<string, unknown>;
    source?: Record<string, unknown>;
    payload?: unknown;
  };
  const pointer = entity[pointerKey];
  const name = `${fixturePath} ${label} ${entity.id ?? "unknown"}`;

  expect(pointer?.pointer, name).toEqual(expect.any(String));
  expect(pointer?.raw, name).toBeUndefined();
  expect(pointer?.payload, name).toBeUndefined();
  expect(entity.raw && pointerKey !== "raw" ? entity.raw.raw : undefined, name).toBeUndefined();
  expect(entity.payload, name).toBeUndefined();
}
