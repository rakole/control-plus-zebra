import { readdir, readFile } from "node:fs/promises";
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
const componentsRoot = path.join(rendererRoot, "components");
const featuresRoot = path.join(rendererRoot, "features");
const routesRoot = path.join(rendererRoot, "routes");
const stylesPath = path.join(rendererRoot, "styles.css");

const legacyClassNames = [
  "app-shell",
  "brand",
  "brand-mark",
  "nav-list",
  "nav-item",
  "nav-item-active",
  "main-column",
  "route-shell",
  "route-header",
  "route-actions",
  "route-kicker",
  "primary-button",
  "secondary-button",
  "preview-panel",
  "source-detail-panel",
  "state-panel",
  "session-row",
  "source-row",
  "detail-input",
  "detail-select",
  "switch-control",
  "switch-track",
  "detail-alert",
  "diagnostic-item",
  "triage-panel",
  "timeline-card",
  "filter-control"
] as const;

const forbiddenStyleSelectors = [
  ...legacyClassNames,
  "sessions-grid",
  "data-sources-grid",
  "triage-grid",
  "detail-field",
  "detail-section",
  "diagnostic-list",
  "timeline-stack",
  "export-panel"
] as const;

const migrationMarkerPattern = /\b(?:legacy|compat|shim|temporary|TODO|FIXME)\b/giu;
const rawPaletteUtilityPattern =
  /\b(?:bg|text|border|ring|outline|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/gu;
const duplicateImplementationTargets = [
  { label: "archive-export", allowedRoot: "src/renderer/components/app/", pattern: /archive-export/u },
  {
    label: "diagnostics-list",
    allowedRoot: "src/renderer/components/app/",
    pattern: /diagnostics-list\.(?:ts|tsx)$/u
  },
  {
    label: "status-badge",
    allowedRoot: "src/renderer/components/app/",
    pattern: /status-badge\.(?:ts|tsx)$/u
  },
  {
    label: "workbench-shell",
    allowedRoot: "src/renderer/components/app/",
    pattern: /workbench-shell\.(?:ts|tsx)$/u
  },
  {
    label: "route-page",
    allowedRoot: "src/renderer/components/app/",
    pattern: /route-page\.(?:ts|tsx)$/u
  },
  { label: "skeleton", allowedRoot: "src/renderer/components/ui/", pattern: /skeleton\.(?:ts|tsx)$/u },
  {
    label: "master-detail",
    allowedRoot: "src/renderer/components/app/",
    pattern: /master-detail(?:-layout)?\.(?:ts|tsx)$/u
  }
] as const;

describe("renderer UI architecture source ratchets", () => {
  it("does not reference legacy semantic UI classes in renderer source", async () => {
    const sources = await loadRendererSources();
    const violations = sources.flatMap((source) =>
      legacyClassNames.flatMap((className) =>
        findStringLiteralClassReferences(source, className).map((line) => ({
          file: source.file,
          line,
          value: className
        }))
      )
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps product color values inside styles.css token declarations only", async () => {
    const sources = await loadRendererSources({ includeCss: true });
    const violations = sources.flatMap((source) =>
      findHexColors(source).filter((violation) => !isAllowedTokenColor(violation, source))
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps product UI selectors out of the global stylesheet", async () => {
    const stylesSource = await readFile(stylesPath, "utf8");
    const violations = forbiddenStyleSelectors.flatMap((className) =>
      findCssClassSelectorLines(stylesSource, className).map((line) => ({
        file: "src/renderer/styles.css",
        line,
        value: `.${className}`
      }))
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps styles.css limited to tokens, theme state, and base/root defaults", async () => {
    const stylesSource = await readFile(stylesPath, "utf8");
    const rootViolations = findNonCustomPropertyDeclarations(stylesSource, ":root").map((line) => ({
      file: "src/renderer/styles.css",
      line,
      value: ":root contains non-token declarations"
    }));
    const darkViolations = findNonCustomPropertyDeclarations(stylesSource, ".dark").map((line) => ({
      file: "src/renderer/styles.css",
      line,
      value: ".dark contains non-token declarations"
    }));
    const classSelectorViolations = findUnexpectedClassSelectors(stylesSource).map((line) => ({
      file: "src/renderer/styles.css",
      line,
      value: "unexpected class selector"
    }));
    const emptyBlockViolations = findEmptyCssBlocks(stylesSource).map((line) => ({
      file: "src/renderer/styles.css",
      line,
      value: "empty selector block"
    }));

    expect(
      formatViolations([
        ...rootViolations,
        ...darkViolations,
        ...classSelectorViolations,
        ...emptyBlockViolations
      ])
    ).toEqual([]);
  });

  it("does not use raw Tailwind palette utilities for product UI surfaces", async () => {
    const sources = await loadRendererSources();
    const violations = sources.flatMap((source) =>
      [...source.text.matchAll(rawPaletteUtilityPattern)].map((match) => ({
        file: source.file,
        line: lineNumberForIndex(source.text, match.index ?? 0),
        value: match[0]
      }))
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps src/renderer/components owned by ui or app only", async () => {
    const entries = await readdir(componentsRoot, { withFileTypes: true });
    const violations = entries
      .filter((entry) => entry.isFile() || (entry.isDirectory() && !["app", "ui"].includes(entry.name)))
      .map((entry) => ({
        file: `src/renderer/components/${entry.name}`,
        value: "components ownership must stay under ui/ or app/"
      }));

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps src/renderer/routes limited to route-registry.tsx", async () => {
    const files = await collectSourceFiles(routesRoot, {});

    expect(files.map((file) => normalizeRepoPath(file)).sort()).toEqual([
      "src/renderer/routes/route-registry.tsx"
    ]);
  });

  it("keeps feature TSX files under feature-local components or routes folders", async () => {
    const featureFiles = await collectSourceFiles(featuresRoot, {});
    const violations = featureFiles
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => !/\/src\/renderer\/features\/[^/]+\/(?:components|routes)\//u.test(file))
      .map((file) => ({
        file: normalizeRepoPath(file),
        value: "feature TSX must live under components/ or routes/"
      }));

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps route implementation files under feature routes only", async () => {
    const rendererFiles = await collectSourceFiles(rendererRoot, {});
    const violations = rendererFiles
      .filter((file) => /(?:^|-)route\.(?:ts|tsx)$/u.test(path.basename(file)))
      .filter(
        (file) =>
          normalizeRepoPath(file) !== "src/renderer/routes/route-registry.tsx" &&
          !/\/src\/renderer\/features\/[^/]+\/routes\//u.test(file)
      )
      .map((file) => ({
        file: normalizeRepoPath(file),
        value: "route implementation outside feature routes"
      }));

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps duplicate shared-surface implementations out of non-owner folders", async () => {
    const rendererFiles = (await collectSourceFiles(rendererRoot, { includeCss: true })).map(normalizeRepoPath);
    const violations = duplicateImplementationTargets.flatMap((target) =>
      rendererFiles
        .filter((file) => target.pattern.test(file))
        .filter((file) => !file.startsWith(target.allowedRoot))
        .map((file) => ({
          file,
          value: `${target.label} implementation outside ${target.allowedRoot}`
        }))
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("removes migration markers from renderer source scope", async () => {
    const sources = await loadRendererSources({ includeCss: true, includeHtml: true });
    const violations = sources.flatMap((source) =>
      [...source.text.matchAll(migrationMarkerPattern)].map((match) => ({
        file: source.file,
        line: lineNumberForIndex(source.text, match.index ?? 0),
        value: match[0]
      }))
    );

    expect(formatViolations(violations)).toEqual([]);
  });
});

async function loadRendererSources(
  options: { includeCss?: boolean; includeHtml?: boolean } = {}
): Promise<SourceText[]> {
  const files = await collectSourceFiles(rendererRoot, options);

  return Promise.all(
    files.map(async (file) => ({
      file: normalizeRepoPath(file),
      text: await readFile(file, "utf8")
    }))
  );
}

async function collectSourceFiles(
  root: string,
  options: { includeCss?: boolean; includeHtml?: boolean }
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(root, entry.name);

      if (entry.name === ".vite") {
        return [];
      }

      if (entry.isDirectory()) {
        return collectSourceFiles(resolved, options);
      }

      if (resolved.endsWith(".ts") || resolved.endsWith(".tsx")) {
        return [resolved];
      }

      if (options.includeCss && resolved.endsWith(".css")) {
        return [resolved];
      }

      if (options.includeHtml && resolved.endsWith(".html")) {
        return [resolved];
      }

      return [];
    })
  );

  return files.flat();
}

function findStringLiteralClassReferences(source: SourceText, className: string): number[] {
  const pattern = new RegExp(`["'\`][^"'\`]*\\b${escapeRegExp(className)}\\b[^"'\`]*["'\`]`, "gu");

  return [...source.text.matchAll(pattern)].map((match) =>
    lineNumberForIndex(source.text, match.index ?? 0)
  );
}

function findHexColors(source: SourceText): Violation[] {
  return [...source.text.matchAll(/#[0-9A-Fa-f]{3,8}\b/gu)].map((match) => ({
    file: source.file,
    line: lineNumberForIndex(source.text, match.index ?? 0),
    value: match[0]
  }));
}

function isAllowedTokenColor(violation: Violation, source: SourceText): boolean {
  if (source.file !== "src/renderer/styles.css" || !violation.line) {
    return false;
  }

  const tokenRanges = findCssBlockRanges(source.text, [":root", ".dark", "@theme inline"]);

  if (!tokenRanges.some(({ start, end }) => violation.line && violation.line >= start && violation.line <= end)) {
    return false;
  }

  const line = source.text.split("\n")[violation.line - 1] ?? "";

  return /^\s*--[\w-]+:\s*#[0-9A-Fa-f]{3,8}\b/u.test(line);
}

function findCssClassSelectorLines(source: string, className: string): number[] {
  const selectorPattern = new RegExp(`(^|[,\\s])\\.${escapeRegExp(className)}(?:\\b|[:.{#\\s,>+~])`, "gu");

  return [...source.matchAll(selectorPattern)].map((match) =>
    lineNumberForIndex(source, match.index ?? 0)
  );
}

function findNonCustomPropertyDeclarations(source: string, blockStart: string): number[] {
  return findCssBlockLines(source, blockStart)
    .filter(({ line }) => {
      const trimmed = line.trim();

      return trimmed.length > 0 && !trimmed.startsWith("--");
    })
    .map(({ number }) => number);
}

function findUnexpectedClassSelectors(source: string): number[] {
  const lines = source.split("\n");
  const violations: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed.endsWith("{")) {
      continue;
    }

    if (
      trimmed.startsWith("@import ") ||
      trimmed.startsWith("@theme inline {") ||
      trimmed.startsWith("@layer base {") ||
      trimmed.startsWith(":root {") ||
      trimmed.startsWith(".dark {")
    ) {
      continue;
    }

    if (/^\.[A-Za-z0-9_-]+(?:\b|[\s>:+.#\[])/u.test(trimmed)) {
      violations.push(index + 1);
    }
  }

  return violations;
}

function findEmptyCssBlocks(source: string): number[] {
  return source
    .split("\n")
    .flatMap((line, index) => (/^[^{]+\{\s*\}$/u.test(line.trim()) ? [index + 1] : []));
}

function findCssBlockRanges(source: string, blockStarts: string[]): Array<{ start: number; end: number }> {
  const lines = source.split("\n");
  const ranges: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!blockStarts.some((blockStart) => trimmed.startsWith(`${blockStart} {`))) {
      continue;
    }

    let depth = 0;

    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      depth += countMatches(line, "{");
      depth -= countMatches(line, "}");

      if (depth === 0) {
        ranges.push({ start: index + 1, end: cursor + 1 });
        index = cursor;
        break;
      }
    }
  }

  return ranges;
}

function findCssBlockLines(
  source: string,
  blockStart: string
): Array<{ number: number; line: string }> {
  const ranges = findCssBlockRanges(source, [blockStart]);

  if (ranges.length === 0) {
    return [];
  }

  const lines = source.split("\n");

  return ranges.flatMap(({ start, end }) =>
    lines
      .slice(start, end - 1)
      .map((line, offset) => ({ number: start + offset + 1, line }))
  );
}

function countMatches(value: string, search: string): number {
  return value.split(search).length - 1;
}

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function formatViolations(violations: Violation[]): string[] {
  return violations.map((violation) =>
    [violation.file, violation.line, violation.value].filter(Boolean).join(":")
  );
}
