<!-- generated-by: gsd-doc-writer -->
# Testing

## Test framework and setup

The repository uses `vitest` `^4.1.7` as its test runner, with a split configuration in `vitest.config.ts`:

- The `node` project runs `tests/**/*.test.ts` in a Node environment.
- The `renderer` project runs `tests/renderer/**/*.test.tsx` in `jsdom`.
- Renderer tests load `src/renderer/test/setup.ts` for shared browser-style setup.

That split means source-level renderer assertions written as `.test.ts` files, such as `tests/renderer/renderer-boundary-source.test.ts` and `tests/renderer/theme-runtime-source.test.ts`, still run in the `node` project rather than the `renderer` project.

Install dependencies with `npm install` before running any test command.

## Running tests

Run the full test suite:

```bash
npm run test
```

Run architecture and import guardrails only:

```bash
npm run test:boundaries
```

Run renderer tests only:

```bash
npm run test:renderer
```

There is no checked-in watch-mode script in `package.json` today.

## Writing new tests

- Use `*.test.ts` for Node-side coverage and `*.test.tsx` for renderer coverage; that matches every current test file under `tests/`.
- Keep tests in the domain-specific folders that already exist: `tests/adapters/`, `tests/boundaries/`, `tests/contract/`, `tests/main/`, `tests/preload/`, `tests/renderer/`, and `tests/security/`.
- Reuse `src/renderer/test/setup.ts` for renderer assertions that need shared `jsdom` setup.
- Adapter changes should keep using the shared contract harness in `tests/contract/run-adapter-contract.ts` so every adapter proves the same boundary.
- If you intentionally change fake or Gemini normalized fixtures, set `UPDATE_GOLDENS=1` when running the relevant golden test under `tests/adapters/fake-test/` or `tests/adapters/gemini-cli/`.
- Boundary-sensitive changes should keep `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`, and `tests/security/renderer-forbidden-apis.test.ts` green because those files enforce the harness-neutral and read-only seams.

## Coverage requirements

No coverage thresholds are configured in `vitest.config.ts`, `package.json`, `.nycrc`, or any checked-in `c8` configuration.

| Type | Threshold |
|------|-----------|
| Statements | No coverage threshold configured |
| Branches | No coverage threshold configured |
| Functions | No coverage threshold configured |
| Lines | No coverage threshold configured |

## CI integration

No `.github/workflows/` files are checked into the repository today, so there is no tracked CI test workflow to reference yet. Until that changes, the expected verification loop is local:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:boundaries
```
