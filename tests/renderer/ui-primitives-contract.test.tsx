import { access, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState, type ComponentType } from "react";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const uiRoot = path.join(repoRoot, "src", "renderer", "components", "ui");

const requiredPrimitives = [
  "button",
  "badge",
  "card",
  "separator",
  "skeleton",
  "alert",
  "tooltip",
  "dropdown-menu",
  "scroll-area",
  "resizable",
  "empty",
  "spinner",
  "field",
  "label",
  "input",
  "textarea",
  "select",
  "native-select",
  "switch",
  "checkbox",
  "table",
  "tabs",
  "progress",
  "dialog",
  "alert-dialog",
  "popover"
] as const;

type PrimitiveName = (typeof requiredPrimitives)[number];

const immediatePrimitiveModules = import.meta.glob("../../src/renderer/components/ui/*.{ts,tsx}");

const builtins = new Set(
  builtinModules.flatMap((moduleName) =>
    moduleName.startsWith("node:")
      ? [moduleName, moduleName.slice("node:".length)]
      : [moduleName, `node:${moduleName}`]
  )
);

const rawPaletteUtilityPattern =
  /\b(?:bg|text|border|ring|outline|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/gu;

const forbiddenProductHexes = [
  "#2563EB",
  "#F8FAFC",
  "#CBD5E1",
  "#111827",
  "#64748B"
] as const;

describe("renderer ui primitive inventory and source contracts", () => {
  it("requires the full Shadcn primitive inventory under src/renderer/components/ui", async () => {
    const missing = await findMissingPrimitives();

    expect(missing).toEqual([]);
  });

  it("keeps primitive sources free of view models, renderer bridges, routes, adapters, main/preload, Electron, and Node imports", async () => {
    const sources = await loadPrimitiveSources();
    const violations = sources.flatMap((source) =>
      readImportSpecifiers(source.text)
        .map((specifier) => ({
          file: source.file,
          line: lineNumberForSpecifier(source.text, specifier),
          specifier,
          reason: classifyForbiddenImport(specifier)
        }))
        .filter((violation) => Boolean(violation.reason))
        .map((violation) => ({
          ...violation,
          reason: violation.reason ?? ""
        }))
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps primitive sources free of hard-coded product colors", async () => {
    const sources = await loadPrimitiveSources();
    const violations = sources.flatMap((source) => [
      ...findForbiddenHexViolations(source),
      ...findForbiddenPaletteViolations(source)
    ]);

    expect(formatViolations(violations)).toEqual([]);
  });
});

describe("Button primitive contract", () => {
  it("renders an accessible button and preserves disabled destructive usage", async () => {
    const module = await importPrimitiveModule("button");
    const Button = module.Button as ComponentType<Record<string, unknown>>;

    render(
      <Button disabled size="sm" variant="destructive">
        Delete source
      </Button>
    );

    expect(screen.getByRole("button", { name: "Delete source" })).toBeDisabled();
  });
});

describe("Badge primitive contract", () => {
  it("renders visible status text across supported variants", async () => {
    const module = await importPrimitiveModule("badge");
    const Badge = module.Badge as ComponentType<Record<string, unknown>>;

    render(
      <div>
        <Badge>Unknown</Badge>
        <Badge variant="secondary">Supported</Badge>
        <Badge variant="destructive">Failed</Badge>
      </div>
    );

    expect(screen.getByText("Unknown")).toBeVisible();
    expect(screen.getByText("Supported")).toBeVisible();
    expect(screen.getByText("Failed")).toBeVisible();
  });
});

describe("Card primitive contract", () => {
  it("provides the standard card surface subcomponents for section content", async () => {
    const module = await importPrimitiveModule("card");
    const Card = module.Card as ComponentType<Record<string, unknown>>;
    const CardHeader = module.CardHeader as ComponentType<Record<string, unknown>>;
    const CardTitle = module.CardTitle as ComponentType<Record<string, unknown>>;
    const CardDescription = module.CardDescription as ComponentType<Record<string, unknown>>;
    const CardContent = module.CardContent as ComponentType<Record<string, unknown>>;
    const CardFooter = module.CardFooter as ComponentType<Record<string, unknown>>;

    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Session overview</CardTitle>
          <CardDescription>Latest normalized run evidence.</CardDescription>
        </CardHeader>
        <CardContent>Primary content</CardContent>
        <CardFooter>Footer actions</CardFooter>
      </Card>
    );

    const card = screen.getByTestId("card");

    expect(within(card).getByText("Session overview")).toBeVisible();
    expect(within(card).getByText("Latest normalized run evidence.")).toBeVisible();
    expect(within(card).getByText("Primary content")).toBeVisible();
    expect(within(card).getByText("Footer actions")).toBeVisible();
  });

  it("exports a BentoGrid card layout with status, tags, and call to action metadata", async () => {
    const module = await importPrimitiveModule("card");
    const BentoGrid = module.BentoGrid as ComponentType<Record<string, unknown>>;

    render(
      <BentoGrid
        data-testid="bento-grid"
        items={[
          {
            title: "Audit Signals",
            meta: "Live",
            description: "Verification, git, and parser evidence grouped for review.",
            icon: <span aria-hidden="true">A</span>,
            status: "Unknown",
            tags: ["Verification", "Git"],
            cta: "Review ->",
            colSpan: 2,
            hasPersistentHover: true
          }
        ]}
      />
    );

    const grid = screen.getByTestId("bento-grid");

    expect(within(grid).getByText("Audit Signals")).toBeVisible();
    expect(
      within(grid).getByText("Verification, git, and parser evidence grouped for review.")
    ).toBeVisible();
    expect(within(grid).getByText("Unknown")).toBeVisible();
    expect(within(grid).getByText("#Verification")).toBeVisible();
    expect(within(grid).getByText("Review ->")).toBeInTheDocument();
  });
});

describe("Resizable primitive contract", () => {
  it("marks split panels as shrinkable flex children in source", async () => {
    const source = await readFile(path.join(uiRoot, "resizable.tsx"), "utf8");

    expect(source).toMatch(/className=\{cn\("min-w-0 min-h-0", className\)\}/u);
  });
});

describe("Input primitive contract", () => {
  it("renders a labeled text input with disabled state support", async () => {
    const module = await importPrimitiveModule("input");
    const Input = module.Input as ComponentType<Record<string, unknown>>;

    render(
      <label>
        Source path
        <Input aria-label="Source path" defaultValue="/tmp/session" disabled />
      </label>
    );

    const input = screen.getByRole("textbox", { name: "Source path" });

    expect(input).toBeDisabled();
    expect(input).toHaveValue("/tmp/session");
  });
});

describe("Switch primitive contract", () => {
  it("renders a switch role and reports checked changes through onCheckedChange", async () => {
    const module = await importPrimitiveModule("switch");
    const Switch = module.Switch as ComponentType<Record<string, unknown>>;
    const user = userEvent.setup();

    function SwitchHarness() {
      const [checked, setChecked] = useState(false);

      return (
        <Switch
          aria-label="Enable watcher"
          checked={checked}
          onCheckedChange={(next: boolean) => setChecked(next)}
        />
      );
    }

    render(<SwitchHarness />);

    const toggle = screen.getByRole("switch", { name: "Enable watcher" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

describe("Alert primitive contract", () => {
  it("renders alert content and accepts destructive treatment for failures", async () => {
    const module = await importPrimitiveModule("alert");
    const Alert = module.Alert as ComponentType<Record<string, unknown>>;
    const AlertTitle = module.AlertTitle as ComponentType<Record<string, unknown>>;
    const AlertDescription = module.AlertDescription as ComponentType<Record<string, unknown>>;

    render(
      <Alert variant="destructive">
        <AlertTitle>Scan failed</AlertTitle>
        <AlertDescription>Root path was not readable.</AlertDescription>
      </Alert>
    );

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Scan failed")).toBeVisible();
    expect(within(alert).getByText("Root path was not readable.")).toBeVisible();
  });
});

describe("Skeleton primitive contract", () => {
  it("renders a decorative placeholder surface", async () => {
    const module = await importPrimitiveModule("skeleton");
    const Skeleton = module.Skeleton as ComponentType<Record<string, unknown>>;

    render(<Skeleton data-testid="skeleton" className="h-4 w-32" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toBeEmptyDOMElement();
  });
});

describe("NativeSelect primitive contract", () => {
  it("renders a labeled native select with option selection support", async () => {
    const module = await importPrimitiveModule("native-select");
    const NativeSelect = module.NativeSelect as ComponentType<Record<string, unknown>>;
    const user = userEvent.setup();

    render(
      <label>
        Harness
        <NativeSelect aria-label="Harness" defaultValue="fake-test">
          <option value="fake-test">Fake Test</option>
          <option value="gemini-cli">Gemini CLI</option>
        </NativeSelect>
      </label>
    );

    const select = screen.getByRole("combobox", { name: "Harness" });
    expect(select).toHaveValue("fake-test");

    await user.selectOptions(select, "gemini-cli");

    expect(select).toHaveValue("gemini-cli");
    expect(
      (screen.getByRole("option", { name: "Gemini CLI" }) as HTMLOptionElement)
        .selected
    ).toBe(true);
  });
});

interface SourceText {
  file: string;
  text: string;
}

async function findMissingPrimitives(): Promise<string[]> {
  const statuses = await Promise.all(
    requiredPrimitives.map(async (primitiveName) => ({
      primitiveName,
      exists: Boolean(await resolvePrimitivePath(primitiveName))
    }))
  );

  return statuses
    .filter((status) => !status.exists)
    .map((status) => `src/renderer/components/ui/${status.primitiveName}.{ts,tsx}`);
}

async function loadPrimitiveSources(): Promise<SourceText[]> {
  const files = await Promise.all(
    requiredPrimitives.map(async (primitiveName) => resolvePrimitivePath(primitiveName))
  );

  return Promise.all(
    files
      .filter((file): file is string => Boolean(file))
      .map(async (file) => ({
        file: normalizeRepoPath(file),
        text: await readFile(file, "utf8")
      }))
  );
}

async function importPrimitiveModule(primitiveName: PrimitiveName): Promise<Record<string, unknown>> {
  const tsxKey = `../../src/renderer/components/ui/${primitiveName}.tsx`;
  const tsKey = `../../src/renderer/components/ui/${primitiveName}.ts`;
  const loader = immediatePrimitiveModules[tsxKey] ?? immediatePrimitiveModules[tsKey];

  if (!loader) {
    throw new Error(`Missing primitive module: src/renderer/components/ui/${primitiveName}.{ts,tsx}`);
  }

  return (await loader()) as Record<string, unknown>;
}

async function resolvePrimitivePath(primitiveName: PrimitiveName): Promise<string | undefined> {
  for (const extension of [".tsx", ".ts"] as const) {
    const candidate = path.join(uiRoot, `${primitiveName}${extension}`);

    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
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

function classifyForbiddenImport(specifier: string): string | undefined {
  const normalized = specifier.replaceAll("\\", "/");

  if (builtins.has(normalized) || normalized.startsWith("node:")) {
    return "Node builtin import";
  }

  if (normalized === "electron" || normalized.startsWith("electron/")) {
    return "electron import";
  }

  if (
    normalized.includes("/bridge/") ||
    normalized.startsWith("@/bridge/") ||
    normalized.includes("data-sources-bridge")
  ) {
    return "renderer bridge import";
  }

  if (normalized.includes("/routes/") || normalized.startsWith("@/routes/")) {
    return "route import";
  }

  if (normalized.includes("view-model")) {
    return "Agent Workbench view-model import";
  }

  if (
    normalized.includes("src/main/") ||
    normalized.includes("../main/") ||
    normalized.includes("/main/")
  ) {
    return "main-process import";
  }

  if (
    normalized.includes("src/preload/") ||
    normalized.includes("../preload/") ||
    normalized.includes("/preload/")
  ) {
    return "preload import";
  }

  if (normalized.includes("/adapters/") || normalized.includes("adapter-private")) {
    return "adapter-private import";
  }

  return undefined;
}

function findForbiddenHexViolations(source: SourceText) {
  return [...source.text.matchAll(/#[0-9A-Fa-f]{3,8}\b/gu)]
    .filter((match) => forbiddenProductHexes.includes(match[0].toUpperCase() as (typeof forbiddenProductHexes)[number]))
    .map((match) => ({
      file: source.file,
      line: lineNumberForIndex(source.text, match.index ?? 0),
      value: match[0]
    }));
}

function findForbiddenPaletteViolations(source: SourceText) {
  return [...source.text.matchAll(rawPaletteUtilityPattern)].map((match) => ({
    file: source.file,
    line: lineNumberForIndex(source.text, match.index ?? 0),
    value: match[0]
  }));
}

function lineNumberForSpecifier(text: string, specifier: string): number | undefined {
  const index = text.indexOf(specifier);
  return index >= 0 ? lineNumberForIndex(text, index) : undefined;
}

function lineNumberForIndex(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}

function formatViolations(violations: Array<{ file: string; line?: number | undefined; value?: string; specifier?: string; reason?: string }>) {
  return violations.map((violation) => ({
    file: violation.file,
    line: violation.line,
    value: violation.value ?? violation.specifier,
    reason: violation.reason
  }));
}
