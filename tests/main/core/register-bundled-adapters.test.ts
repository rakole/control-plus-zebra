import { describe, expect, it } from "vitest";

import { createBundledAdapterRegistry } from "../../../src/main/core/registry/index.js";

describe("registerBundledAdapters", () => {
  it("registers only bundled configurable harness adapters", () => {
    const registry = createBundledAdapterRegistry();
    const descriptorIds = registry
      .listDescriptors()
      .map((descriptor) => descriptor.id)
      .sort();

    expect(descriptorIds).toEqual(["fake-test", "gemini-cli"]);
    expect(registry.get("archive-reader")).toBeUndefined();
  });
});
