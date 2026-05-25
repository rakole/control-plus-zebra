import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";
import type { GeminiRawEvent } from "../../../src/main/adapters/gemini-cli/parse.js";

import { collectAsync } from "../../contract/run-adapter-contract.js";

import {
  collectGeminiArtifacts,
  createGeminiAdapterContext,
  geminiFixtureRoot,
  requireGeminiSource
} from "./test-helpers.js";

describe("gemini-cli parsing", () => {
  it("parses chat, logs, project-root, and sidecar artifacts into adapter-private raw events", async () => {
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

    expect(rawEvents.some((event) => event.payload.kind === "project-root")).toBe(true);
    expect(rawEvents.some((event) => event.payload.kind === "logs-entry")).toBe(true);
    expect(rawEvents.some((event) => event.payload.kind === "session-header")).toBe(true);
    expect(rawEvents.some((event) => event.payload.kind === "metadata-patch")).toBe(true);
    expect(rawEvents.some((event) => event.payload.kind === "transcript-record")).toBe(true);
    expect(rawEvents.some((event) => event.payload.kind === "tool-output-sidecar")).toBe(true);
  });

  it("keeps chat chronology in order and preserves tool-call rich transcript rows", async () => {
    const alphaSource = await requireGeminiSource(geminiFixtureRoot, "alpha-project");
    const artifacts = await collectGeminiArtifacts(alphaSource);
    const chatArtifact = artifacts.find(
      (artifact) =>
        artifact.nativeId ===
        "chats/session-2026-05-23T09-11-11111111-1111-4111-8111-111111111111.jsonl"
    );

    if (!chatArtifact) {
      throw new Error("Expected the alpha chat artifact.");
    }

    const rawEvents = await collectAsync(
      geminiCliAdapter.parseArtifact(chatArtifact, createGeminiAdapterContext(alphaSource.rootPath))
    );
    const transcriptRows = rawEvents.filter(
      (event): event is GeminiRawEvent & { payload: { kind: "transcript-record" } } =>
        event.payload.kind === "transcript-record"
    );

    expect(rawEvents[0]?.payload.kind).toBe("session-header");
    expect(transcriptRows.map((event) => event.payload.record.type)).toEqual([
      "info",
      "user",
      "gemini",
      "gemini",
      "gemini",
      "gemini"
    ]);
    expect(
      transcriptRows.find((event) => event.payload.record.toolCalls?.length)?.payload.record.toolCalls
    ).toHaveLength(3);
  });

  it("emits diagnostics for corrupt rows and malformed sidecars while preserving later valid evidence", async () => {
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

    const parseDiagnostics = rawEvents.filter(
      (event): event is GeminiRawEvent & { payload: { kind: "parse-diagnostic" } } =>
        event.payload.kind === "parse-diagnostic"
    );

    expect(
      parseDiagnostics.map((event) => event.payload.diagnostic.code)
    ).toEqual(
      expect.arrayContaining([
        "gemini-cli.parse.chat-json-line",
        "gemini-cli.parse.tool-output-json"
      ])
    );
    expect(
      rawEvents.some(
        (event) =>
          event.payload.kind === "transcript-record" &&
          event.payload.record.id === "assistant-444"
      )
    ).toBe(true);
  });

  it("recognizes both plain-text and JSON-wrapped tool-output sidecars", async () => {
    const alphaSource = await requireGeminiSource(geminiFixtureRoot, "alpha-project");
    const artifacts = await collectGeminiArtifacts(alphaSource);
    const sidecarEvents = (
      await Promise.all(
        artifacts
          .filter((artifact) => artifact.artifactType === "gemini-tool-output")
          .map((artifact) =>
            collectAsync(
              geminiCliAdapter.parseArtifact(artifact, createGeminiAdapterContext(alphaSource.rootPath))
            )
          )
      )
    )
      .flat()
      .filter(
        (event): event is GeminiRawEvent & { payload: { kind: "tool-output-sidecar" } } =>
          event.payload.kind === "tool-output-sidecar"
      );

    expect(
      sidecarEvents.map((event) => ({
        format: event.payload.format,
        toolCallId: event.payload.toolCallId
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          format: "text",
          toolCallId: "read_file_1700000000000_0"
        },
        {
          format: "json",
          toolCallId: "replace_1700000002000_2"
        }
      ])
    );
  });

  it("streams large JSONL chat artifacts row-by-row and continues after malformed rows", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-large-gemini-chat-"));

    try {
      const sourceRoot = path.join(tempDir, "large-project");
      const chatsDir = path.join(sourceRoot, "chats");
      const chatPath = path.join(
        chatsDir,
        "session-2026-05-25T00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
      );

      await mkdir(chatsDir, { recursive: true });
      await writeFile(
        chatPath,
        [
          JSON.stringify({
            sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            projectHash: "large-project",
            startTime: "2026-05-25T00:00:00.000Z",
            kind: "main"
          }),
          ...Array.from({ length: 5_000 }, (_, index) =>
            index === 2_500
              ? "{malformed"
              : JSON.stringify({
                  id: `message-${index}`,
                  timestamp: "2026-05-25T00:00:01.000Z",
                  type: index % 2 === 0 ? "user" : "gemini",
                  content: [{ text: `row ${index}` }]
                })
          )
        ].join("\n"),
        "utf8"
      );

      const rawEvents = await collectAsync(
        geminiCliAdapter.parseArtifact(
          {
            id: "large-chat-artifact",
            adapterId: "gemini-cli",
            sourceId: "large-source",
            path: chatPath,
            nativeId: "chats/session-large.jsonl",
            artifactKind: "session-log",
            artifactType: "gemini-chat",
            mediaType: "application/x-ndjson",
            parseStrategy: "stream-jsonl"
          },
          createGeminiAdapterContext(sourceRoot)
        )
      );

      expect(rawEvents.filter((event) => event.payload.kind === "transcript-record")).toHaveLength(
        4_999
      );
      expect(
        rawEvents.some(
          (event) =>
            event.payload.kind === "parse-diagnostic" &&
            event.payload.diagnostic.code === "gemini-cli.parse.chat-json-line"
        )
      ).toBe(true);
      expect(
        rawEvents.some(
          (event) =>
            event.payload.kind === "transcript-record" &&
            event.payload.record.id === "message-4999"
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps oversized tool-output sidecars lazy during parse", async () => {
    const alphaSource = await requireGeminiSource(geminiFixtureRoot, "alpha-project");
    const rawEvents = await collectAsync(
      geminiCliAdapter.parseArtifact(
        {
          id: "large-tool-output-artifact",
          adapterId: "gemini-cli",
          sourceId: alphaSource.id,
          path: path.join(
            alphaSource.rootPath,
            "tool-outputs",
            "session-11111111-1111-4111-8111-111111111111",
            "run_shell_command_large_0.txt"
          ),
          nativeId:
            "tool-outputs/session-11111111-1111-4111-8111-111111111111/run_shell_command_large_0.txt",
          artifactKind: "output-artifact",
          artifactType: "gemini-tool-output",
          mediaType: "text/plain",
          parseStrategy: "text",
          byteLength: 2 * 1024 * 1024
        },
        createGeminiAdapterContext(alphaSource.rootPath)
      )
    );

    expect(rawEvents).toHaveLength(1);
    const event = rawEvents[0];

    expect(event?.payload.kind).toBe("tool-output-sidecar");
    if (!event || event.payload.kind !== "tool-output-sidecar") {
      throw new Error("Expected a lazy tool-output sidecar event.");
    }

    expect(event.payload.textPreview).toContain("bounded lazy loading");
    expect(rawEvents[0]?.payload.kind).not.toBe("parse-diagnostic");
  });
});
