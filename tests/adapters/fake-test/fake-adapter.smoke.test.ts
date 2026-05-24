import path from "node:path";

import { describe, expect, it } from "vitest";

import { createBundledAdapterRegistry } from "../../../src/main/core/registry/index.js";
import { createSafeFilesystem } from "../../../src/main/core/security/index.js";

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

describe("fake-test adapter smoke proof", () => {
  it("normalizes one representative fixture through the bundled registry", async () => {
    const registry = createBundledAdapterRegistry();
    const adapter = registry.require("fake-test");
    const fixturePath = path.resolve(
      "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
    );
    const context = {
      projectDir: process.cwd(),
      platform: process.platform,
      safeFilesystem: createSafeFilesystem({
        allowedRootPaths: [fixturePath]
      })
    };

    expect(registry.listDescriptors().map((descriptor) => descriptor.id)).toContain("fake-test");

    const validation = await adapter.validateSourceRoot({ rootPath: fixturePath }, context);
    expect(validation.ok).toBe(true);

    const [source] = await collectAsync(
      adapter.discoverSources({ rootPath: fixturePath }, context)
    );
    expect(source).toBeDefined();
    if (!source) {
      throw new Error("Expected fake-test discovery to produce a source.");
    }

    const artifacts = await collectAsync(adapter.discoverArtifacts(source, context));
    expect(artifacts).toHaveLength(1);
    const [artifact] = artifacts;
    if (!artifact) {
      throw new Error("Expected fake-test discovery to produce one artifact.");
    }

    const rawEvents = await collectAsync(adapter.parseArtifact(artifact, context));
    expect(rawEvents.length).toBeGreaterThan(1);

    const normalized = await adapter.normalize(
      {
        source,
        artifacts,
        rawEvents
      },
      context
    );

    expect(normalized.projects.length).toBeGreaterThan(0);
    expect(normalized.sessions.length).toBeGreaterThan(0);
    expect(normalized.events.length).toBeGreaterThan(0);
    expect(normalized.messages.length).toBeGreaterThan(0);
    expect(normalized.toolCalls.length).toBeGreaterThan(0);
    expect(normalized.shellCommands.length).toBeGreaterThan(0);
    expect(normalized.outputArtifacts.length).toBeGreaterThan(0);
    expect(normalized.diagnostics.length).toBeGreaterThan(0);
    expect(normalized.projects[0]?.adapterId).toBe("fake-test");
    expect(normalized.sessions[0]?.sourceId).toBe(source.id);
    expect(normalized.events[0]?.adapterId).toBe("fake-test");
    expect(normalized.events[0]?.sourceId).toBe(source.id);
    expect(normalized.toolCalls[0]).not.toHaveProperty("verificationState");
    expect(normalized.sessions[0]).not.toHaveProperty("runAuditStatus");
	    expect(normalized.capabilities.source.capabilities.tools.shellCommands).toBe(true);
  });
});
