---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---
# Coding Conventions

**Analysis Date:** 2026-05-23

## Naming Patterns

**Files:**
- Use lowercase kebab-case for implementation files and directories: `src/main/adapters/fake-test/normalize.ts`, `src/main/core/adapter-contract/session-source-adapter.ts`, `src/main/core/model/identifiers.ts`.
- Use `index.ts` barrel entrypoints only at package-style boundaries: `src/main/core/model/index.ts`, `src/main/core/adapter-contract/index.ts`, `src/main/core/registry/index.ts`, `src/main/adapters/fake-test/index.ts`.
- Name tests by scope and purpose with `.test.ts`: `tests/adapters/fake-test/fake-adapter.contract.test.ts`, `tests/adapters/fake-test/fake-adapter.golden.test.ts`, `tests/boundaries/import-boundaries.test.ts`.
- Name checked-in fixtures after the behavior they prove: `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`, `tests/fixtures/fake-test/phase1-session.normalized.json`.

**Functions:**
- Use camelCase verbs for functions and helpers: `normalizeFakeTestEvents` in `src/main/adapters/fake-test/normalize.ts`, `validateFakeTestSourceRoot` in `src/main/adapters/fake-test/discovery.ts`, `buildDiagnostic` in `src/main/core/diagnostics/diagnostic.ts`.
- Use `create*Id` factory names for stable ID constructors: `createSessionId`, `createToolCallId`, and `createRawArtifactId` in `src/main/core/model/identifiers.ts`.
- Use `assert*` names for test-only assertion helpers: `assertHarnessCapabilities`, `assertDiagnosticShape`, and `assertNormalizedRelationships` in `tests/contract/run-adapter-contract.ts`.
- Use `find*Violations` names for boundary scanners: `findBoundaryViolations` in `tests/boundaries/import-boundaries.test.ts`, `findGeminiSymbolViolations` in `tests/boundaries/shared-naming.test.ts`.

**Variables:**
- Use camelCase for local values and collections: `artifactDefinitions`, `outputArtifactsByNativeId`, `timelineEvents`, and `parseDiagnostics` in `src/main/adapters/fake-test/normalize.ts`.
- Use `*Id` suffixes for normalized IDs and `native*` for source-native identifiers: `sessionId`, `sourceId`, `nativeArtifactId` in `src/main/adapters/fake-test/normalize.ts`.
- Use `*Path` suffixes for filesystem paths: `fixturePath`, `goldenPath` in `tests/adapters/fake-test/fake-adapter.golden.test.ts`, `repoRoot` and `coreRoot` in `tests/boundaries/import-boundaries.test.ts`.
- Use uppercase constants for immutable lists and singleton values: `REQUIRED_CAPABILITY_KEYS` and `FORBIDDEN_CONCLUSION_KEYS` in `tests/contract/run-adapter-contract.ts`, `HIGH_CONFIDENCE` in `src/main/core/model/confidence.ts`.

**Types:**
- Use PascalCase for interfaces, type aliases, and classes: `SessionSourceAdapter` in `src/main/core/adapter-contract/session-source-adapter.ts`, `NormalizedSessionGraph` in `src/main/core/model/entities.ts`, `AdapterRegistry` in `src/main/core/registry/adapter-registry.ts`.
- Use harness-neutral shared model names in `src/main/core/**`: `HarnessDescriptor`, `Session`, `SessionEvent`, `RawHarnessEvent`, `ToolCall`, `OutputArtifact`, and `ShellCommandEvidence`.
- Use adapter-specific prefixes only inside adapter-private code: `FakeRawEvent`, `FakeParsedPayload`, and `FakeTimelineEvent` in `src/main/adapters/fake-test/**`.
- Use string-literal unions for domain states: `ToolCallStatus`, `SessionLifecycleState`, `DiagnosticSeverity`, and `CapabilityStatus` in `src/main/core/model/entities.ts`, `src/main/core/diagnostics/diagnostic.ts`, and `src/main/core/model/capabilities.ts`.

