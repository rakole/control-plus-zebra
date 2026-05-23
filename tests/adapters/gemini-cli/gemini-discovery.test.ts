import path from "node:path";

import { describe, expect, it } from "vitest";

import { createBundledAdapterRegistry } from "../../../src/main/core/registry/index.js";
import { geminiCliAdapter, geminiCliDescriptor } from "../../../src/main/adapters/gemini-cli/index.js";
import {
  GEMINI_CHAT_ARTIFACT_TYPE,
  GEMINI_LOGS_ARTIFACT_TYPE,
  GEMINI_PROJECT_ROOT_ARTIFACT_TYPE,
  GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE
} from "../../../src/main/adapters/gemini-cli/discovery.js";

import {
  collectGeminiArtifacts,
  collectGeminiSources,
  createGeminiAdapterContext,
  geminiFixtureRoot,
  requireGeminiSource
} from "./test-helpers.js";

describe("gemini-cli discovery", () => {
  it("validates a Gemini temp root directory and returns explicit capabilities", async () => {
    const validation = await geminiCliAdapter.validateSourceRoot(
      {
        rootPath: geminiFixtureRoot
      },
      createGeminiAdapterContext(geminiFixtureRoot)
    );

    expect(validation.ok).toBe(true);
    expect(validation.normalizedPath).toBe(geminiFixtureRoot);
    expect(validation.capabilities).toEqual(geminiCliDescriptor.capabilities);
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "gemini-cli.source.partial-project-layout"
    );
  });

  it("rejects missing roots with source-scoped diagnostics instead of pretending success", async () => {
    const missingRoot = path.join(geminiFixtureRoot, "missing-root");
    const validation = await geminiCliAdapter.validateSourceRoot(
      {
        rootPath: missingRoot
      },
      createGeminiAdapterContext(geminiFixtureRoot)
    );

    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "gemini-cli.source.missing"
    );
  });

  it("discovers one source per evidence-bearing project directory", async () => {
    const sources = await collectGeminiSources(geminiFixtureRoot);

    expect(sources.map((source) => source.displayName)).toEqual([
      "alpha-project",
      "beta-project",
      "gamma-project"
    ]);
    expect(sources.every((source) => source.adapterId === "gemini-cli")).toBe(true);
    expect(sources.every((source) => source.rootPath.endsWith(source.displayName))).toBe(true);
    expect(sources[0]?.metadata).toMatchObject({
      sourceKind: "gemini-project-directory",
      evidenceCount: 4
    });
  });

  it("indexes the expected Gemini artifact families and ignores .DS_Store noise", async () => {
    const alphaSource = await requireGeminiSource(geminiFixtureRoot, "alpha-project");
    const artifacts = await collectGeminiArtifacts(alphaSource);

    expect(
      artifacts.map((artifact) => ({
        artifactType: artifact.artifactType,
        nativeId: artifact.nativeId
      }))
    ).toEqual([
      {
        artifactType: GEMINI_PROJECT_ROOT_ARTIFACT_TYPE,
        nativeId: ".project_root"
      },
      {
        artifactType: GEMINI_LOGS_ARTIFACT_TYPE,
        nativeId: "logs.json"
      },
      {
        artifactType: GEMINI_CHAT_ARTIFACT_TYPE,
        nativeId:
          "chats/session-2026-05-23T09-11-11111111-1111-4111-8111-111111111111.jsonl"
      },
      {
        artifactType: GEMINI_CHAT_ARTIFACT_TYPE,
        nativeId:
          "chats/session-2026-05-23T09-20-22222222-2222-4222-8222-222222222222.jsonl"
      },
      {
        artifactType: GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE,
        nativeId:
          "tool-outputs/session-11111111-1111-4111-8111-111111111111/read_file_read_file_1700000000000_0_a1b2c3.txt"
      },
      {
        artifactType: GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE,
        nativeId:
          "tool-outputs/session-11111111-1111-4111-8111-111111111111/replace_replace_1700000002000_2_a4b5c6.json"
      },
      {
        artifactType: GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE,
        nativeId:
          "tool-outputs/session-11111111-1111-4111-8111-111111111111/run_shell_command_1700000001000_1.txt"
      },
      {
        artifactType: GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE,
        nativeId:
          "tool-outputs/session-22222222-2222-4222-8222-222222222222/update_topic_update_topic_1700000003000_0_a7b8c9.txt"
      }
    ]);
  });

  it("registers Gemini CLI through the bundled adapter composition root", () => {
    const registry = createBundledAdapterRegistry();
    const descriptor = registry.require("gemini-cli").descriptor;

    expect(descriptor.displayName).toBe("Gemini CLI");
    expect(descriptor.defaultRoots[0]).toMatchObject({
      path: "~/.gemini/tmp",
      kind: "directory"
    });
  });
});
