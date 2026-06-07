import { describe, expect, it } from "vitest";

import {
  getBuildFeatureFlagDefines,
  isExplicitlyEnabled,
} from "../../src/shared/feature-flags.js";

describe("feature flags", () => {
  it("treats only explicit truthy values as enabled", () => {
    expect(isExplicitlyEnabled(undefined)).toBe(false);
    expect(isExplicitlyEnabled("")).toBe(false);
    expect(isExplicitlyEnabled("0")).toBe(false);
    expect(isExplicitlyEnabled("false")).toBe(false);
    expect(isExplicitlyEnabled("1")).toBe(true);
    expect(isExplicitlyEnabled("TRUE")).toBe(true);
  });

  it("defaults the GitHub UI build define to false", () => {
    expect(getBuildFeatureFlagDefines({})).toEqual({
      __AW_FEATURE_GITHUB_UI__: "false",
    });
  });

  it("emits a true GitHub UI build define for explicit opt-in values", () => {
    expect(getBuildFeatureFlagDefines({ AW_FEATURE_GITHUB_UI: "1" })).toEqual({
      __AW_FEATURE_GITHUB_UI__: "true",
    });
    expect(
      getBuildFeatureFlagDefines({ AW_FEATURE_GITHUB_UI: "true" }),
    ).toEqual({
      __AW_FEATURE_GITHUB_UI__: "true",
    });
  });
});
