---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---
# Testing Patterns

**Analysis Date:** 2026-05-23

## Test Framework

**Runner:**
- Vitest 4.1.7.
- Config: `vitest.config.ts`.
- Environment: `node`.
- Include pattern: `tests/**/*.test.ts`.

**Assertion Library:**
- Vitest `expect`, imported from `vitest` in `tests/**/*.test.ts`.

**Run Commands:**
```bash
npm test                         # Run all tests with vitest run
npm run test:boundaries          # Run boundary tests under tests/boundaries
npm run typecheck                # Run TypeScript no-emit checks
npm run lint                     # Run ESLint over the repo
UPDATE_GOLDENS=1 npm test -- tests/adapters/fake-test/fake-adapter.golden.test.ts  # Refresh golden output intentionally
```

## Test File Organization

**Location:**
- Tests live outside source under `tests/**`.
- Adapter tests live under `tests/adapters/<adapter-id>/`: `tests/adapters/fake-test/fake-adapter.contract.test.ts`, `tests/adapters/fake-test/fake-adapter.golden.test.ts`, `tests/adapters/fake-test/fake-adapter.smoke.test.ts`, `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts`.
- Shared contract tests live under `tests/contract/`: `tests/contract/run-adapter-contract.ts`, `tests/contract/adapter-contract.test.ts`.
- Architectural boundary tests live under `tests/boundaries/`: `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`.
- Boundary-negative fixtures live under `tests/boundaries/fixtures/` and are excluded from ESLint by `eslint.config.mjs`.
- Golden expected outputs live under `tests/fixtures/<adapter-id>/`: `tests/fixtures/fake-test/phase1-session.normalized.json`.

**Naming:**
- Use `<subject>.<purpose>.test.ts` for adapter tests: `fake-adapter.contract.test.ts`, `fake-adapter.golden.test.ts`, `fake-adapter.smoke.test.ts`, `fake-adapter.truth-rules.test.ts`.
- Use `<boundary>.test.ts` for policy tests: `import-boundaries.test.ts`, `shared-naming.test.ts`.
- Use `.fixture.json` for adapter input fixtures: `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
- Use `.normalized.json` for golden normalized outputs: `tests/fixtures/fake-test/phase1-session.normalized.json`.

**Structure:**
```text
tests/
├── adapters/
│   └── fake-test/
│       ├── fake-adapter.contract.test.ts
│       ├── fake-adapter.golden.test.ts
│       ├── fake-adapter.smoke.test.ts
│       └── fake-adapter.truth-rules.test.ts
├── boundaries/
│   ├── fixtures/
│   ├── import-boundaries.test.ts
│   └── shared-naming.test.ts
├── contract/
│   ├── adapter-contract.test.ts
│   └── run-adapter-contract.ts
└── fixtures/
    └── fake-test/
        └── phase1-session.normalized.json
```

## Test Structure

**Suite Organization:**
```typescript
describe("fake-test adapter smoke proof", () => {
  it("normalizes one representative fixture through the bundled registry", async () => {
    const registry = createBundledAdapterRegistry();
    const adapter = registry.require("fake-test");

    const validation = await adapter.validateSourceRoot({ rootPath: fixturePath }, context);
    expect(validation.ok).toBe(true);
  });
});
```

This pattern is used in `tests/adapters/fake-test/fake-adapter.smoke.test.ts`.

**Patterns:**
- Use direct `describe` and `it` blocks from `vitest`.
- Keep high-level adapter tests end-to-end through the contract methods: validate source, discover sources, discover artifacts, parse raw events, normalize graph. `tests/adapters/fake-test/fake-adapter.smoke.test.ts` is the compact flow.
- Reuse the shared contract harness for adapter conformance. `tests/adapters/fake-test/fake-adapter.contract.test.ts` calls `runAdapterContractSuite` from `tests/contract/run-adapter-contract.ts`.
- Assert architectural rules with synthetic invalid fixtures and live source scans. `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts` both test current source and negative examples.
- Prefer explicit truth-state assertions over falsy checks. `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts` asserts `unsupported` and `unknown` are not flattened to `0`, `"clean"`, or absent.
- Golden tests rewrite unstable IDs into stable semantic labels before comparing snapshots. Use `toStableNormalizedSnapshot` in `tests/adapters/fake-test/fake-adapter.golden.test.ts` as the pattern.

## Mocking

**Framework:** Not used.

**Patterns:**
```typescript
const stubAdapter: SessionSourceAdapter<StubRawEvent> = {
  descriptor: { id: "stub-contract", displayName: "Stub Contract Harness", ... },
  async validateSourceRoot(root) {
    return { ok: true, normalizedPath: root.rootPath, diagnostics: [], capabilities: stubCapabilities };
  },
  async *discoverSources(root) {
    yield { id: stubSourceId, adapterId: "stub-contract", nativeId: root.rootPath, ... };
  }
};

