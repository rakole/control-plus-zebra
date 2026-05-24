import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface SourceText {
  file: string;
  text: string;
}

interface Violation {
  file: string;
  line?: number;
  value: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rendererRoot = path.join(repoRoot, "src", "renderer");
const bridgeRoot = path.join(rendererRoot, "bridge");
const legacyDataSourcesBridgePath = path.join(rendererRoot, "data-sources-bridge.ts");

describe("renderer bridge structure contract", () => {
  it("requires the dedicated bridge modules under src/renderer/bridge", async () => {
    expect(await fileExists(path.join(bridgeRoot, "agent-workbench.ts"))).toBe(true);
    expect(await fileExists(path.join(bridgeRoot, "data-sources.ts"))).toBe(true);
    expect(await fileExists(path.join(bridgeRoot, "theme.ts"))).toBe(true);
  });

  it("removes the legacy flat data-sources bridge file", async () => {
    expect(await fileExists(legacyDataSourcesBridgePath)).toBe(false);
  });

  it("keeps direct window.agentWorkbench access inside bridge modules only", async () => {
    const sources = await loadRendererSources();
    const violations = sources.flatMap((source) => {
      if (source.file.startsWith("src/renderer/bridge/")) {
        return [];
      }

      return [...source.text.matchAll(/\bwindow\.agentWorkbench\b/gu)].map((match) => ({
        file: source.file,
        line: lineNumberForIndex(source.text, match.index ?? 0),
        value: match[0]
      }));
    });

    expect(formatViolations(violations)).toEqual([]);
  });

  it("routes and renderer consumers import typed bridge wrappers instead of legacy seams", async () => {
    const rendererSources = await loadRendererSources();
    const consumerSources = rendererSources.filter((source) => !source.file.startsWith("src/renderer/bridge/"));
    const bridgeImports = consumerSources.flatMap((source) =>
      readImportSpecifiers(source.text)
        .filter((specifier) => specifier.includes("/bridge/") || specifier.startsWith("../bridge/"))
        .map((specifier) => ({ file: source.file, specifier }))
    );
    const legacyImports = consumerSources.flatMap((source) =>
      readImportSpecifiers(source.text)
        .filter((specifier) => specifier.includes("data-sources-bridge"))
        .map((specifier) => ({ file: source.file, specifier }))
    );

    expect(bridgeImports.length).toBeGreaterThan(0);
    expect(legacyImports).toEqual([]);
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadRendererSources(): Promise<SourceText[]> {
  return loadSourcesFrom(rendererRoot);
}

async function loadSourcesFrom(root: string): Promise<SourceText[]> {
  const files = await collectTypeScriptFiles(root);

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

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function formatViolations(violations: Violation[]): string[] {
  return violations.map((violation) =>
    violation.line
      ? `${violation.file}:${violation.line} ${violation.value}`
      : `${violation.file} ${violation.value}`
  );
}
