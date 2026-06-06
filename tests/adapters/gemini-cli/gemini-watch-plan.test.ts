import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AdapterContext, DiscoveredHarnessSource } from "../../../src/main/core/adapter-contract/types.js";
import { HIGH_CONFIDENCE } from "../../../src/main/core/model/confidence.js";
import { createSafeFilesystem } from "../../../src/main/core/security/safe-filesystem.js";
import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import { geminiFixtureRoot } from "./test-helpers.js";

const tempRoots: string[] = [];

describe("gemini-cli watch plan", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("returns a supported native watch plan for discovered Gemini project artifacts", async () => {
    const context = createContext(geminiFixtureRoot);
    const sources = [];

    for await (const source of geminiCliAdapter.discoverSources(
      { rootPath: geminiFixtureRoot },
      context
    )) {
      sources.push(source);
    }

    const source = sources[0];

    if (!source) {
      throw new Error("Expected Gemini fixture root to expose at least one project source.");
    }

    const plan = await geminiCliAdapter.getWatchPlan(source, createContext(source.rootPath));

    expect(plan).toMatchObject({
      adapterId: "gemini-cli",
      sourceId: source.id,
      status: "supported",
      strategy: "native"
    });
    expect(plan.scopePaths).toContain(source.rootPath);
    expect(plan.scopePaths).toContain(path.join(source.rootPath, "chats"));
  });

  it("tolerates missing optional watch locations", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "gemini-watch-plan-"));
    tempRoots.push(rootPath);
    await mkdir(path.join(rootPath, "chats"));
    await writeFile(path.join(rootPath, "chats", "session-live.jsonl"), "", "utf8");

    const source: DiscoveredHarnessSource = {
      id: "gemini-cli:test-live",
      adapterId: "gemini-cli",
      nativeId: rootPath,
      rootPath,
      displayName: "test-live",
      confidence: HIGH_CONFIDENCE
    };
    const plan = await geminiCliAdapter.getWatchPlan(source, createContext(rootPath));

    expect(plan.status).toBe("supported");
    expect(plan.strategy).toBe("native");
    expect(plan.scopePaths).toEqual([rootPath, path.join(rootPath, "chats")]);
  });
});

function createContext(rootPath: string): AdapterContext {
  return {
    platform: process.platform,
    safeFilesystem: createSafeFilesystem({
      allowedRootPaths: [rootPath]
    })
  };
}
