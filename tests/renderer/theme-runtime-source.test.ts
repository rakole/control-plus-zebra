import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface SourceText {
  file: string;
  text: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rendererRoot = path.join(repoRoot, "src", "renderer");

describe("renderer theme runtime source review", () => {
  it("owns theme through the dedicated preload bridge instead of renderer storage", async () => {
    const sources = await loadRendererSources();
    const filesWithThemeBridge = sources
      .filter((source) => /\bagentWorkbenchTheme\b/u.test(source.text))
      .map((source) => source.file);
    const storageViolations = sources.flatMap((source) =>
      [...source.text.matchAll(/\b(?:localStorage|sessionStorage)\b/gu)].map((match) => ({
        file: source.file,
        match: match[0]
      }))
    );

    expect(filesWithThemeBridge.length).toBeGreaterThan(0);
    expect(storageViolations).toEqual([]);
  });
});

async function loadRendererSources(): Promise<SourceText[]> {
  const files = await collectTypeScriptFiles(rendererRoot);

  return Promise.all(
    files.map(async (file) => ({
      file: normalizeRepoPath(file),
      text: await readFile(file, "utf8")
    }))
  );
}

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return collectTypeScriptFiles(resolved);
      }

      return resolved.endsWith(".ts") || resolved.endsWith(".tsx") ? [resolved] : [];
    })
  );

  return files.flat();
}

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}