runAdapterContractSuite({
  name: "reusable contract harness",
  adapter: stubAdapter,
  root: { rootPath: "tests/fixtures/stub-contract/session.fixture.json" }
});
```

This in-memory stub pattern is used in `tests/contract/adapter-contract.test.ts`.

**What to Mock:**
- Prefer typed in-memory contract doubles for interface-level tests, as in `tests/contract/adapter-contract.test.ts`.
- Use synthetic source files for boundary failures instead of mocking module resolution: `tests/boundaries/fixtures/illegal-core-import.ts`, `tests/boundaries/fixtures/illegal-renderer-import.ts`, `tests/boundaries/fixtures/illegal-adapter-import.ts`.

**What NOT to Mock:**
- Do not mock adapter parsing or normalization in adapter smoke, contract, truth-rule, or golden tests. Use real fixture artifacts from `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
- Do not mock filesystem traversal in boundary tests. `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts` read live source files.
- Do not use `vi.mock` unless a new test has a boundary that cannot be exercised with typed stubs or fixtures. No current tests use `vi.mock`.

## Fixtures and Factories

**Test Data:**
```typescript
const fixturePath = path.resolve("src/main/adapters/fake-test/fixtures/phase1-session.fixture.json");
const goldenPath = path.resolve("tests/fixtures/fake-test/phase1-session.normalized.json");
```

This path pattern is used in `tests/adapters/fake-test/fake-adapter.golden.test.ts`.

**Location:**
- Adapter input fixtures belong with the adapter that owns the raw format: `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
- Expected normalized snapshots belong in shared test fixtures: `tests/fixtures/fake-test/phase1-session.normalized.json`.
- Negative boundary fixtures belong in `tests/boundaries/fixtures/`.
- Shared adapter exercise helpers belong in `tests/contract/run-adapter-contract.ts`.

## Coverage

**Requirements:** No coverage threshold is configured. `vitest.config.ts` contains no coverage settings.

**View Coverage:**
```bash
# Not configured in package.json.
# Add a Vitest coverage provider and script before relying on coverage reports.
```

## Test Types

**Unit Tests:**
- Boundary scanners and helper behavior are tested directly in `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts`.
- The reusable contract harness is tested with a typed stub adapter in `tests/contract/adapter-contract.test.ts`.

**Integration Tests:**
- Adapter smoke tests run through the bundled registry and adapter lifecycle in `tests/adapters/fake-test/fake-adapter.smoke.test.ts`.
- Adapter contract tests run validation, discovery, parsing, normalization, diagnostics, capabilities, and relationship checks through `tests/contract/run-adapter-contract.ts`.
- Golden tests compare complete normalized output against `tests/fixtures/fake-test/phase1-session.normalized.json`.

**E2E Tests:**
- Not used. No Playwright config or Electron smoke tests are present.

## Common Patterns

**Async Testing:**
```typescript
async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}
```

Use this helper pattern when adapter APIs return `AsyncIterable`, as in `tests/adapters/fake-test/fake-adapter.smoke.test.ts` and `tests/contract/run-adapter-contract.ts`.

**Error Testing:**
```typescript
if (!source) {
  throw new Error("Expected fake-test discovery to produce a source.");
}
```

Use explicit throws to narrow possibly missing values after assertions, as in `tests/adapters/fake-test/fake-adapter.smoke.test.ts` and `tests/contract/adapter-contract.test.ts`.

**Boundary Testing:**
```typescript
expect(violations).toEqual([
  expect.objectContaining({
    sourceLogicalPath: "src/main/core/illegal-import-fixture.ts",
    targetLogicalPath: "src/main/adapters/fake-test/normalize.ts",
    reason: "Shared core can only import bundled adapter entrypoints from the registry composition root."
  })
]);
```

Use positive live-tree assertions plus negative fixture assertions for architecture policies, as in `tests/boundaries/import-boundaries.test.ts`.

**Golden Testing:**
```typescript
if (process.env.UPDATE_GOLDENS === "1") {
  await mkdir(path.dirname(goldenPath), { recursive: true });
  await writeFile(goldenPath, actual, "utf8");
}

const expected = await readFile(goldenPath, "utf8");
expect(actual).toBe(expected);
```

Use the explicit `UPDATE_GOLDENS=1` gate from `tests/adapters/fake-test/fake-adapter.golden.test.ts` for snapshot updates.

---

*Testing analysis: 2026-05-23*
