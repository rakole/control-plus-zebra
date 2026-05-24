import { describe, expect, it } from "vitest";

import {
  createConfidenceScore,
  createSessionId,
  createSourceId,
  resolveBooleanCapability,
  resolveEnumCapability,
  toConfidence,
  type CapabilityEnvelope,
  type HarnessCapabilities
} from "../../../src/main/core/model/index.js";

function buildCapabilities(): HarnessCapabilities {
  return {
    discovery: {
      defaultRoots: true,
      projectRootMapping: "native",
      stableProjectId: true,
      stableSessionId: true
    },
    replay: {
      transcriptReplay: true,
      messageRoles: true,
      assistantMessages: true,
      lifecycleEvents: true,
      cancellationEvents: true,
      topicEvents: false,
      rawEventPointers: true
    },
    tools: {
      toolCalls: true,
      toolResults: true,
      fileReads: true,
      fileSearches: true,
      fileMutations: true,
      diffStats: false,
      shellCommands: true,
      shellOutputs: true,
      sidecarOutputs: true
    },
    usage: {
      modelNames: true,
      tokenCounts: false,
      costEstimates: false
    },
    live: {
      activeSessionDetection: "mtime",
      watchableArtifacts: true,
      incrementalParsing: true
    },
    audit: {
      agentClaimDetection: true,
      finalAnswerDetection: true,
      shellExitCodeEvidence: true,
      verificationCommandEvidence: true
    },
    export: {
      rawArtifactExport: false,
      normalizedExport: true
    }
  };
}

describe("shared model contract", () => {
  it("maps spec confidence onto the legacy score shape without losing normalized meaning", () => {
    const score = createConfidenceScore("observed", "Seen in source artifacts.");

    expect(score.level).toBe("medium");
    expect(score.normalizedLevel).toBe("observed");
    expect(toConfidence(score)).toBe("observed");
  });

  it("resolves grouped capability booleans and enums into explicit UI states", () => {
    const snapshot: CapabilityEnvelope = {
      adapterId: "fake-test",
      sourceId: "source_fake-test",
      capabilities: buildCapabilities()
    };

    expect(
      resolveBooleanCapability(snapshot, (capabilities) => capabilities.tools.shellCommands)
    ).toMatchObject({
      status: "supported",
      value: true
    });

    expect(
      resolveBooleanCapability(undefined, (capabilities) => capabilities.tools.shellCommands)
    ).toMatchObject({
      status: "unknown"
    });

    expect(
      resolveEnumCapability(snapshot, (capabilities) => capabilities.live.activeSessionDetection, {
        supportedValues: ["mtime", "process", "hook", "native"]
      })
    ).toMatchObject({
      status: "supported",
      value: "mtime"
    });
  });

  it("keeps stable ids deterministic across the new harness-native primitives", () => {
    const sourceId = createSourceId("gemini-cli", "/tmp/source");
    const left = createSessionId({
      adapterId: "gemini-cli",
      sourceId,
      nativeId: "session-123"
    });
    const right = createSessionId({
      adapterId: "gemini-cli",
      sourceId,
      nativeId: "session-123"
    });

    expect(left).toBe(right);
    expect(left.startsWith("session_")).toBe(true);
  });
});
