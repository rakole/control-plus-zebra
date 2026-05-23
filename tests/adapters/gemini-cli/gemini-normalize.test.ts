import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import { collectAsync, exerciseAdapter } from "../../contract/run-adapter-contract.js";

import {
  cleanupTempGeminiFixtureRoot,
  collectGeminiArtifacts,
  createGeminiAdapterContext,
  createTempGeminiFixtureRoot,
  geminiFixtureRoot,
  requireGeminiSource
} from "./test-helpers.js";

describe("gemini-cli normalization", () => {
  it("maps the representative Gemini source into shared projects, sessions, messages, tools, shell evidence, artifacts, and mutations", async () => {
    const exercised = await exerciseAdapter(geminiCliAdapter, geminiFixtureRoot);
    const { normalized } = exercised;

    expect(normalized.projects[0]).toMatchObject({
      adapterId: "gemini-cli",
      name: "alpha-project",
      rootPath: "/workspaces/alpha-project"
    });
    expect(normalized.sessions.map((session) => session.lifecycleState)).toEqual([
      "completed",
      "cancelled"
    ]);
    expect(normalized.messages.map((message) => message.role)).toEqual(
      expect.arrayContaining(["assistant", "system", "user"])
    );
    expect(normalized.toolCalls.map((toolCall) => toolCall.toolName)).toEqual(
      expect.arrayContaining([
        "read_file",
        "run_shell_command",
        "replace",
        "update_topic"
      ])
    );
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run typecheck",
      outputSource: "combined"
    });
    expect(normalized.outputArtifacts.map((artifact) => artifact.nativeId)).toEqual(
      expect.arrayContaining([
        "tool-outputs/session-11111111-1111-4111-8111-111111111111/read_file_read_file_1700000000000_0_a1b2c3.txt",
        "tool-outputs/session-11111111-1111-4111-8111-111111111111/replace_replace_1700000002000_2_a4b5c6.json"
      ])
    );
    expect(normalized.fileMutations[0]).toMatchObject({
      path: "src/main/core/adapter-contract/types.ts",
      mutationKind: "updated"
    });
  });

  it("keeps active sessions honest and surfaces missing sidecars as diagnostics", async () => {
    const betaSource = await requireGeminiSource(geminiFixtureRoot, "beta-project");
    const artifacts = await collectGeminiArtifacts(betaSource);
    const rawEvents = (
      await Promise.all(
        artifacts.map((artifact) =>
          collectAsync(
            geminiCliAdapter.parseArtifact(artifact, createGeminiAdapterContext(betaSource.rootPath))
          )
        )
      )
    ).flat();
    const normalized = await geminiCliAdapter.normalize(
      {
        source: betaSource,
        artifacts,
        rawEvents
      },
      createGeminiAdapterContext(betaSource.rootPath)
    );

    expect(normalized.sessions[0]?.lifecycleState).toBe("active");
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "gemini-cli.normalize.missing-sidecar"
    );
  });

  it("preserves parse diagnostics while still normalizing remaining valid evidence", async () => {
    const gammaSource = await requireGeminiSource(geminiFixtureRoot, "gamma-project");
    const artifacts = await collectGeminiArtifacts(gammaSource);
    const rawEvents = (
      await Promise.all(
        artifacts.map((artifact) =>
          collectAsync(
            geminiCliAdapter.parseArtifact(artifact, createGeminiAdapterContext(gammaSource.rootPath))
          )
        )
      )
    ).flat();
    const normalized = await geminiCliAdapter.normalize(
      {
        source: gammaSource,
        artifacts,
        rawEvents
      },
      createGeminiAdapterContext(gammaSource.rootPath)
    );

    expect(normalized.sessions[0]?.lifecycleState).toBe("completed");
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "gemini-cli.parse.chat-json-line",
        "gemini-cli.parse.tool-output-json"
      ])
    );
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run test -- tests/main/core/scanner-cache.test.ts"
    });
  });

  it("omits blank tool output summaries so cache persistence accepts live Gemini sessions", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();

    try {
      const chatPath = path.join(
        rootPath,
        "alpha-project",
        "chats",
        "session-2026-05-23T09-11-11111111-1111-4111-8111-111111111111.jsonl"
      );
      const sourceText = await readFile(chatPath, "utf8");

      await writeFile(
        chatPath,
        sourceText.replace('"resultDisplay":"Read contract types"', '"resultDisplay":""'),
        "utf8"
      );

      const alphaSource = await requireGeminiSource(rootPath, "alpha-project");
      const artifacts = await collectGeminiArtifacts(alphaSource);
      const rawEvents = (
        await Promise.all(
          artifacts.map((artifact) =>
            collectAsync(
              geminiCliAdapter.parseArtifact(
                artifact,
                createGeminiAdapterContext(alphaSource.rootPath)
              )
            )
          )
        )
      ).flat();
      const normalized = await geminiCliAdapter.normalize(
        {
          source: alphaSource,
          artifacts,
          rawEvents
        },
        createGeminiAdapterContext(alphaSource.rootPath)
      );
      const toolCall = normalized.toolCalls.find(
        (candidate) => candidate.nativeId === "read_file_1700000000000_0"
      );

      expect(toolCall).toMatchObject({
        toolName: "read_file"
      });
      expect(toolCall?.outputSummary).toBeUndefined();
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });
});
