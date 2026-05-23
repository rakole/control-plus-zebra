---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---

# Codebase Concerns

**Analysis Date:** 2026-05-23

## Tech Debt

**Security and ingestion infrastructure are represented in requirements, not runtime code:**
- Issue: The shared core currently contains normalized models, adapter contracts, a registry, diagnostics, and the fake-test adapter, but it does not contain source registry, scanner orchestration, cache, safe filesystem helpers, shell parser, verification classifier, run audit, git/GitHub providers, IPC view models, Electron preload, or renderer security surfaces.
- Files: `src/main/core/model/entities.ts`, `src/main/core/adapter-contract/session-source-adapter.ts`, `src/main/core/adapter-contract/types.ts`, `src/main/core/registry/adapter-registry.ts`, `src/main/adapters/fake-test/index.ts`, `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`
- Impact: The most important V1 promises are not enforceable at runtime outside the Phase 1 adapter contract tests. Future implementation must not assume these safety/audit systems exist because types mention their data shapes.
- Fix approach: Add shared source registry, safe read-only filesystem helper interfaces, normalization validation, ingestion orchestration, cache, verification/run-audit modules, and IPC/view-model boundaries under `src/main/core/**` before wiring real harness data or renderer views.

**Adapter contract uses TypeScript shapes without runtime validation for normalized output:**
- Issue: `AdapterNormalizationResult` and normalized entities are TypeScript interfaces only. `normalizeFakeTestEvents` returns constructed objects directly, and the reusable contract tests assert shape in test code rather than providing production validation.
- Files: `src/main/core/adapter-contract/types.ts`, `src/main/core/model/entities.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/contract/run-adapter-contract.ts`
- Impact: A future adapter can emit malformed IDs, timestamps, paths, unsupported capability flattening, cross-source references, duplicate IDs, or conclusion fields unless every production ingestion path reimplements the test assertions.
- Fix approach: Add Zod or equivalent schemas in `src/main/core/model/**` or `src/main/core/adapter-contract/**` and require shared ingestion to validate every adapter result before merging it into cache or IPC view models.

**Fake adapter owns filesystem reads directly:**
- Issue: `parseFakeTestArtifact` reads `artifact.path` with `readFile`, and `validateFakeTestSourceRoot` resolves arbitrary `root.rootPath` with `path.resolve`; no safe scoped filesystem abstraction is present.
- Files: `src/main/adapters/fake-test/parse.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/core/adapter-contract/session-source-adapter.ts`, `.planning/REQUIREMENTS.md`
- Impact: The V1 security rule that adapters receive scoped safe filesystem helpers is not implemented. The fake adapter is low-risk fixture code, but the pattern is unsafe to copy into the Gemini adapter or other real adapters.
- Fix approach: Extend `AdapterContext` in `src/main/core/adapter-contract/types.ts` with read-only helper functions that enforce configured roots, file size limits, symlink policy, and media-type expectations; update adapters to use those helpers instead of direct `fs` imports.

**Fake/stub second adapter proof is partly test-only:**
- Issue: The bundled registry registers only `fake-test`; the reusable second adapter in `tests/contract/adapter-contract.test.ts` is an in-test stub, not a runtime adapter entrypoint.
- Files: `src/main/core/registry/register-bundled-adapters.ts`, `src/main/adapters/fake-test/index.ts`, `tests/contract/adapter-contract.test.ts`
- Impact: Runtime registry behavior proves one bundled adapter, while the second-adapter neutrality proof depends on tests. This is acceptable for Phase 1, but future UI/ingestion work cannot rely on runtime multi-adapter behavior until another real or fixture adapter is registered.
- Fix approach: When the first real adapter lands, register it through `src/main/core/registry/register-bundled-adapters.ts` and keep a separate contract/golden suite under `tests/adapters/<adapter-id>/`.

