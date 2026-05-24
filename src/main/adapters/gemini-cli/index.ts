import type { SessionSourceAdapter } from "../../core/adapter-contract/session-source-adapter.js";
import type { LoadedOutputArtifact } from "../../core/adapter-contract/types.js";
import { adapterReadTextFile } from "../../core/adapter-contract/context-helpers.js";
import type { WatchPlan } from "../../core/watcher/watch-plan.js";

import { geminiCliDescriptor } from "./descriptor.js";
import {
  discoverGeminiCliArtifacts,
  discoverGeminiCliSources,
  validateGeminiCliSourceRoot
} from "./discovery.js";
import { normalizeGeminiCliEvents, type GeminiOutputArtifactBinding } from "./normalize.js";
import { parseGeminiCliArtifact, type GeminiRawEvent } from "./parse.js";

const outputArtifactBindings = new Map<string, GeminiOutputArtifactBinding>();

export const geminiCliAdapter: SessionSourceAdapter<GeminiRawEvent> = {
  descriptor: geminiCliDescriptor,
  async getDefaultSourceRoots() {
    return geminiCliDescriptor.defaultRoots;
  },
  validateSourceRoot: validateGeminiCliSourceRoot,
  discoverSources: discoverGeminiCliSources,
  discoverArtifacts: discoverGeminiCliArtifacts,
  parseArtifact: parseGeminiCliArtifact,
  async normalize(input, context) {
    const normalized = await normalizeGeminiCliEvents(input);
    const { extras, ...publicNormalized } = normalized;

    outputArtifactBindings.clear();
    extras.outputArtifactBindings.forEach((binding, artifactId) => {
      outputArtifactBindings.set(artifactId, binding);
    });

    return publicNormalized;
  },
  async loadOutputArtifact(artifact, context): Promise<LoadedOutputArtifact> {
    const binding = outputArtifactBindings.get(artifact.id);

    if (!binding) {
      return { artifact };
    }

    const rawText = await adapterReadTextFile(context, binding.path, binding.rawArtifactId);
	    const mediaType =
	      artifact.mediaType ??
	      (artifact.contentKind === "json" || artifact.contentKind === "json-output-wrapper"
	        ? "application/json"
	        : "text/plain");

    if (mediaType === "application/json") {
      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const text = extractJsonWrappedOutputText(parsed) ?? rawText;

        return {
          artifact,
          text,
          mediaType
        };
      } catch {
        return {
          artifact,
          text: rawText,
          mediaType
        };
      }
    }

    return {
      artifact,
      text: rawText,
      mediaType
    };
  },
  async getWatchPlan(source): Promise<WatchPlan> {
    return {
      adapterId: geminiCliDescriptor.id,
      sourceId: source.id,
      status: "unsupported",
      scopePaths: [],
      strategy: "none",
      reason: "Gemini CLI artifact watching is not supported in this Wave 2 adapter contract slice."
    };
  }
};

function extractJsonWrappedOutputText(candidate: Record<string, unknown>): string | undefined {
  const directTextKeys = ["content", "output", "text", "result"] as const;

  for (const key of directTextKeys) {
    const value = candidate[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

export { geminiCliDescriptor } from "./descriptor.js";
export type { GeminiRawEvent } from "./parse.js";
export * from "./types.js";