## Code Style

**Formatting:**
- Formatter config: Not detected. There is no `.prettierrc`, `prettier.config.*`, or `biome.json` at the repo root.
- Follow existing TypeScript formatting: two-space indentation, double quotes, semicolons, trailing commas omitted, blank lines between import groups, and wrapped multiline object/function signatures as seen in `src/main/adapters/fake-test/normalize.ts`.
- Keep optional properties absent instead of present with `undefined`. With `exactOptionalPropertyTypes` enabled in `tsconfig.json`, construct objects with conditional spreads, as in `src/main/core/diagnostics/diagnostic.ts` and `src/main/adapters/fake-test/normalize.ts`.
- Prefer `const` for immutable bindings and arrays/maps assembled once: `fixtureCapabilities`, `artifactDefinitions`, and `timelineEvents` in `src/main/adapters/fake-test/normalize.ts`.

**Linting:**
- Use ESLint via `npm run lint`; the command runs `eslint .` from `package.json`.
- ESLint config lives in `eslint.config.mjs` and uses `typescript-eslint`.
- `eslint.config.mjs` ignores `node_modules/**` and `tests/boundaries/fixtures/**`.
- `eslint.config.mjs` enforces architecture rules:
  - Shared core under `src/main/core/**/*.ts` must not import adapter modules except `src/main/core/registry/register-bundled-adapters.ts`.
  - Shared core and renderer under `src/main/core/**/*.ts`, `src/renderer/**/*.ts`, and `src/renderer/**/*.tsx` must not use `Gemini*` symbols or branch on `"gemini-cli"`.
  - Renderer code under `src/renderer/**/*.ts` and `src/renderer/**/*.tsx` must not import adapter-private modules.
  - Adapter contract files under `src/main/core/adapter-contract/**/*.ts` must not expose verification, run-audit, or attention conclusion fields.

## Import Organization

**Order:**
1. Node built-ins first, using `node:` specifiers: `import path from "node:path";` in `tests/adapters/fake-test/fake-adapter.smoke.test.ts`, `import { readFile } from "node:fs/promises";` in `src/main/adapters/fake-test/parse.ts`.
2. External packages next: `import { z } from "zod";` in `src/main/adapters/fake-test/types.ts`, `import { describe, expect, it } from "vitest";` in tests.
3. Internal imports from `src` or sibling modules after a blank line: `src/main/adapters/fake-test/index.ts` imports adapter-private modules after the type import.
4. Test helpers are imported after source imports when both are present: `tests/adapters/fake-test/fake-adapter.golden.test.ts` imports `exerciseAdapter` after source imports.

**Path Aliases:**
- Not detected. `tsconfig.json` defines no `paths` or `baseUrl`.
- Use relative imports with explicit `.js` extensions for TypeScript ESM source imports: `../../core/model/capabilities.js` in `src/main/adapters/fake-test/descriptor.ts`, `../adapter-contract/index.js` in `src/main/core/registry/adapter-registry.ts`.
- Use type-only imports for TypeScript-only symbols: `import type { HarnessCapabilities }` in `src/main/adapters/fake-test/descriptor.ts`, `import type { Diagnostic }` in `tests/contract/run-adapter-contract.ts`.
- Combine value and type imports from the same module when local style already does so: `import { capabilityState, type HarnessCapabilities }` in `src/main/adapters/fake-test/descriptor.ts`.

## Error Handling

