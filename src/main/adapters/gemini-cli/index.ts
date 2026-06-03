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
import {
  normalizeGeminiCliEventBatches,
  normalizeGeminiCliEvents
} from "./normalize.js";
import { parseGeminiCliArtifact, type GeminiRawEvent } from "./parse.js";
import { extractGeminiJsonOutputEnvelope } from "./tool-output.js";

export const geminiCliAdapter: SessionSourceAdapter<GeminiRawEvent> = {
  descriptor: geminiCliDescriptor,
  async getDefaultSourceRoots() {
    return geminiCliDescriptor.defaultRoots;
  },
  validateSourceRoot: validateGeminiCliSourceRoot,
  discoverSources: discoverGeminiCliSources,
  discoverArtifacts: discoverGeminiCliArtifacts,
  parseArtifact: parseGeminiCliArtifact,
  async normalize(input) {
    return normalizeGeminiCliEvents(input);
  },
  normalizeBatches(input) {
    return normalizeGeminiCliEventBatches(input);
  },
  async loadOutputArtifact(artifact, context): Promise<LoadedOutputArtifact> {
    const binding = "ref" in artifact ? artifact.ref : undefined;
    const targetPath = binding?.path ?? artifact.path;

    if (!targetPath) {
      return { artifact };
    }

    const rawText = await adapterReadTextFile(context, targetPath, binding?.id ?? artifact.id);
    const mediaType =
      artifact.mediaType ??
      (artifact.contentKind === "json" || artifact.contentKind === "json-output-wrapper"
        ? "application/json"
        : "text/plain");

    if (mediaType === "application/json") {
      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const text = extractGeminiJsonOutputEnvelope(parsed).text ?? rawText;

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

export { geminiCliDescriptor } from "./descriptor.js";
export type { GeminiRawEvent } from "./parse.js";
export * from "./types.js";
