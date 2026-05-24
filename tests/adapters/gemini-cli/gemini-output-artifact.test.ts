import { describe, expect, it } from "vitest";

import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import { collectAsync, exerciseAdapter } from "../../contract/run-adapter-contract.js";

import {
  collectGeminiArtifacts,
  createGeminiAdapterContext,
  createGeminiArtifactContext,
  geminiFixtureRoot,
  requireGeminiSource
} from "./test-helpers.js";

describe("gemini-cli output artifact loading", () => {
  it("loads both plain-text and JSON-wrapped sidecars lazily through the artifact allowlist", async () => {
    const exercised = await exerciseAdapter(geminiCliAdapter, geminiFixtureRoot);
    const artifactContext = createGeminiArtifactContext(exercised.source.rootPath, exercised.artifacts);
	    const textArtifact = exercised.normalized.outputArtifacts.find((artifact) =>
	      (artifact.nativeId ?? artifact.nativeRef ?? "").endsWith("read_file_read_file_1700000000000_0_a1b2c3.txt")
	    );
	    const jsonArtifact = exercised.normalized.outputArtifacts.find((artifact) =>
	      (artifact.nativeId ?? artifact.nativeRef ?? "").endsWith("replace_replace_1700000002000_2_a4b5c6.json")
	    );

    if (!textArtifact || !jsonArtifact || !geminiCliAdapter.loadOutputArtifact) {
      throw new Error("Expected Gemini output artifacts and lazy loader.");
    }

    const loadedText = await geminiCliAdapter.loadOutputArtifact(textArtifact, artifactContext);
    const loadedJson = await geminiCliAdapter.loadOutputArtifact(jsonArtifact, artifactContext);

    expect(loadedText.text).toContain("Contract types");
    expect(loadedJson.text).toBe("Updated contract types and capability fields.");
  });

  it("surfaces missing-sidecar diagnostics instead of fabricating output artifacts", async () => {
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

    expect(normalized.outputArtifacts).toEqual([]);
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "gemini-cli.normalize.missing-sidecar"
    );
  });
});
