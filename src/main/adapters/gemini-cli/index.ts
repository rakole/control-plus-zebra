import path from "node:path";

import type { SessionSourceAdapter } from "../../core/adapter-contract/session-source-adapter.js";
import type {
  AdapterContext,
  LoadedOutputArtifact
} from "../../core/adapter-contract/types.js";
import { adapterReadTextFile } from "../../core/adapter-contract/context-helpers.js";
import type { WatchPlan } from "../../core/watcher/watch-plan.js";
import { createSafeFilesystem } from "../../core/security/safe-filesystem.js";

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
  async getWatchPlan(source, context): Promise<WatchPlan> {
    return {
      adapterId: geminiCliDescriptor.id,
      sourceId: source.id,
      status: "supported",
      scopePaths: await buildGeminiWatchScopePaths(source.rootPath, context),
      strategy: "native",
      reason: "Gemini CLI artifacts are watched by mtime and refreshed through background snapshot scans."
    };
  }
};

export { geminiCliDescriptor } from "./descriptor.js";
export type { GeminiRawEvent } from "./parse.js";
export * from "./types.js";

async function buildGeminiWatchScopePaths(
  rootPath: string,
  context: AdapterContext
): Promise<string[]> {
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedRootPaths: [rootPath]
    });
  const candidates = [
    rootPath,
    path.join(rootPath, "chats"),
    path.join(rootPath, "tool-outputs"),
    path.join(rootPath, "logs.json"),
    path.join(rootPath, ".project_root")
  ];
  const scopePaths: string[] = [];

  for (const candidate of candidates) {
    try {
      await safeFilesystem.statPath(candidate);
      scopePaths.push(candidate);
    } catch {
      // Optional Gemini artifact locations may not exist yet.
    }
  }

  return scopePaths.length > 0 ? scopePaths : [rootPath];
}
