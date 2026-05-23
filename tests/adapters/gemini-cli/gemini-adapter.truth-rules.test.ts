import { describe, expect, it } from "vitest";

import type { CapabilityEnvelope } from "../../../src/main/core/model/capabilities.js";
import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import { exerciseAdapter } from "../../contract/run-adapter-contract.js";

import { geminiFixtureRoot } from "./test-helpers.js";

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
  expect(snapshot.capabilities.liveSessionObservation).toEqual(
    expect.objectContaining({
      status: "unsupported"
    })
  );
  expect(snapshot.capabilities.eventStreaming).toEqual(
    expect.objectContaining({
      status: "unsupported"
    })
  );
  expect(snapshot.capabilities.watchPlans).toEqual(
    expect.objectContaining({
      status: "unsupported"
    })
  );
  expect(snapshot.capabilities.gitContextCapture).toEqual(
    expect.objectContaining({
      status: "unsupported"
    })
  );
  expect(snapshot.capabilities.githubContextCapture).toEqual(
    expect.objectContaining({
      status: "unsupported"
    })
  );
  expect(snapshot.capabilities.verificationSignals).toEqual(
    expect.objectContaining({
      status: "unknown"
    })
  );
}

describe("gemini-cli adapter truth rules", () => {
  it("keeps unsupported and unknown capabilities explicit instead of flattening them", async () => {
    const { normalized } = await exerciseAdapter(geminiCliAdapter, geminiFixtureRoot);

    assertTruthStates(normalized.capabilities.adapter);
    assertTruthStates(normalized.capabilities.source);
    normalized.capabilities.sessions.forEach((sessionSnapshot) => assertTruthStates(sessionSnapshot));
  });

  it("emits evidence only and does not leak verification or run-audit conclusions", async () => {
    const { normalized } = await exerciseAdapter(geminiCliAdapter, geminiFixtureRoot);

    expect(findForbiddenKeys(normalized)).toEqual([]);
    expect(normalized.sessions[0]).not.toHaveProperty("runAuditStatus");
    expect(normalized.toolCalls[0]).not.toHaveProperty("verificationStatus");
    expect(normalized.shellCommands[0]).not.toHaveProperty("verificationState");
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck"
    });
  });
});
