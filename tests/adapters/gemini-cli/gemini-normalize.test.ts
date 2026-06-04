import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";
import type { GeminiRawEvent } from "../../../src/main/adapters/gemini-cli/parse.js";

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
  it("exposes normalizeBatches for the scanner seam without changing normalized session truth", async () => {
    const alphaSource = await requireGeminiSource(geminiFixtureRoot, "alpha-project");
    const artifacts = await collectGeminiArtifacts(alphaSource);
    const rawEvents = (
      await Promise.all(
        artifacts.map((artifact) =>
          collectAsync(
            geminiCliAdapter.parseArtifact(artifact, createGeminiAdapterContext(alphaSource.rootPath))
          )
        )
      )
    ).flat();
    const expected = await geminiCliAdapter.normalize(
      {
        source: alphaSource,
        artifacts,
        rawEvents
      },
      createGeminiAdapterContext(alphaSource.rootPath)
    );

    if (!geminiCliAdapter.normalizeBatches) {
      throw new Error("Expected Gemini adapter to expose normalizeBatches.");
    }

    const [batched] = await collectAsync(
      geminiCliAdapter.normalizeBatches(
        {
          source: alphaSource,
          artifacts,
          rawEvents: (async function* (): AsyncIterable<GeminiRawEvent> {
            const reusable: Record<string, unknown> = {};

            for (const event of rawEvents) {
              for (const key of Object.keys(reusable)) {
                delete reusable[key];
              }

              Object.assign(reusable, event, {
                ...(event.diagnostics ? { diagnostics: [...event.diagnostics] } : {}),
                ...(event.source ? { source: { ...event.source } } : {})
              });
              yield reusable as unknown as GeminiRawEvent;
            }
          })()
        },
        createGeminiAdapterContext(alphaSource.rootPath)
      )
    );

    expect(batched?.sessions.map((session) => session.lifecycleStatus)).toEqual(
      expected.sessions.map((session) => session.lifecycleStatus)
    );
    expect(
      batched?.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text
      }))
    ).toEqual(
      expected.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text
      }))
    );
    expect(
      batched?.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        outputArtifactIds: toolCall.outputArtifactIds
      }))
    ).toEqual(
      expected.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        outputArtifactIds: toolCall.outputArtifactIds
      }))
    );
    expect(
      batched?.outputArtifacts.map((artifact) => ({
        id: artifact.id,
        nativeId: artifact.nativeId,
        refPath: artifact.ref?.path
      }))
    ).toEqual(
      expected.outputArtifacts.map((artifact) => ({
        id: artifact.id,
        nativeId: artifact.nativeId,
        refPath: artifact.ref?.path
      }))
    );
  });

  it("maps the representative Gemini source into shared projects, sessions, messages, tools, shell evidence, artifacts, and mutations", async () => {
    const exercised = await exerciseAdapter(geminiCliAdapter, geminiFixtureRoot);
    const { normalized } = exercised;
    const alphaSession = normalized.sessions.find(
      (session) => session.nativeSessionId === "11111111-1111-4111-8111-111111111111"
    );
    const alphaFinalMessage = normalized.messages.find(
      (message) => message.nativeId === "assistant-final-111:9"
    );

    expect(normalized.projects[0]).toMatchObject({
      adapterId: "gemini-cli",
      name: "alpha-project",
      rootPath: "/workspaces/alpha-project"
    });
    expect(normalized.sessions.map((session) => session.lifecycleStatus)).toEqual([
      "completed",
      "cancelled"
    ]);
    expect(normalized.messages.map((message) => message.role)).toEqual(
      expect.arrayContaining(["assistant", "system", "user"])
    );
    expect(
      normalized.messages
        .filter((message) => message.modelName)
        .map((message) => ({
          modelName: message.modelName,
          usage: message.usage
        }))
    ).toEqual(
      expect.arrayContaining([
        {
          modelName: "gemini-3-flash-preview",
          usage: expect.objectContaining({
            inputTokens: 200,
            outputTokens: 80,
            totalTokens: 280
          })
        }
      ])
    );
    expect(normalized.sessions[0]?.usage).toEqual(
      expect.objectContaining({
        inputTokens: 420,
        outputTokens: 110,
        totalTokens: 552
      })
    );
    expect(normalized.toolCalls.map((toolCall) => toolCall.name)).toEqual(
      expect.arrayContaining([
        "read_file",
        "run_shell_command",
        "replace",
        "update_topic"
      ])
    );
	    expect(normalized.shellCommands[0]).toMatchObject({
	      command: "npm run typecheck",
	      outputInline: "Typecheck passed"
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
    expect(alphaSession?.usage).toMatchObject({
      inputTokens: 420,
      cacheReadTokens: 0,
      outputTokens: 110,
      totalTokens: 552
    });
    expect(alphaFinalMessage?.usage).toMatchObject({
      cacheReadTokens: 0,
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280
    });
  });

  it("keeps active sessions honest without requiring sidecars for inline tool results", async () => {
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

    expect(normalized.sessions[0]?.lifecycleStatus).toBe("active");
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "gemini-cli.normalize.missing-sidecar"
    );
  });

  it("discovers and parses Gemini chat sessions stored as JSON arrays", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();

    try {
      const jsonlChatPath = path.join(
        rootPath,
        "beta-project",
        "chats",
        "session-2026-05-23T10-00-33333333-3333-4333-8333-333333333333.jsonl"
      );
      const jsonChatPath = jsonlChatPath.replace(/\.jsonl$/u, ".json");
      const chatRecords = (await readFile(jsonlChatPath, "utf8"))
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown);

      await writeFile(jsonChatPath, `${JSON.stringify(chatRecords, null, 2)}\n`, "utf8");
      await rm(jsonlChatPath);

      const betaSource = await requireGeminiSource(rootPath, "beta-project");
      const artifacts = await collectGeminiArtifacts(betaSource);
      const chatArtifact = artifacts.find(
        (artifact) =>
          artifact.artifactType === "gemini-chat" && artifact.nativeId?.endsWith(".json")
      );

      expect(chatArtifact).toMatchObject({
        artifactType: "gemini-chat",
        mediaType: "application/json",
        parseStrategy: "json"
      });

      const rawEvents = (
        await Promise.all(
          artifacts.map((artifact) =>
            collectAsync(
              geminiCliAdapter.parseArtifact(
                artifact,
                createGeminiAdapterContext(betaSource.rootPath)
              )
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

      expect(normalized.sessions[0]).toMatchObject({
        lifecycleStatus: "active",
        nativeSessionId: "33333333-3333-4333-8333-333333333333"
      });
      expect(normalized.messages.map((message) => message.role)).toEqual(
        expect.arrayContaining(["user"])
      );
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });

  it("surfaces missing sidecars when no inline tool-result evidence is available", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();

    try {
      const chatPath = path.join(
        rootPath,
        "beta-project",
        "chats",
        "session-2026-05-23T10-00-33333333-3333-4333-8333-333333333333.jsonl"
      );
      const rewrittenRows = (await readFile(chatPath, "utf8"))
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const row = JSON.parse(line) as { toolCalls?: Array<Record<string, unknown>> };

          for (const toolCall of row.toolCalls ?? []) {
            delete toolCall.result;
            delete toolCall.resultDisplay;
          }

          return JSON.stringify(row);
        });

      await writeFile(chatPath, `${rewrittenRows.join("\n")}\n`, "utf8");

      const betaSource = await requireGeminiSource(rootPath, "beta-project");
      const artifacts = await collectGeminiArtifacts(betaSource);
      const rawEvents = (
        await Promise.all(
          artifacts.map((artifact) =>
            collectAsync(
              geminiCliAdapter.parseArtifact(
                artifact,
                createGeminiAdapterContext(betaSource.rootPath)
              )
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

      expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "gemini-cli.normalize.missing-sidecar"
      );
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });

  it("keeps duplicate tool-call sidecars ambiguous instead of attaching one sidecar to every duplicate occurrence", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const duplicateToolCallId = "list_directory_1700000004000_0";
    const sidecarRelativePath = path.join(
      "tool-outputs",
      `session-${sessionId}`,
      "list_directory_list_directory_1700000004000_0_a1b2c3.txt"
    );

    try {
      const chatPath = path.join(
        rootPath,
        "beta-project",
        "chats",
        "session-2026-05-23T10-00-33333333-3333-4333-8333-333333333333.jsonl"
      );
      const rows = (await readFile(chatPath, "utf8"))
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { toolCalls?: Array<Record<string, unknown>> });
      let strippedDuplicateCount = 0;

      for (const row of rows) {
        for (const toolCall of row.toolCalls ?? []) {
          if (toolCall.id === duplicateToolCallId && strippedDuplicateCount === 0) {
            delete toolCall.result;
            delete toolCall.resultDisplay;
            strippedDuplicateCount += 1;
            break;
          }
        }
      }

      expect(strippedDuplicateCount).toBe(1);

      await writeFile(
        chatPath,
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
        "utf8"
      );
      await mkdir(path.dirname(path.join(rootPath, "beta-project", sidecarRelativePath)), {
        recursive: true
      });
      await writeFile(
        path.join(rootPath, "beta-project", sidecarRelativePath),
        "src/main\nsrc/renderer\n",
        "utf8"
      );

      const betaSource = await requireGeminiSource(rootPath, "beta-project");
      const artifacts = await collectGeminiArtifacts(betaSource);
      const rawEvents = (
        await Promise.all(
          artifacts.map((artifact) =>
            collectAsync(
              geminiCliAdapter.parseArtifact(
                artifact,
                createGeminiAdapterContext(betaSource.rootPath)
              )
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
      const outputArtifactsById = new Map(
        normalized.outputArtifacts.map((artifact) => [artifact.id, artifact] as const)
      );
      const duplicateToolCalls = normalized.toolCalls.filter(
        (toolCall) => toolCall.nativeToolCallId === duplicateToolCallId
      );
      const linkedSidecarNativeIds = duplicateToolCalls.flatMap((toolCall) =>
        (toolCall.outputArtifactIds ?? []).map(
          (artifactId) => outputArtifactsById.get(artifactId)?.nativeId
        )
      );
      const ambiguityDiagnostics = normalized.diagnostics.filter(
        (diagnostic) => diagnostic.code === "gemini-cli.normalize.ambiguous-sidecar"
      );
      const missingSidecarDiagnostics = normalized.diagnostics.filter(
        (diagnostic) => diagnostic.code === "gemini-cli.normalize.missing-sidecar"
      );

      expect(ambiguityDiagnostics).toHaveLength(1);
      expect(ambiguityDiagnostics[0]?.message).toContain(duplicateToolCallId);
      expect(missingSidecarDiagnostics).toHaveLength(1);
      expect(normalized.outputArtifacts.map((artifact) => artifact.nativeId)).toContain(
        sidecarRelativePath
      );
      expect(linkedSidecarNativeIds).not.toContain(sidecarRelativePath);
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
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

    expect(normalized.sessions[0]?.lifecycleStatus).toBe("completed");
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

  it("keeps malformed chat-row diagnostics distinct after normalization", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();

    try {
      const chatPath = path.join(
        rootPath,
        "alpha-project",
        "chats",
        "session-2026-05-23T09-11-11111111-1111-4111-8111-111111111111.jsonl"
      );

      await writeFile(
        chatPath,
        [
          JSON.stringify({
            sessionId: "11111111-1111-4111-8111-111111111111",
            projectHash: "alpha-project",
            startTime: "2026-05-23T09:11:00.000Z",
            kind: "main"
          }),
          JSON.stringify({
            id: "user-valid-1",
            timestamp: "2026-05-23T09:11:01.000Z",
            type: "user",
            content: [{ text: "first valid row" }]
          }),
          "{malformed-row-3",
          JSON.stringify({
            id: "assistant-valid-1",
            timestamp: "2026-05-23T09:11:02.000Z",
            type: "gemini",
            content: [{ text: "still going" }]
          }),
          "{malformed-row-5",
          JSON.stringify({
            id: "assistant-valid-2",
            timestamp: "2026-05-23T09:11:03.000Z",
            type: "gemini",
            content: [{ text: "final valid row" }]
          })
        ].join("\n"),
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

      const malformedRowDiagnostics = normalized.diagnostics.filter(
        (diagnostic) => diagnostic.code === "gemini-cli.parse.chat-json-line"
      );

      expect(malformedRowDiagnostics).toHaveLength(2);
      expect(new Set(malformedRowDiagnostics.map((diagnostic) => diagnostic.id)).size).toBe(2);
      expect(malformedRowDiagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        expect.stringContaining("row 3"),
        expect.stringContaining("row 5")
      ]);
      expect(normalized.messages.map((message) => message.nativeId)).toEqual(
        expect.arrayContaining(["assistant-valid-2:6", "user-valid-1:2"])
      );
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });

  it("keeps shell failure evidence as output text when Gemini lacks exit-code support", async () => {
    const deltaSource = await requireGeminiSource(geminiFixtureRoot, "delta-project");
    const artifacts = await collectGeminiArtifacts(deltaSource);
    const rawEvents = (
      await Promise.all(
        artifacts.map((artifact) =>
          collectAsync(
            geminiCliAdapter.parseArtifact(artifact, createGeminiAdapterContext(deltaSource.rootPath))
          )
        )
      )
    ).flat();
    const normalized = await geminiCliAdapter.normalize(
      {
        source: deltaSource,
        artifacts,
        rawEvents
      },
      createGeminiAdapterContext(deltaSource.rootPath)
    );

    expect(normalized.sessions[0]?.lifecycleStatus).toBe("cancelled");
    expect(normalized.shellCommands[0]).toMatchObject({
      command: "npm run test -- tests/main/core/run-audit-engine.test.ts",
      outputInline: "1 test failed",
      rawStatus: "success"
    });
    expect(normalized.shellCommands[0]?.source?.eventId).toBe(
      normalized.events.find((event) => event.kind === "shell-command")?.id
    );
    expect(normalized.shellCommands[0]?.rawExitCode).toBeUndefined();
  });

  it("qualifies duplicate Gemini shell tool-call IDs so both commands survive normalization", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();

    try {
      const chatPath = path.join(
        rootPath,
        "alpha-project",
        "chats",
        "session-2026-05-23T09-11-11111111-1111-4111-8111-111111111111.jsonl"
      );
      const sourceText = await readFile(chatPath, "utf8");
      const appendedRecord = JSON.stringify({
        id: "assistant-tools-duplicate-111",
        timestamp: "2026-05-23T09:12:41.497Z",
        type: "gemini",
        content: "",
        toolCalls: [
          {
            id: "run_shell_command_1700000001000_1",
            name: "run_shell_command",
            args: {
              command: "npm run typecheck -- --pretty false",
              cwd: "/workspaces/alpha-project"
            },
            result: [
              {
                functionResponse: {
                  id: "run_shell_command_1700000001000_1",
                  name: "run_shell_command",
                  response: { output: "Typecheck passed again" }
                }
              }
            ],
            status: "success",
            timestamp: "2026-05-23T09:12:41.497Z",
            resultDisplay: "Typecheck passed again",
            description: "Run typecheck again",
            displayName: "Shell",
            renderOutputAsMarkdown: false
          }
        ]
      });

      await writeFile(chatPath, `${sourceText.trimEnd()}\n${appendedRecord}\n`, "utf8");

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
      const duplicateToolCalls = normalized.toolCalls.filter(
        (toolCall) => toolCall.nativeToolCallId === "run_shell_command_1700000001000_1"
      );
      const duplicateShellCommands = normalized.shellCommands.filter((shellCommand) =>
        shellCommand.nativeId?.startsWith("shell:run_shell_command_1700000001000_1")
      );

      expect(duplicateToolCalls).toHaveLength(2);
      expect(new Set(duplicateToolCalls.map((toolCall) => toolCall.id)).size).toBe(2);
      expect(new Set(duplicateToolCalls.map((toolCall) => toolCall.nativeId)).size).toBe(2);
      expect(duplicateShellCommands).toHaveLength(2);
      expect(duplicateShellCommands.map((shellCommand) => shellCommand.command)).toEqual([
        "npm run typecheck",
        "npm run typecheck -- --pretty false"
      ]);
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });

  it("uses inline Gemini tool results when resultDisplay is blank", async () => {
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
        sourceText.replace('"resultDisplay":"Typecheck passed"', '"resultDisplay":""'),
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
      const shellCommand = normalized.shellCommands.find(
        (candidate) => candidate.command === "npm run typecheck"
      );
      const toolCall = normalized.toolCalls.find(
        (candidate) => candidate.nativeToolCallId === "run_shell_command_1700000001000_1"
      );

      expect(shellCommand?.outputInline).toBe("Typecheck passed");
      expect(toolCall?.resultPreview).toBe("Typecheck passed");
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });

  it("hydrates explicit exit-code evidence from structured Gemini JSON sidecars", async () => {
    const { rootPath, tempDir } = await createTempGeminiFixtureRoot();

    try {
      const sidecarPath = path.join(
        rootPath,
        "gamma-project",
        "tool-outputs",
        "session-44444444-4444-4444-8444-444444444444",
        "run_shell_command_1700000006000_0.json"
      );

      await writeFile(
        sidecarPath,
        `${JSON.stringify({ output: "1 test passed", exitCode: 0 })}\n`,
        "utf8"
      );

      const gammaSource = await requireGeminiSource(rootPath, "gamma-project");
      const artifacts = await collectGeminiArtifacts(gammaSource);
      const rawEvents = (
        await Promise.all(
          artifacts.map((artifact) =>
            collectAsync(
              geminiCliAdapter.parseArtifact(
                artifact,
                createGeminiAdapterContext(gammaSource.rootPath)
              )
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

      expect(normalized.shellCommands[0]).toMatchObject({
        command: "npm run test -- tests/main/core/scanner-cache.test.ts",
        outputInline: "1 test passed",
        rawExitCode: 0
      });
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
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
        name: "read_file"
      });
      expect(toolCall?.resultPreview).toBe("contract types...");
    } finally {
      await cleanupTempGeminiFixtureRoot(tempDir);
    }
  });
});
