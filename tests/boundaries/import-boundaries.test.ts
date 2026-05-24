import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type SourceKind =
  | { type: "adapter"; adapterId: string }
  | { type: "core" }
  | { type: "main" }
  | { type: "preload" }
  | { type: "renderer" }
  | { type: "other" };

interface ImportRecord {
  sourceFile: string;
  sourceLogicalPath: string;
  specifier: string;
  targetFile: string;
  targetLogicalPath: string;
}

interface BoundaryViolation extends ImportRecord {
  reason: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const coreRoot = path.join(repoRoot, "src", "main", "core");
const mainAppRoot = path.join(repoRoot, "src", "main", "app");
const mainIpcRoot = path.join(repoRoot, "src", "main", "ipc");
const preloadRoot = path.join(repoRoot, "src", "preload");
const rendererRoot = path.join(repoRoot, "src", "renderer");
const adaptersRoot = path.join(repoRoot, "src", "main", "adapters");
const boundaryFixturesRoot = path.join(repoRoot, "tests", "boundaries", "fixtures");

const allowedCoreAdapterEntrypoints = new Set([
  "src/main/core/registry/register-bundled-adapters.ts"
]);

const fixtureLogicalPaths = new Map<string, string>([
  [
    path.join(boundaryFixturesRoot, "illegal-core-import.ts"),
    "src/main/core/illegal-import-fixture.ts"
  ],
  [
    path.join(boundaryFixturesRoot, "illegal-renderer-import.ts"),
    "src/renderer/illegal-import-fixture.ts"
  ],
  [
    path.join(boundaryFixturesRoot, "illegal-renderer-main-import.ts"),
    "src/renderer/illegal-main-import-fixture.ts"
  ],
  [
    path.join(boundaryFixturesRoot, "illegal-main-app-import.ts"),
    "src/main/app/illegal-import-fixture.ts"
  ],
  [
    path.join(boundaryFixturesRoot, "illegal-preload-import.ts"),
    "src/preload/illegal-import-fixture.ts"
  ],
  [
    path.join(boundaryFixturesRoot, "illegal-adapter-import.ts"),
    "src/main/adapters/alpha-test/illegal-import-fixture.ts"
  ]
]);

describe("import boundaries", () => {
  it("allows the current core and adapter tree", async () => {
    const srcFiles = [
      ...(await collectTypeScriptFiles(coreRoot)),
      ...(await collectTypeScriptFiles(mainAppRoot)),
      ...(await collectTypeScriptFiles(mainIpcRoot)),
      ...(await collectTypeScriptFiles(preloadRoot)),
      ...(await collectTypeScriptFiles(adaptersRoot)),
      ...(await collectTypeScriptFiles(rendererRoot))
    ];
    const violations = await findBoundaryViolations(srcFiles);

    expect(violations).toEqual([]);
  });

  it("rejects a core file importing adapter-private code", async () => {
    const fixturePath = path.join(boundaryFixturesRoot, "illegal-core-import.ts");
    const violations = await findBoundaryViolations([fixturePath]);

    expect(violations).toEqual([
      expect.objectContaining({
        sourceLogicalPath: "src/main/core/illegal-import-fixture.ts",
        targetLogicalPath: "src/main/adapters/fake-test/normalize.ts",
        reason:
          "Shared main code can only import bundled adapter entrypoints from the registry composition root."
      })
    ]);
  });

  it("rejects a renderer file importing adapter-private code", async () => {
    const fixturePath = path.join(boundaryFixturesRoot, "illegal-renderer-import.ts");
    const violations = await findBoundaryViolations([fixturePath]);

    expect(violations).toEqual([
      expect.objectContaining({
        sourceLogicalPath: "src/renderer/illegal-import-fixture.ts",
        targetLogicalPath: "src/main/adapters/fake-test/descriptor.ts",
        reason: "Renderer code must not import adapter-private modules."
      })
    ]);
  });

  it("rejects a renderer file importing main-process internals", async () => {
    const fixturePath = path.join(boundaryFixturesRoot, "illegal-renderer-main-import.ts");
    const violations = await findBoundaryViolations([fixturePath]);

    expect(violations).toEqual([
      expect.objectContaining({
        sourceLogicalPath: "src/renderer/illegal-main-import-fixture.ts",
        targetLogicalPath: "src/main/core/adapter-contract/index.ts",
        reason: "Renderer code must not import main-process internals."
      })
    ]);
  });

  it("rejects app and preload files importing adapter-private code", async () => {
    const violations = await findBoundaryViolations([
      path.join(boundaryFixturesRoot, "illegal-main-app-import.ts"),
      path.join(boundaryFixturesRoot, "illegal-preload-import.ts")
    ]);

    expect(violations).toEqual([
      expect.objectContaining({
        sourceLogicalPath: "src/main/app/illegal-import-fixture.ts",
        targetLogicalPath: "src/main/adapters/fake-test/descriptor.ts",
        reason:
          "Shared main code can only import bundled adapter entrypoints from the registry composition root."
      }),
      expect.objectContaining({
        sourceLogicalPath: "src/preload/illegal-import-fixture.ts",
        targetLogicalPath: "src/main/adapters/fake-test/descriptor.ts",
        reason:
          "Shared main code can only import bundled adapter entrypoints from the registry composition root."
      })
    ]);
  });

  it("rejects an adapter importing a sibling adapter", async () => {
    const fixturePath = path.join(boundaryFixturesRoot, "illegal-adapter-import.ts");
    const violations = await findBoundaryViolations([fixturePath]);

    expect(violations).toEqual([
      expect.objectContaining({
        sourceLogicalPath: "src/main/adapters/alpha-test/illegal-import-fixture.ts",
        targetLogicalPath: "src/main/adapters/fake-test/index.ts",
        reason: "Adapters must not import sibling adapter modules."
      })
    ]);
  });
});

async function findBoundaryViolations(files: string[]): Promise<BoundaryViolation[]> {
  const violations: BoundaryViolation[] = [];

  for (const file of files) {
    const imports = await readRelativeImports(file);
    const sourceLogicalPath = getLogicalPath(file);
    const sourceKind = classifySourcePath(sourceLogicalPath);

    for (const imported of imports) {
      const targetFile = await resolveImport(file, imported);

      if (!targetFile) {
        continue;
      }

      const targetLogicalPath = normalizeRepoPath(targetFile);
      const targetKind = classifySourcePath(targetLogicalPath);

      if (isSharedMainSource(sourceKind) && targetKind.type === "adapter") {
        if (
          allowedCoreAdapterEntrypoints.has(sourceLogicalPath) &&
          path.posix.basename(targetLogicalPath) === "index.ts"
        ) {
          continue;
        }

        violations.push({
          sourceFile: file,
          sourceLogicalPath,
          specifier: imported,
          targetFile,
          targetLogicalPath,
          reason:
            "Shared main code can only import bundled adapter entrypoints from the registry composition root."
        });
        continue;
      }

      if (sourceKind.type === "renderer" && targetKind.type === "adapter") {
        violations.push({
          sourceFile: file,
          sourceLogicalPath,
          specifier: imported,
          targetFile,
          targetLogicalPath,
          reason: "Renderer code must not import adapter-private modules."
        });
        continue;
      }

      if (
        sourceKind.type === "renderer" &&
        (targetKind.type === "core" || targetKind.type === "main" || targetKind.type === "preload")
      ) {
        violations.push({
          sourceFile: file,
          sourceLogicalPath,
          specifier: imported,
          targetFile,
          targetLogicalPath,
          reason: "Renderer code must not import main-process internals."
        });
        continue;
      }

      if (
        sourceKind.type === "adapter" &&
        targetKind.type === "adapter" &&
        sourceKind.adapterId !== targetKind.adapterId
      ) {
        violations.push({
          sourceFile: file,
          sourceLogicalPath,
          specifier: imported,
          targetFile,
          targetLogicalPath,
          reason: "Adapters must not import sibling adapter modules."
        });
      }
    }
  }

  return violations;
}

async function readRelativeImports(file: string): Promise<string[]> {
  const contents = await readFile(file, "utf8");
  const imports = new Set<string>();
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']/g;

  for (const match of contents.matchAll(pattern)) {
    const specifier = match[1];

    if (!specifier) {
      continue;
    }

    if (specifier.startsWith(".")) {
      imports.add(specifier);
    }
  }

  return [...imports];
}

async function resolveImport(fromFile: string, specifier: string): Promise<string | null> {
  const unresolved = path.resolve(path.dirname(fromFile), specifier);
  const extensionless =
    unresolved.endsWith(".js") || unresolved.endsWith(".tsx")
      ? unresolved.slice(0, unresolved.lastIndexOf("."))
      : unresolved.endsWith(".ts")
        ? unresolved.slice(0, unresolved.lastIndexOf("."))
        : unresolved;
  const candidates = [
    unresolved,
    extensionless,
    `${extensionless}.ts`,
    `${extensionless}.tsx`,
    `${extensionless}.js`,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.js`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx"),
    path.join(unresolved, "index.js")
  ];

  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
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

function getLogicalPath(file: string): string {
  return fixtureLogicalPaths.get(file) ?? normalizeRepoPath(file);
}

function normalizeRepoPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join(path.posix.sep);
}

function classifySourcePath(file: string): SourceKind {
  const normalized = file.split(path.sep).join(path.posix.sep);

  if (normalized.startsWith("src/main/core/")) {
    return { type: "core" };
  }

  if (normalized.startsWith("src/renderer/")) {
    return { type: "renderer" };
  }

  if (normalized.startsWith("src/preload/")) {
    return { type: "preload" };
  }

  const adapterMatch = normalized.match(/^src\/main\/adapters\/([^/]+)\//u);

  if (adapterMatch) {
    const adapterId = adapterMatch[1];

    if (adapterId) {
      return { type: "adapter", adapterId };
    }
  }

  if (normalized.startsWith("src/main/")) {
    return { type: "main" };
  }

  return { type: "other" };
}

function isSharedMainSource(sourceKind: SourceKind): boolean {
  return sourceKind.type === "core" || sourceKind.type === "main" || sourceKind.type === "preload";
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
