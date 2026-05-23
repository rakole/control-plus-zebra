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

const forbiddenControlPatterns = [
  /\bLaunch\b/u,
  /\bApprove\b/u,
  /\bReject\b/u,
  /\bTerminal\b/u,
  /\bCreate PR\b/u,
  /\bCleanup\b/u,
  /\bDelete\b/u,
  /\bReset\b/u,
  /\bRun command\b/u,
  /\bshell\s+(?:input|control|execution|action)\b/iu,
  /\bexec(?:ute|ution)?\s+(?:command|process|file)\b/iu
] as const;

describe("renderer source boundary", () => {
  it("does not import main-process or adapter-private modules", async () => {
    const sources = await loadRendererSources();
    const imports = sources.flatMap((source) =>
      readImportSpecifiers(source.text).map((specifier) => ({ source, specifier }))
    );

    expect(
      imports.filter(({ specifier }) => {
        const normalized = specifier.replaceAll("\\", "/");

        return (
          normalized.includes("src/main/") ||
          normalized.includes("src/main/adapters/") ||
          normalized.includes("../main/") ||
          normalized.includes("../main/adapters/")
        );
      })
    ).toEqual([]);
  });

  it("contains no provider-specific branching or copy", async () => {
    const sources = await loadRendererSources();
    const text = sources.map((source) => source.text).join("\n");

    expect(text).not.toMatch(/adapterId\s*={0,3}\s*["']gemini-cli["']/u);
    expect(text).not.toMatch(/\bGemini\b/u);
  });

  it("contains no V1 mutation or terminal-control labels", async () => {
    const sources = await loadRendererSources();
    const violations = sources.flatMap((source) =>
      forbiddenControlPatterns
        .filter((pattern) => pattern.test(source.text))
        .map((pattern) => ({ file: source.file, pattern: String(pattern) }))
    );

    expect(violations).toEqual([]);
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

function readImportSpecifiers(text: string): string[] {
  const imports = new Set<string>();
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']/gu;

  for (const match of text.matchAll(pattern)) {
    const specifier = match[1];

    if (specifier) {
      imports.add(specifier);
    }
  }

  return [...imports];
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
