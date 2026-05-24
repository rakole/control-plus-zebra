import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface TextViolation {
  file: string;
  match: string;
  reason: string;
}

interface SourceText {
  file: string;
  text: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sharedRoots = [
  path.join(repoRoot, "src", "main", "core"),
  path.join(repoRoot, "src", "main", "app"),
  path.join(repoRoot, "src", "main", "ipc"),
  path.join(repoRoot, "src", "preload"),
  path.join(repoRoot, "src", "renderer")
];
const adapterContractRoot = path.join(repoRoot, "src", "main", "core", "adapter-contract");
const sharedEntityRoot = path.join(repoRoot, "src", "main", "core", "model");
const retiredPublicChannels = [
  "overview:get",
  "sessions:getById",
  "sessions:getDetail",
  "dataSources:list",
  "dataSources:add",
  "dataSources:update",
  "dataSources:setEnabled",
  "dataSources:validate",
  "dataSources:scan"
] as const;

describe("shared naming boundaries", () => {
  it("keeps shared core and renderer free of Gemini-specific symbols and provider branches", async () => {
    const sources = await loadTypeScriptSources(sharedRoots);

    expect(findGeminiSymbolViolations(sources)).toEqual([]);
    expect(findGeminiProviderBranchViolations(sources)).toEqual([]);
  });

  it("rejects Gemini-specific symbols and shared provider branches in synthetic shared code", () => {
    const sources: SourceText[] = [
      {
        file: "src/main/core/synthetic-gemini-symbol.ts",
        text: "export interface GeminiSessionRecord { id: string; }\n"
      },
      {
        file: "src/renderer/synthetic-provider-branch.ts",
        text: "if (adapterId === \"gemini-cli\") {\n  return \"badge\";\n}\n"
      }
    ];

    expect(findGeminiSymbolViolations(sources)).toEqual([
      expect.objectContaining({
        file: "src/main/core/synthetic-gemini-symbol.ts",
        match: "GeminiSessionRecord"
      })
    ]);
    expect(findGeminiProviderBranchViolations(sources)).toEqual([
      expect.objectContaining({
        file: "src/renderer/synthetic-provider-branch.ts",
        match: "adapterId === \"gemini-cli\""
      })
    ]);
  });

	  it("keeps adapter contracts free of verification and audit conclusion fields", async () => {
	    const sources = await loadTypeScriptSources([adapterContractRoot]);

    expect(findConclusionFieldViolations(sources)).toEqual([]);
  });

  it("rejects synthetic conclusion fields in adapter-facing shared contracts", () => {
    const sources: SourceText[] = [
      {
        file: "src/main/core/adapter-contract/synthetic-conclusions.ts",
        text:
          "export interface SyntheticAdapterContract {\n" +
          "  verificationStatus?: \"passed\" | \"failed\";\n" +
          "  runAuditClassification?: string;\n" +
          "  attentionReasons?: string[];\n" +
          "}\n"
      }
    ];

    expect(findConclusionFieldViolations(sources)).toEqual([
      expect.objectContaining({
        file: "src/main/core/adapter-contract/synthetic-conclusions.ts",
        match: "verificationStatus"
      }),
      expect.objectContaining({
        file: "src/main/core/adapter-contract/synthetic-conclusions.ts",
        match: "runAuditClassification"
      }),
      expect.objectContaining({
        file: "src/main/core/adapter-contract/synthetic-conclusions.ts",
        match: "attentionReasons"
      })
    ]);
  });

  it("keeps retired transitional IPC channel aliases out of shared source", async () => {
    const sources = await loadTypeScriptSources(sharedRoots);

    expect(findRetiredChannelViolations(sources)).toEqual([]);
  });
});

async function loadTypeScriptSources(roots: string[]): Promise<SourceText[]> {
  const files = await Promise.all(roots.map((root) => collectTypeScriptFiles(root)));
  const flattened = files.flat();

  return Promise.all(
    flattened.map(async (file) => ({
      file: normalizeRepoPath(file),
      text: await readFile(file, "utf8")
    }))
  );
}

function findGeminiSymbolViolations(sources: SourceText[]): TextViolation[] {
  return collectViolations(
    sources,
    /\b(?:interface|type|class|function|const|let|var|enum)\s+([A-Za-z0-9_$]*Gemini[A-Za-z0-9_$]*)\b/gu,
    "Shared core and renderer must not expose Gemini-specific symbol names."
  );
}

function findGeminiProviderBranchViolations(sources: SourceText[]): TextViolation[] {
  return collectViolations(
    sources,
    /(?:[A-Za-z0-9_.\])]+\s*(?:===|!==|==|!=)\s*["']gemini-cli["']|case\s+["']gemini-cli["'])/gu,
    "Shared core and renderer must not branch on Gemini provider IDs."
  );
}

function findConclusionFieldViolations(sources: SourceText[]): TextViolation[] {
  return collectViolations(
    sources,
    /\b(?:readonly\s+)?(verification(?:Status|State|Result)?|runAudit(?:Status|Classification)?|attentionReason(?:s)?)\b\s*[?:]/gu,
    "Adapter-facing shared contracts must emit evidence and diagnostics only, not final conclusions."
  );
}

function findRetiredChannelViolations(sources: SourceText[]): TextViolation[] {
  return sources.flatMap((source) =>
    retiredPublicChannels.flatMap((channel) =>
      source.text.includes(channel)
        ? [
            {
              file: source.file,
              match: channel,
              reason: "Retired transitional IPC channel aliases must not remain public source."
            }
          ]
        : []
    )
  );
}

function collectViolations(
  sources: SourceText[],
  pattern: RegExp,
  reason: string
): TextViolation[] {
  const violations: TextViolation[] = [];

  for (const source of sources) {
    for (const match of source.text.matchAll(pattern)) {
      violations.push({
        file: source.file,
        match: match[1] ?? match[0],
        reason
      });
    }
  }

  return violations;
}

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  try {
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
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }

    throw error;
  }
}

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
