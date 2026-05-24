import { describe, expect, it } from "vitest";

import {
  getGroupedCapabilityState,
  toCapabilityGroups
} from "../../../src/main/app/capability-view-models.js";
import { capabilityState } from "../../../src/main/core/model/capabilities.js";

describe("capability view models", () => {
  it("resolves grouped capability lookups from legacy flat capability states", () => {
    const capabilities = {
      shellCommandCapture: capabilityState("supported"),
      verificationSignals: capabilityState("unsupported", "Shared verifier was unavailable."),
      liveSessionObservation: capabilityState("unsupported", "Static archive.")
    };

    expect(getGroupedCapabilityState(capabilities, "tools", "shellCommands")).toEqual({
      status: "supported"
    });
    expect(
      getGroupedCapabilityState(capabilities, "audit", "verificationCommandEvidence")
    ).toEqual({
      status: "unsupported",
      reason: "Shared verifier was unavailable."
    });
    expect(getGroupedCapabilityState(capabilities, "live", "activeSessionDetection")).toEqual({
      status: "unsupported",
      reason: "Static archive."
    });
  });

  it("resolves grouped capability lookups from flat top-level grouped keys", () => {
    const capabilities = {
      shellCommands: true,
      tokenCounts: false,
      verificationCommandEvidence: true
    };

    expect(getGroupedCapabilityState(capabilities, "tools", "shellCommands")).toEqual({
      status: "supported"
    });
    expect(getGroupedCapabilityState(capabilities, "usage", "tokenCounts")).toEqual({
      status: "unsupported"
    });
    expect(
      getGroupedCapabilityState(capabilities, "audit", "verificationCommandEvidence")
    ).toEqual({
      status: "supported"
    });
  });

  it("keeps grouped badge keys when rendering legacy flat capability snapshots", () => {
    const capabilities = {
      shellCommandCapture: capabilityState("supported"),
      verificationSignals: capabilityState("unsupported", "Legacy verifier snapshot."),
      tokenCounts: false
    };

    const groups = toCapabilityGroups(capabilities);

    expect(groups.find((group) => group.key === "tools")?.capabilities).toContainEqual(
      expect.objectContaining({
        key: "tools.shellCommands",
        label: "Shell Commands",
        state: "Supported"
      })
    );
    expect(groups.find((group) => group.key === "usage")?.capabilities).toContainEqual(
      expect.objectContaining({
        key: "usage.tokenCounts",
        label: "Token Counts",
        state: "Unsupported"
      })
    );
    expect(groups.find((group) => group.key === "audit")?.capabilities).toContainEqual(
      expect.objectContaining({
        key: "audit.verificationCommandEvidence",
        label: "Verification Command Evidence",
        state: "Unsupported",
        reason: "Legacy verifier snapshot."
      })
    );
  });
});
