import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface SourceText {
  file: string;
  text: string;
}

interface ForbiddenPattern {
  name: string;
  pattern: RegExp;
  reason: string;
}

interface ForbiddenApiViolation {
  file: string;
  match: string;
  reason: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rendererRoot = path.join(repoRoot, "src", "renderer");

const forbiddenPatterns: ForbiddenPattern[] = [
  moduleImportPattern("node:fs", "Renderer code must not import filesystem APIs."),
  moduleImportPattern("fs", "Renderer code must not import filesystem APIs."),
  moduleImportPattern(
    "node:child_process",
    "Renderer code must not import shell execution APIs."
  ),
  moduleImportPattern("child_process", "Renderer code must not import shell execution APIs."),
  moduleImportPattern("electron", "Renderer code must not import Electron APIs."),
  {
    name: "ipcRenderer",
    pattern: /\bipcRenderer\b/gu,
    reason: "Renderer code must use the typed preload bridge, not ipcRenderer."
  },
  {
    name: "window.require",
    pattern: /\bwindow\s*\.\s*require\b/gu,
    reason: "Renderer code must not use window.require."
  },
  {
    name: "require(",
    pattern: /\brequire\s*\(/gu,
    reason: "Renderer code must not use CommonJS require."
  },
  {
    name: "process.env",
    pattern: /\bprocess\s*\.\s*env\b/gu,
    reason: "Renderer code must not read process.env."
  },
  {
    name: "process.cwd",
    pattern: /\bprocess\s*\.\s*cwd\b/gu,
    reason: "Renderer code must not read the current working directory."
  },
  {
    name: "eval(",
    pattern: /\beval\s*\(/gu,
    reason: "Renderer code must not evaluate strings as code."
  },
  {
    name: "new Function",
    pattern: /\bnew\s+Function\b/gu,
    reason: "Renderer code must not construct functions from strings."
  }
];

describe("renderer forbidden APIs", () => {
  it("keeps renderer TypeScript sources free of Node, Electron, process, require, and dynamic code APIs", async () => {
    const sources = await loadRendererSources();

    expect(sources.map((source) => source.file).sort()).toEqual(
      expect.arrayContaining(["src/renderer/App.tsx", "src/renderer/main.tsx"])
    );
    expect(findForbiddenApiViolations(sources)).toEqual([]);
  });

  it("rejects synthetic renderer usage of shell, IPC, require, process, and dynamic code APIs", () => {
    const syntheticFile = "src/renderer/synthetic-forbidden-apis.tsx";
    const sources: SourceText[] = [
      {
        file: syntheticFile,
        text: [
          "import { spawn } from \"child_process\";",
          "import { ipcRenderer } from \"electron\";",
          "window.require(\"fs\");",
          "process.cwd();",
          "eval(\"1 + 1\");",
          "new Function(\"return 1\");"
        ].join("\n")
      }
    ];

    expect(findForbiddenApiViolations(sources)).toEqual([
      expect.objectContaining({ file: syntheticFile, match: "fs" }),
      expect.objectContaining({ file: syntheticFile, match: "child_process" }),
      expect.objectContaining({ file: syntheticFile, match: "electron" }),
      expect.objectContaining({ file: syntheticFile, match: "ipcRenderer" }),
      expect.objectContaining({ file: syntheticFile, match: "window.require" }),
      expect.objectContaining({ file: syntheticFile, match: "require(" }),
      expect.objectContaining({ file: syntheticFile, match: "process.cwd" }),
      expect.objectContaining({ file: syntheticFile, match: "eval(" }),
      expect.objectContaining({ file: syntheticFile, match: "new Function" })
    ]);
  });
});

function moduleImportPattern(moduleName: string, reason: string): ForbiddenPattern {
  const escaped = escapeRegExp(moduleName);

  return {
    name: moduleName,
    pattern: new RegExp(
      `(?:from\\s+["']${escaped}["']|import\\s*\\(\\s*["']${escaped}["']\\s*\\)|require\\s*\\(\\s*["']${escaped}["']\\s*\\))`,
      "gu"
    ),
    reason
  };
}

async function loadRendererSources(): Promise<SourceText[]> {
  const files = await collectTypeScriptFiles(rendererRoot);

  return Promise.all(
    files.map(async (file) => ({
      file: normalizeRepoPath(file),
      text: await readFile(file, "utf8")
    }))
  );
}

function findForbiddenApiViolations(sources: SourceText[]): ForbiddenApiViolation[] {
  const violations: ForbiddenApiViolation[] = [];

  for (const source of sources) {
    for (const forbidden of forbiddenPatterns) {
      for (const match of source.text.matchAll(forbidden.pattern)) {
        violations.push({
          file: source.file,
          match: normalizeMatch(forbidden.name, match[0]),
          reason: forbidden.reason
        });
      }
    }
  }

  return violations;
}

function normalizeMatch(name: string, matchedText: string): string {
  if (name === "window.require") {
    return "window.require";
  }

  if (name === "process.env") {
    return "process.env";
  }

  if (name === "process.cwd") {
    return "process.cwd";
  }

  if (name === "eval(") {
    return "eval(";
  }

  if (name === "new Function") {
    return "new Function";
  }

  if (name === "require(") {
    return "require(";
  }

  return matchedText.includes(name) ? name : matchedText;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