**Event model stores only one event-level artifact and file mutation reference:**
- Issue: `SessionEvent` has singular `outputArtifactId` and `fileMutationId`, while `ToolCall` supports arrays. `normalizeFakeTestEvents` stores only the first artifact and first mutation on the event.
- Files: `src/main/core/model/entities.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/contract/run-adapter-contract.ts`, `tests/fixtures/fake-test/phase1-session.normalized.json`
- Impact: Timeline views or audit code that read event-level fields can miss additional artifacts or file mutations attached to the same tool call.
- Fix approach: Prefer array fields on `SessionEvent` or require downstream consumers to dereference through `toolCallId`; add contract tests covering multi-artifact and multi-file-mutation events.

## Known Bugs

**Unknown artifact IDs in tool-call events are silently dropped:**
- Symptoms: For `tool-call` timeline events, `artifactIds` are mapped through `ensureOutputArtifact` and filtered when the artifact definition is missing. A diagnostic is emitted for missing artifacts only in `output-artifact` timeline events.
- Files: `src/main/adapters/fake-test/normalize.ts`, `src/main/adapters/fake-test/types.ts`, `tests/adapters/fake-test/fake-adapter.contract.test.ts`
- Trigger: Add an unknown ID to a fake fixture `tool-call.artifactIds` array in `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`; normalization omits it without a `fake-test.artifact.missing` diagnostic.
- Workaround: Use explicit `output-artifact` events for artifact references in the current fake fixture. Fix the normalizer before accepting real adapter artifact references.

**Duplicate native timeline IDs are not diagnosed:**
- Symptoms: Stable IDs are derived from `adapterId`, `sourceId`, and native ID. If two raw timeline events use the same native event ID, they normalize to duplicate entity IDs while remaining separate array entries.
- Files: `src/main/core/model/identifiers.ts`, `src/main/adapters/fake-test/normalize.ts`, `src/main/adapters/fake-test/types.ts`, `tests/contract/run-adapter-contract.ts`
- Trigger: Add two fake fixture events with the same `events[].id` in `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
- Workaround: Keep fixture native IDs unique. Add duplicate-ID diagnostics in shared normalization validation before real adapter data is indexed.

**Final session lifecycle is trusted from fixture metadata rather than timeline evidence:**
- Symptoms: `normalizeFakeTestEvents` sets `Session.lifecycleState` from `fixture.session.lifecycleState` and does not reconcile it with lifecycle timeline events.
- Files: `src/main/adapters/fake-test/normalize.ts`, `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`, `src/main/core/model/entities.ts`
- Trigger: Set `session.lifecycleState` to `completed` while the final lifecycle event remains `cancelled` or `active`; normalization preserves the session metadata state without diagnostic.
- Workaround: Keep fake fixture metadata and timeline events manually aligned. Add shared lifecycle reconciliation diagnostics for real adapters.

## Security Considerations

**No Electron security boundary exists in source yet:**
- Risk: The required renderer constraints are not implemented because the repository does not currently contain Electron main, preload, renderer, IPC, CSP, or `BrowserWindow` code.
- Files: `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `package.json`, `src/main/core/adapter-contract/types.ts`
- Current mitigation: No renderer or Electron shell exists, so no insecure renderer surface is currently exposed.
- Recommendations: When adding Electron code, keep main/preload/renderer files separate, disable Node integration, enable context isolation and sandboxing, expose a typed preload bridge only, validate all IPC payloads, and test these constraints with Electron smoke tests.

**Future adapter file reads need root containment and size limits:**
- Risk: Direct `readFile` and `stat` patterns can read any path supplied by source configuration or raw artifact refs and can load arbitrarily large files into memory.
- Files: `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/parse.ts`, `src/main/core/adapter-contract/types.ts`
- Current mitigation: The only bundled adapter is a fake fixture adapter, and `validateFakeTestSourceRoot` requires the configured root to be a single existing file.
- Recommendations: Add scoped read helpers to `AdapterContext`, enforce configured-root containment, reject or stream large artifacts, define symlink behavior, and keep raw transcript loading out of renderer IPC payloads.

