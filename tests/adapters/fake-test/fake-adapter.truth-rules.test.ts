import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CapabilityEnvelope } from "../../../src/main/core/model/capabilities.js";
import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";

import { exerciseAdapter } from "../../contract/run-adapter-contract.js";

const fixturePath = path.resolve("src/main/adapters/fake-test/fixtures/phase1-session.fixture.json");

const FORBIDDEN_CONCLUSION_KEYS = [
  "verificationState",
  "verificationStatus",
  "runAuditStatus",
  "runAuditClassification",
  "attentionReasons",
  "attentionReason"
] as const;

function findForbiddenKeys(value: unknown, pathPrefix = "$", hits: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return hits;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findForbiddenKeys(item, `${pathPrefix}[${index}]`, hits);
    });
    return hits;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_CONCLUSION_KEYS.includes(key as (typeof FORBIDDEN_CONCLUSION_KEYS)[number])) {
      hits.push(`${pathPrefix}.${key}`);
    }

    findForbiddenKeys(nestedValue, `${pathPrefix}.${key}`, hits);
  }

  return hits;
}

function assertTruthStates(snapshot: CapabilityEnvelope) {
  expect(snapshot.capabilities.live.activeSessionDetection).toBe("none");
  expect(snapshot.capabilities.live.watchableArtifacts).toBe(false);
  expect(snapshot.capabilities.replay.transcriptReplay).toBe(true);
  expect(snapshot.capabilities.tools.shellCommands).toBe(true);
  expect(snapshot.capabilities.audit.verificationCommandEvidence).toBe(true);

  expect(snapshot.capabilities.live.activeSessionDetection).not.toBe(0 as never);
  expect(snapshot.capabilities.live.watchableArtifacts).not.toBe(0 as never);
  expect(snapshot.capabilities.audit.verificationCommandEvidence).not.toBe("clean" as never);
}

describe("fake-test adapter truth rules", () => {
  it("keeps unsupported and unknown capabilities explicit instead of flattening them", async () => {
    const { normalized } = await exerciseAdapter(fakeTestAdapter, fixturePath);

    assertTruthStates(normalized.capabilities.adapter);
    assertTruthStates(normalized.capabilities.source);
    normalized.capabilities.sessions.forEach((sessionSnapshot) => assertTruthStates(sessionSnapshot));
  });

  it("emits evidence only and does not leak verification or run-audit conclusions", async () => {
    const { normalized } = await exerciseAdapter(fakeTestAdapter, fixturePath);

    expect(findForbiddenKeys(normalized)).toEqual([]);
    expect(normalized.sessions[0]).not.toHaveProperty("runAuditStatus");
    expect(normalized.toolCalls[0]).not.toHaveProperty("verificationStatus");
    expect(normalized.shellCommands[0]).not.toHaveProperty("verificationState");
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck",
      rawExitCode: 0
    });
  });
});