**Patterns:**
- Adapter parse failures emit diagnostic raw events instead of throwing for expected bad input. `parseFakeTestArtifact` catches file read and JSON parse failures in `src/main/adapters/fake-test/parse.ts` and yields `fake-test.parse.*` diagnostics.
- Source validation returns structured `SourceRootValidation` results. `validateFakeTestSourceRoot` returns `{ ok: false, diagnostics: [...] }` for missing or non-file roots in `src/main/adapters/fake-test/discovery.ts`.
- Normalization returns an `AdapterNormalizationResult` with diagnostics and empty entity arrays when required metadata is missing, as in `normalizeFakeTestEvents` in `src/main/adapters/fake-test/normalize.ts`.
- Throw `Error` for programmer misuse or impossible test harness states: duplicate adapter registration in `src/main/core/registry/adapter-registry.ts`, missing discovered source in `tests/contract/run-adapter-contract.ts`, missing stable golden ID mapping in `tests/adapters/fake-test/fake-adapter.golden.test.ts`.
- Use `error instanceof Error ? error.message : "fallback"` when preserving unknown caught error messages, as in `src/main/adapters/fake-test/parse.ts`.
- Use narrow missing-directory guards for filesystem traversal in tests. `isMissingDirectory` handles `ENOENT` in `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts`.

## Logging

**Framework:** Not detected.

**Patterns:**
- No `console.*` logging is present in `src/**/*.ts` or `tests/**/*.ts`.
- Prefer returned diagnostics over logs for adapter/source/artifact problems. Use `buildDiagnostic` from `src/main/core/diagnostics/diagnostic.ts`.
- Keep diagnostic codes stable, namespaced, and specific: `fake-test.source.missing` in `src/main/adapters/fake-test/discovery.ts`, `fake-test.normalize.metadata-missing` in `src/main/adapters/fake-test/normalize.ts`.

## Comments

**When to Comment:**
- Comments are largely absent in source and tests. Prefer self-describing helper names, explicit types, and direct assertions over explanatory comments.
- Add comments only when a rule is not encoded by a type, test name, or diagnostic code. Existing boundary rules are expressed through test names and failure messages in `tests/boundaries/import-boundaries.test.ts`.

**JSDoc/TSDoc:**
- Not detected. Public interfaces in `src/main/core/adapter-contract/session-source-adapter.ts` and `src/main/core/model/entities.ts` are documented by type names and field names rather than TSDoc.

## Function Design

**Size:** Keep production functions focused by pipeline stage. Adapter code splits descriptor, discovery, parsing, and normalization across `src/main/adapters/fake-test/descriptor.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/parse.ts`, and `src/main/adapters/fake-test/normalize.ts`.

**Parameters:** Use object parameters for identity builders and contract inputs. `createSessionId(parts: StableIdentityParts)` in `src/main/core/model/identifiers.ts` and `normalize(input: AdapterNormalizationInput<TRawEvent>, context: AdapterContext)` in `src/main/core/adapter-contract/session-source-adapter.ts` are the model.

**Return Values:** Return typed domain objects and async iterables at adapter boundaries:
- `validateSourceRoot` returns `Promise<SourceRootValidation>` in `src/main/core/adapter-contract/session-source-adapter.ts`.
- `discoverSources`, `discoverArtifacts`, and `parseArtifact` return `AsyncIterable` streams in `src/main/core/adapter-contract/session-source-adapter.ts`.
- `normalize` returns `Promise<AdapterNormalizationResult>` in `src/main/core/adapter-contract/session-source-adapter.ts`.

## Module Design

**Exports:** Export named values and types. `src/main/adapters/fake-test/index.ts` exports `fakeTestAdapter`, `fakeTestDescriptor`, `FakeRawEvent`, and adapter-private types. `src/main/core/model/index.ts` re-exports model modules.

**Barrel Files:** Use barrel files at stable public boundaries only:
- `src/main/core/adapter-contract/index.ts` re-exports adapter contracts.
- `src/main/core/model/index.ts` re-exports shared model types.
- `src/main/core/registry/index.ts` re-exports registry APIs.
- Avoid importing adapter-private files from shared core or renderer. Only the composition root `src/main/core/registry/register-bundled-adapters.ts` imports `src/main/adapters/fake-test/index.ts`.

---

*Convention analysis: 2026-05-23*