**Raw command and transcript content can contain sensitive data:**
- Risk: `SessionMessage.content`, `ShellCommandEvidence.command`, `ShellCommandEvidence.outputSummary`, `OutputArtifact.path`, `FileMutationEvidence.path`, diagnostics, and metadata are modeled as strings that can contain secrets or private local paths.
- Files: `src/main/core/model/entities.ts`, `src/main/core/diagnostics/diagnostic.ts`, `src/main/adapters/fake-test/normalize.ts`, `.planning/REQUIREMENTS.md`
- Current mitigation: No export/import, IPC, or renderer layer exists, and the fake fixture does not contain secrets.
- Recommendations: Add redaction policy, export warnings, IPC sanitization, and local-only cache handling before exposing normalized data outside the main process.

**Read-only command policy is not encoded:**
- Risk: V1 allows only fixed read-only git and optional `gh` commands, but there is no provider module or allowlist implementation.
- Files: `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `src/main/core/model/entities.ts`
- Current mitigation: No shell execution code is present in `src/**`; shell commands are evidence strings only.
- Recommendations: Keep execution APIs out of renderer and adapters; implement git/GitHub providers as fixed-command read-only modules with argument allowlists and tests before any UI consumes git context.

## Performance Bottlenecks

**Whole-file fixture parsing does not scale to real session archives:**
- Problem: `parseFakeTestArtifact` reads the entire artifact into a UTF-8 string and then parses the full JSON document with `JSON.parse`.
- Files: `src/main/adapters/fake-test/parse.ts`, `src/main/adapters/fake-test/types.ts`
- Cause: The Phase 1 fake fixture is a single small JSON file.
- Improvement path: Use bounded reads for JSON fixtures, streaming JSONL parsing for real harness logs, artifact size checks from `RawArtifactRef.byteLength`, and diagnostics for oversized or truncated artifacts.

**Contract test harness parses all artifacts concurrently and keeps all raw events in memory:**
- Problem: `exerciseAdapter` uses `Promise.all` over all artifacts and flattens every raw event before normalization.
- Files: `tests/contract/run-adapter-contract.ts`
- Cause: The reusable contract harness is optimized for small fixtures.
- Improvement path: Keep this helper for small adapter fixtures, but add production ingestion tests with streaming/backpressure semantics once `src/main/core/**` scanner/cache modules exist.

**Recursive boundary tests scan source text with ad hoc regexes:**
- Problem: Import and naming boundary tests recursively read source files and parse imports using regexes.
- Files: `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`
- Cause: The current tree is small and has no TS AST-based boundary tool.
- Improvement path: Keep regex tests as fast smoke gates, but add AST or TypeScript compiler-based checks before path aliases, dynamic imports, or larger renderer trees are introduced.

## Fragile Areas

**Boundary enforcement has blind spots:**
- Files: `eslint.config.mjs`, `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`
- Why fragile: ESLint restrictions cover selected static syntax and the custom boundary test only reads relative static imports/exports. Dynamic imports, `require`, generated files, path aliases, non-TS files, and future Electron preload/renderer patterns need explicit coverage.
- Safe modification: Update both ESLint rules and boundary tests whenever adding import styles, path aliases, renderer code, or generated source folders.
- Test coverage: `npm run lint` and `npm run test:boundaries` cover current static TypeScript files under `src/main/core/**`, `src/main/adapters/**`, and `src/renderer/**` when those folders exist.

**Fake adapter normalization combines many responsibilities in one module:**
- Files: `src/main/adapters/fake-test/normalize.ts`
- Why fragile: The module builds capabilities, projects, sessions, diagnostics, events, messages, tool calls, shell command evidence, output artifacts, and file mutations in one pass. Adding lifecycle reconciliation, duplicate detection, missing-reference diagnostics, or multi-session fixtures will increase branching in a 495-line file.
- Safe modification: Extract focused helpers for diagnostics, entity builders, reference validation, and lifecycle/session reconciliation before adding multi-session or real-adapter behaviors.
- Test coverage: `tests/adapters/fake-test/fake-adapter.contract.test.ts`, `tests/adapters/fake-test/fake-adapter.golden.test.ts`, and `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts` cover the current single-session fixture only.

**Golden snapshot rewrite path can mask intentional review if used casually:**
- Files: `tests/adapters/fake-test/fake-adapter.golden.test.ts`, `tests/fixtures/fake-test/phase1-session.normalized.json`
- Why fragile: Setting `UPDATE_GOLDENS=1` rewrites the expected normalized snapshot during the test run.
- Safe modification: Treat golden updates as deliberate changes and review diffs in `tests/fixtures/fake-test/phase1-session.normalized.json` with the source fixture in `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
- Test coverage: `npm run test` compares the generated stable snapshot to the checked-in JSON when `UPDATE_GOLDENS` is not set.

**Capability schema is manually mirrored in multiple places:**
- Files: `src/main/core/model/capabilities.ts`, `src/main/adapters/fake-test/types.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/contract/run-adapter-contract.ts`
- Why fragile: Capability keys are defined as an interface, a Zod fixture schema, a normalizer copier, and a test constant. Adding or renaming a capability requires coordinated edits.
- Safe modification: Define capability keys once in `src/main/core/model/capabilities.ts` and derive schemas/tests from that key list.
- Test coverage: `tests/contract/run-adapter-contract.ts` verifies required capability keys in descriptors and normalized snapshots.

**Timestamp and path strings are weakly typed:**
- Files: `src/main/core/model/entities.ts`, `src/main/adapters/fake-test/types.ts`, `src/main/adapters/fake-test/normalize.ts`
- Why fragile: Timestamp fields use plain strings, fake fixture schemas use `z.string()`, and paths are stored as strings without normalization semantics. Invalid timestamps and mixed absolute/relative paths can pass adapter validation.
- Safe modification: Add shared timestamp/path validators and preserve whether a path is source-relative, project-relative, artifact-relative, or absolute.
- Test coverage: Current tests assert strings and relationships, not ISO timestamp validity or path safety.

## Scaling Limits

**File-backed cache and indexing are not implemented:**
- Current capacity: Current code normalizes one fake fixture in memory and stores one checked-in golden snapshot.
- Limit: Large session archives, incremental rescans, artifact invalidation, parser-version changes, diagnostics hash changes, and multi-source cache keys are not handled in runtime modules.
- Scaling path: Add raw artifact index and normalized cache modules under `src/main/core/**` using adapter/source/session IDs in keys, then add invalidation tests using fixture sets under `tests/fixtures/**`.

**Stable IDs use a 16-hex-character hash suffix:**
- Current capacity: Current fixture/test data has a small entity count.
- Limit: `hashStableParts` truncates SHA-256 to 64 bits, which is unlikely to collide for small local data but becomes a measurable risk at very high entity counts or imported archives.
- Scaling path: Increase the suffix length in `src/main/core/model/identifiers.ts` before large cache/export compatibility matters, and add collision/uniqueness tests around high-volume generated identities.

## Dependencies at Risk

**Electron, Vite, React, and Playwright are recommended but not installed:**
- Risk: Desktop shell, renderer, preload bridge, IPC security, and Electron smoke tests cannot be verified from the current dependency set.
- Impact: Phase 2 and UI/security work cannot rely on existing scaffold conventions.
- Migration plan: Add Electron Forge/Vite/React/Playwright dependencies and scripts in `package.json` when implementing the desktop shell, then map those conventions in `.planning/codebase/STACK.md` and `.planning/codebase/TESTING.md`.

**ESLint 10 and TypeScript 6 are current project dependencies:**
- Risk: These versions are present in `package.json` and `package-lock.json`; plugin compatibility should be checked before adding additional lint plugins or Electron/React tooling.
- Impact: Lint/typecheck gates can become brittle during frontend scaffold work.
- Migration plan: Add frontend lint plugins incrementally and run `npm run lint`, `npm run typecheck`, and `npm run test` after each tooling change.

## Missing Critical Features

**Real Gemini adapter is absent:**
- Problem: No `src/main/adapters/gemini-cli/**` implementation exists.
- Blocks: V1 cannot ingest the first real harness source described in `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md`.

**Shared shell parser, verification classifier, and run audit are absent:**
- Problem: Shell commands are modeled as evidence only; there is no shared parser, intent classifier, verification classifier, run-audit precedence, or attention reason generator.
- Blocks: The core value of truthfully classifying claimed-success runs cannot be delivered.

**Source registry, ingestion, watcher, and cache are absent:**
- Problem: No runtime modules configure sources, scan adapters, parse changed artifacts, normalize results, index raw artifacts, or persist normalized graphs.
- Blocks: Multi-source operation, incremental refresh, large local archives, diagnostics persistence, and UI data loading.

**Electron shell, IPC bridge, and renderer are absent:**
- Problem: No `src/main` Electron entrypoint, preload bridge, `src/renderer/**`, IPC handlers, CSP, or view-model layer exists.
- Blocks: Desktop app usage and all V1 UI acceptance criteria.

**Read-only git/GitHub providers are absent:**
- Problem: No fixed-command git or optional `gh` context provider exists.
- Blocks: Dirty-state, branch, HEAD SHA, PR/check/review context, and audit attention reasons that depend on repo state.

**Export/import and redaction warnings are absent:**
- Problem: No archive format, import source, raw artifact export, or sensitive-data warning workflow exists.
- Blocks: Portable audits and safe sharing of session evidence.

## Test Coverage Gaps

**Missing-reference diagnostics in fake adapter:**
- What's not tested: Unknown artifact IDs inside `tool-call.artifactIds`, unknown or duplicate file mutation IDs, duplicate event IDs, and inconsistent lifecycle metadata.
- Files: `src/main/adapters/fake-test/normalize.ts`, `tests/adapters/fake-test/fake-adapter.contract.test.ts`, `tests/adapters/fake-test/fake-adapter.golden.test.ts`
- Risk: Normalization can drop evidence or accept contradictory fixture state without diagnostics.
- Priority: High

**Runtime normalization validation:**
- What's not tested: Production validation that every adapter result has unique IDs, valid references, valid capability states, no conclusion fields, and safe string/path/timestamp values.
- Files: `src/main/core/adapter-contract/types.ts`, `src/main/core/model/entities.ts`, `tests/contract/run-adapter-contract.ts`
- Risk: Future adapters can pass TypeScript compilation while producing invalid runtime data.
- Priority: High

**Security boundary tests for Electron and IPC:**
- What's not tested: Node integration disabled, context isolation, sandboxing, CSP, typed preload bridge, sanitized IPC payloads, no renderer file reads, and no shell execution APIs.
- Files: `.planning/REQUIREMENTS.md`, `package.json`
- Risk: Desktop implementation can violate V1 read-only/privacy guarantees without a failing test.
- Priority: High

**Shell parser, verification, and run audit behavior:**
- What's not tested: Nonzero exit-code precedence over tool status, no-verification sessions as `not-run`, missing shell capability as unknown/unsupported, cancelled/incomplete classification, dirty repo after claim, parser warnings, and attention reason ordering.
- Files: `src/main/core/model/entities.ts`, `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts`, `.planning/REQUIREMENTS.md`
- Risk: The product can misclassify agent runs once real harness evidence arrives.
- Priority: High

**Real adapter parser hazards:**
- What's not tested: Gemini `.project_root`, `logs.json`, JSONL chat records, sidecars, duplicate/intermediate records, partial writes, cancellation events, corrupt JSON, missing sidecars, and active-file mutation.
- Files: `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`
- Risk: The first real adapter can crash or produce false clean states when local harness artifacts are incomplete or changing.
- Priority: High

**Boundary enforcement blind spots:**
- What's not tested: Dynamic imports, CommonJS `require`, path aliases, generated files, Electron preload files, non-TS renderer assets, and provider-specific UI branches in future `.tsx` code.
- Files: `eslint.config.mjs`, `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`
- Risk: Adapter-private or Gemini-specific code can leak into shared core or renderer after the source tree expands.
- Priority: Medium

**Performance and scale behavior:**
- What's not tested: Large artifacts, many artifacts per source, many sessions per source, streaming JSONL parsing, cache invalidation, or watcher backpressure.
- Files: `src/main/adapters/fake-test/parse.ts`, `tests/contract/run-adapter-contract.ts`, `src/main/core/model/identifiers.ts`
- Risk: Ingestion can become memory-heavy or slow before UI issues are visible.
- Priority: Medium

**Verification performed during this mapping:**
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run test`: passed, 7 test files and 16 tests

---

*Concerns audit: 2026-05-23*
