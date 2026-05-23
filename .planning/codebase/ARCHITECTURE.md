---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---
<!-- refreshed: 2026-05-23 -->
# Architecture

**Analysis Date:** 2026-05-23

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                 Contract and Boundary Test Layer             │
├─────────────────────┬───────────────────┬───────────────────┤
│ Adapter contracts   │ Import boundaries │ Truth rules       │
│ `tests/contract/**` │ `tests/boundaries`│ `tests/adapters`  │
└──────────┬──────────┴──────────┬────────┴──────────┬────────┘
           │                     │                   │
           ▼                     ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Shared Harness Core                       │
│ `src/main/core/adapter-contract`, `src/main/core/model`,      │
│ `src/main/core/diagnostics`, `src/main/core/registry`         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Harness Adapter Implementations              │
│ `src/main/adapters/fake-test`                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Fixture Evidence                        │
│ `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json` │
│ `tests/fixtures/fake-test/phase1-session.normalized.json`    │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `SessionSourceAdapter` contract | Defines the harness adapter lifecycle: validate source root, discover sources, discover artifacts, parse raw events, normalize evidence, optionally load output artifacts. | `src/main/core/adapter-contract/session-source-adapter.ts` |
| Adapter payload and result types | Defines `SourceRootConfig`, `DiscoveredHarnessSource`, `RawArtifactRef`, `RawHarnessEvent`, `AdapterNormalizationInput`, `AdapterNormalizationResult`, and capability snapshots. | `src/main/core/adapter-contract/types.ts` |
| Normalized evidence model | Owns harness-neutral entity shapes for projects, sessions, events, messages, tool calls, shell command evidence, artifacts, and file mutation evidence. | `src/main/core/model/entities.ts` |
| Capability model | Represents supported, unsupported, and unknown states explicitly for every adapter/source/session capability. | `src/main/core/model/capabilities.ts` |
| Stable identity helpers | Builds deterministic IDs for normalized entities by hashing adapter, source, native ID, and entity kind. | `src/main/core/model/identifiers.ts` |
| Diagnostics | Builds structured diagnostics with severity, scope, adapter/source identity, confidence, and related entity IDs. | `src/main/core/diagnostics/diagnostic.ts` |
| Adapter registry | Stores adapters by `adapter.descriptor.id`, rejects duplicate registrations, and exposes descriptors or adapter instances. | `src/main/core/registry/adapter-registry.ts` |
| Bundled adapter composition root | The only shared-core file that imports adapter entrypoints; registers `fake-test` into an `AdapterRegistry`. | `src/main/core/registry/register-bundled-adapters.ts` |
| Fake test adapter entrypoint | Assembles descriptor, discovery, parsing, and normalization functions into one `SessionSourceAdapter<FakeRawEvent>`. | `src/main/adapters/fake-test/index.ts` |
| Fake test descriptor | Declares adapter metadata, default fixture root, supported platforms, and explicit capability truth states. | `src/main/adapters/fake-test/descriptor.ts` |
| Fake test discovery | Validates a fixture file root, yields a discovered source, and yields one raw artifact reference. | `src/main/adapters/fake-test/discovery.ts` |
| Fake test parser | Reads JSON fixture files, validates them with Zod, emits fixture metadata events, timeline events, or parse diagnostics. | `src/main/adapters/fake-test/parse.ts` |
| Fake test normalizer | Maps raw fixture metadata and timeline events into normalized projects, sessions, events, messages, tools, commands, artifacts, file mutations, capabilities, and diagnostics. | `src/main/adapters/fake-test/normalize.ts` |
| Fake fixture schema | Owns Zod schemas for fake fixture capabilities, timeline event variants, artifacts, diagnostics, and parsed payloads. | `src/main/adapters/fake-test/types.ts` |
| Adapter contract harness | Exercises any `SessionSourceAdapter` end-to-end and asserts mandatory capability, diagnostic, relationship, and forbidden-conclusion invariants. | `tests/contract/run-adapter-contract.ts` |
| Import boundary tests | Enforces that shared core imports no adapter-private modules except the registry composition root, renderer imports no adapter-private modules, and adapters do not import sibling adapters. | `tests/boundaries/import-boundaries.test.ts` |
| Shared naming tests | Enforces harness-neutral shared names and prevents adapter-facing contracts from carrying final verification or audit conclusions. | `tests/boundaries/shared-naming.test.ts` |

## Pattern Overview

**Overall:** Contract-first adapter pipeline with harness-neutral shared core and adapter-private mapping modules.

**Key Characteristics:**
- Shared core types live under `src/main/core/**` and use harness-neutral names such as `Session`, `RawHarnessEvent`, `ShellCommandEvidence`, and `OutputArtifact` in `src/main/core/model/entities.ts` and `src/main/core/adapter-contract/types.ts`.
- Adapter implementations live under `src/main/adapters/<adapter-id>/**`; the `fake-test` adapter keeps descriptor, discovery, parser, schema, and normalizer code separated in `src/main/adapters/fake-test/descriptor.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/parse.ts`, `src/main/adapters/fake-test/types.ts`, and `src/main/adapters/fake-test/normalize.ts`.
- Adapters emit evidence, capability snapshots, and diagnostics through `AdapterNormalizationResult` in `src/main/core/adapter-contract/types.ts`; they do not emit final verification status, run audit classification, or attention reasons.
- Unsupported and unknown evidence capabilities are first-class states in `src/main/core/model/capabilities.ts`, not booleans or empty values.
- The registry composition root in `src/main/core/registry/register-bundled-adapters.ts` is the allowed bridge from shared core to adapter entrypoints.
- Tests encode architectural contracts directly in `tests/contract/run-adapter-contract.ts`, `tests/boundaries/import-boundaries.test.ts`, and `tests/boundaries/shared-naming.test.ts`.

## Layers

**Shared Adapter Contract:**
- Purpose: Define what every harness adapter must provide and what normalized output shape it returns.
- Location: `src/main/core/adapter-contract`
- Contains: `SessionSourceAdapter`, `HarnessDescriptor`, root/source/artifact/raw event types, normalization input/result types, optional artifact loading type.
- Depends on: `src/main/core/model/capabilities.ts`, `src/main/core/model/entities.ts`, `src/main/core/model/identifiers.ts`, `src/main/core/diagnostics/diagnostic.ts`
- Used by: `src/main/adapters/fake-test/index.ts`, `src/main/adapters/fake-test/normalize.ts`, `src/main/adapters/fake-test/parse.ts`, `tests/contract/run-adapter-contract.ts`, `tests/contract/adapter-contract.test.ts`

**Shared Normalized Model:**
- Purpose: Provide harness-neutral entity contracts and stable identity semantics for normalized session evidence.
- Location: `src/main/core/model`
- Contains: capability states, confidence scores, stable ID builders, and normalized entity interfaces.
- Depends on: Node `crypto` in `src/main/core/model/identifiers.ts`
- Used by: `src/main/core/adapter-contract/types.ts`, `src/main/core/diagnostics/diagnostic.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/descriptor.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/contract/run-adapter-contract.ts`

**Diagnostics:**
- Purpose: Represent parser, source, artifact, and normalization issues as structured, confidence-bearing evidence.
- Location: `src/main/core/diagnostics`
- Contains: `Diagnostic`, severity/scope enums, diagnostic metadata values, and `buildDiagnostic`.
- Depends on: `src/main/core/model/confidence.ts`, `src/main/core/model/identifiers.ts`
- Used by: `src/main/core/adapter-contract/types.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/contract/run-adapter-contract.ts`

**Registry and Composition:**
- Purpose: Register and retrieve adapters without hardcoding adapter internals across shared core.
- Location: `src/main/core/registry`
- Contains: `AdapterRegistry`, `registerBundledAdapters`, `createBundledAdapterRegistry`, and barrel exports.
- Depends on: `src/main/core/adapter-contract/index.ts`, `src/main/core/model/identifiers.ts`, and the allowed adapter entrypoint import `src/main/adapters/fake-test/index.ts`
- Used by: `tests/adapters/fake-test/fake-adapter.smoke.test.ts`

**Adapter Implementation:**
- Purpose: Convert one harness's raw evidence into shared normalized entities and diagnostics.
- Location: `src/main/adapters/fake-test`
- Contains: adapter entrypoint, descriptor/capabilities, source and artifact discovery, Zod schemas, JSON parsing, and normalization.
- Depends on: shared core contracts/models/diagnostics plus Node filesystem/path APIs and Zod.
- Used by: `src/main/core/registry/register-bundled-adapters.ts`, `tests/adapters/fake-test/*.test.ts`

**Contract and Boundary Tests:**
- Purpose: Keep adapter behavior, core/adapter boundaries, harness-neutral naming, explicit truth states, and normalized relationships enforceable.
- Location: `tests`
- Contains: reusable adapter contract suite in `tests/contract/run-adapter-contract.ts`, stub adapter proof in `tests/contract/adapter-contract.test.ts`, fake adapter tests in `tests/adapters/fake-test`, boundary fixtures in `tests/boundaries/fixtures`, and golden normalized fixture in `tests/fixtures/fake-test/phase1-session.normalized.json`.
- Depends on: Vitest, Node filesystem/path APIs, shared core contracts, and adapter entrypoints.
- Used by: `npm run test` and `npm run test:boundaries` from `package.json`.

## Data Flow

### Primary Adapter Exercise Path

1. Create a bundled registry with `createBundledAdapterRegistry()` (`src/main/core/registry/register-bundled-adapters.ts:11`) and require the `fake-test` adapter (`src/main/core/registry/adapter-registry.ts:23`).
2. Validate a root fixture file with `validateFakeTestSourceRoot()` (`src/main/adapters/fake-test/discovery.ts:16`); invalid roots return source-scoped diagnostics from `buildDiagnostic()` (`src/main/core/diagnostics/diagnostic.ts:35`).
3. Discover one source with `discoverFakeTestSources()` (`src/main/adapters/fake-test/discovery.ts:68`), using `createSourceId()` from `src/main/core/model/identifiers.ts:51`.
4. Discover one raw artifact with `discoverFakeTestArtifacts()` (`src/main/adapters/fake-test/discovery.ts:92`), using `createRawArtifactId()` from `src/main/core/model/identifiers.ts:91`.
5. Parse the JSON artifact with `parseFakeTestArtifact()` (`src/main/adapters/fake-test/parse.ts:33`); read/JSON/schema failures become raw parse-diagnostic events from `src/main/adapters/fake-test/parse.ts:9`.
6. Validate parsed fixture shape with `fakeHarnessFixtureSchema` (`src/main/adapters/fake-test/types.ts:110`) and emit one metadata raw event plus one raw event per fixture timeline entry (`src/main/adapters/fake-test/parse.ts:71`).
7. Normalize raw events with `normalizeFakeTestEvents()` (`src/main/adapters/fake-test/normalize.ts:133`), creating projects, sessions, events, messages, tool calls, shell commands, output artifacts, file mutations, capabilities, and diagnostics.
8. Return `AdapterNormalizationResult` (`src/main/core/adapter-contract/types.ts:97`) and assert relationships/conclusion boundaries through `exerciseAdapter()` (`tests/contract/run-adapter-contract.ts:389`) and `runAdapterContractSuite()` (`tests/contract/run-adapter-contract.ts:428`).

### Golden Fixture Flow

1. The fake adapter consumes `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
2. `tests/adapters/fake-test/fake-adapter.golden.test.ts` exercises the adapter through `exerciseAdapter()` from `tests/contract/run-adapter-contract.ts`.
3. `toStableNormalizedSnapshot()` rewrites generated stable hash IDs into deterministic labels for reviewable snapshots (`tests/adapters/fake-test/fake-adapter.golden.test.ts:55`).
4. The resulting normalized snapshot is compared to `tests/fixtures/fake-test/phase1-session.normalized.json`.

### Boundary Validation Flow

1. `tests/boundaries/import-boundaries.test.ts` recursively collects TypeScript files from `src/main/core`, `src/main/adapters`, and `src/renderer`.
2. Relative imports are resolved to repo paths by `resolveImport()` (`tests/boundaries/import-boundaries.test.ts:194`).
3. Source and target paths are classified as core, renderer, adapter, or other by `classifySourcePath()` (`tests/boundaries/import-boundaries.test.ts:261`).
4. Violations are reported when shared core imports adapter-private modules outside `src/main/core/registry/register-bundled-adapters.ts`, renderer imports adapter-private modules, or one adapter imports another adapter.
5. `tests/boundaries/shared-naming.test.ts` scans shared core and renderer-facing source text for Gemini-specific shared symbols, provider branches, and forbidden conclusion fields.

**State Management:**
- No application runtime state store is present. In-memory state is local to functions and test runs.
- `AdapterRegistry` owns a private in-memory `Map<AdapterId, SessionSourceAdapter>` in `src/main/core/registry/adapter-registry.ts`.
- The fake adapter normalizer uses local arrays and maps in `src/main/adapters/fake-test/normalize.ts` to assemble one `AdapterNormalizationResult`.
- Persistent inputs and expected outputs are JSON fixtures at `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json` and `tests/fixtures/fake-test/phase1-session.normalized.json`.

## Key Abstractions

**`SessionSourceAdapter`:**
- Purpose: Harness adapter interface for read-only source validation, discovery, parsing, and normalization.
- Examples: `src/main/core/adapter-contract/session-source-adapter.ts`, `src/main/adapters/fake-test/index.ts`, `tests/contract/adapter-contract.test.ts`
- Pattern: Interface-based adapter contract with generic raw event payload type.

**`HarnessDescriptor`:**
- Purpose: Metadata and capability declaration for an adapter.
- Examples: `src/main/core/adapter-contract/session-source-adapter.ts`, `src/main/adapters/fake-test/descriptor.ts`
- Pattern: Descriptor object paired with implementation methods in adapter entrypoints.

**`AdapterNormalizationResult`:**
- Purpose: Complete normalized output payload from an adapter, including entities, capability snapshots, and diagnostics.
- Examples: `src/main/core/adapter-contract/types.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/contract/run-adapter-contract.ts`
- Pattern: Evidence graph plus diagnostics; no final audit or verification conclusions.

**Normalized Entities:**
- Purpose: Shared vocabulary for projects, sessions, timeline events, messages, tool calls, shell commands, artifacts, and file mutations.
- Examples: `src/main/core/model/entities.ts`, `tests/fixtures/fake-test/phase1-session.normalized.json`
- Pattern: Entity interfaces include `id`, `adapterId`, `sourceId` where applicable, `nativeId`, `confidence`, optional diagnostics, and optional metadata.

**Capability Snapshots:**
- Purpose: Preserve explicit adapter/source/session support states.
- Examples: `src/main/core/model/capabilities.ts`, `src/main/adapters/fake-test/descriptor.ts`, `src/main/adapters/fake-test/normalize.ts`, `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts`
- Pattern: `supported`, `unsupported`, and `unknown` objects with optional `reason` and `details`.

**Stable IDs:**
- Purpose: Produce deterministic entity IDs from adapter, source, native ID, and kind without exposing raw path-heavy identifiers.
- Examples: `src/main/core/model/identifiers.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/normalize.ts`
- Pattern: SHA-256 hash prefix with kind prefix, generated through per-entity helper functions.

**Diagnostics:**
- Purpose: Represent invalid source roots, parser failures, missing metadata, unknown artifacts, and fixture diagnostics as normalized diagnostic evidence.
- Examples: `src/main/core/diagnostics/diagnostic.ts`, `src/main/adapters/fake-test/parse.ts`, `src/main/adapters/fake-test/normalize.ts`
- Pattern: Diagnostic builder plus adapter-specific diagnostic codes.

## Entry Points

**Bundled Adapter Registry:**
- Location: `src/main/core/registry/index.ts`
- Triggers: Tests and future main-process composition imports.
- Responsibilities: Export `AdapterRegistry`, `registerBundledAdapters`, and `createBundledAdapterRegistry`.

**Adapter Contract Barrel:**
- Location: `src/main/core/adapter-contract/index.ts`
- Triggers: Adapter implementations and contract tests import shared adapter types from this barrel.
- Responsibilities: Export `SessionSourceAdapter`, `HarnessDescriptor`, and adapter lifecycle payload/result types.

**Shared Model Barrel:**
- Location: `src/main/core/model/index.ts`
- Triggers: Shared core and adapters import harness-neutral model primitives from this barrel.
- Responsibilities: Export capabilities, confidence, entities, and ID helpers.

**Fake Test Adapter Entrypoint:**
- Location: `src/main/adapters/fake-test/index.ts`
- Triggers: Bundled registry composition and fake adapter tests.
- Responsibilities: Expose `fakeTestAdapter`, `fakeTestDescriptor`, `FakeRawEvent`, and fake adapter schema/types.

**Reusable Adapter Contract Suite:**
- Location: `tests/contract/run-adapter-contract.ts`
- Triggers: Adapter tests such as `tests/adapters/fake-test/fake-adapter.contract.test.ts` and stub contract tests in `tests/contract/adapter-contract.test.ts`.
- Responsibilities: Exercise the adapter lifecycle and assert normalized shape, relationships, truth states, diagnostics, and forbidden conclusion keys.

**Boundary Test Entrypoints:**
- Location: `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`
- Triggers: `npm run test:boundaries` and `npm run test`.
- Responsibilities: Enforce layer boundaries and harness-neutral shared naming.

**Application Runtime Entrypoint:**
- Location: Not detected.
- Triggers: Not applicable.
- Responsibilities: Not applicable; this repository contains Phase 1 contracts, fixtures, adapters, and tests, not an Electron main/preload/renderer runtime entrypoint.

## Architectural Constraints

- **Threading:** Single-process Node/Vitest execution; no worker threads, Electron process boundary, or renderer process code is present in `src`.
- **Global state:** `AdapterRegistry` keeps adapter registrations in an instance-private `Map` in `src/main/core/registry/adapter-registry.ts`; no module-level mutable registry singleton is present.
- **Circular imports:** No circular dependency chain is declared or detected by the source layout. Keep shared barrels in `src/main/core/*/index.ts` as export-only files to avoid cross-layer initialization cycles.
- **Adapter/core boundary:** Shared core must not import adapter-private modules except `src/main/core/registry/register-bundled-adapters.ts`, and that file must import adapter entrypoints only, as enforced by `tests/boundaries/import-boundaries.test.ts`.
- **Adapter isolation:** Adapters under `src/main/adapters/<id>` must not import sibling adapter modules, as enforced by `tests/boundaries/import-boundaries.test.ts`.
- **Renderer isolation:** Renderer-facing code must not import adapter-private modules; the current repository has no `src/renderer` directory, but boundary tests reserve that layer in `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts`.
- **Harness neutrality:** Shared core and renderer-facing source must not introduce Gemini-specific symbols or provider-specific branches, as enforced by `tests/boundaries/shared-naming.test.ts`.
- **Evidence-only adapters:** Adapter-facing shared contracts must not add `verificationStatus`, `verificationState`, `runAuditStatus`, `runAuditClassification`, `attentionReasons`, or equivalent conclusion fields, as enforced by `tests/boundaries/shared-naming.test.ts` and `tests/contract/run-adapter-contract.ts`.

## Anti-Patterns

### Adapter-Private Imports From Shared Core

**What happens:** A file under `src/main/core/**` imports adapter-private modules such as `src/main/adapters/fake-test/normalize.ts`.
**Why it's wrong:** Shared core becomes harness-specific and cannot support multiple adapters through the same contract.
**Do this instead:** Import adapter entrypoints only from `src/main/core/registry/register-bundled-adapters.ts`; keep adapter internals under `src/main/adapters/<id>/**`.

### Provider-Specific Shared Types or Branches

**What happens:** Shared core or renderer-facing code introduces names such as `GeminiSessionRecord` or branches on `adapterId === "gemini-cli"`.
**Why it's wrong:** Shared contracts and renderer-facing surfaces stop being harness-neutral.
**Do this instead:** Use shared types from `src/main/core/model/entities.ts` and adapter-local mapping inside `src/main/adapters/<id>/**`.

### Adapter-Owned Final Conclusions

**What happens:** Adapter contracts or normalized adapter output add final fields such as `verificationStatus`, `runAuditClassification`, or `attentionReasons`.
**Why it's wrong:** Adapters own evidence and diagnostics; shared core owns later verification and audit interpretation.
**Do this instead:** Emit `ShellCommandEvidence`, `ToolCall`, `Diagnostic`, and explicit capability states from `src/main/core/model/entities.ts`, `src/main/core/diagnostics/diagnostic.ts`, and `src/main/core/model/capabilities.ts`.

### Flattening Unsupported Evidence to Empty Values

**What happens:** Unsupported, unknown, or missing evidence is represented as `0`, `false`, `"clean"`, empty arrays, or absent capability fields.
**Why it's wrong:** The UI and audit layers cannot distinguish unsupported evidence from clean evidence.
**Do this instead:** Use `CapabilityState` values from `src/main/core/model/capabilities.ts` and include reasons for unsupported or unknown states in descriptors and normalization results.

## Error Handling

**Strategy:** Convert source, artifact, parser, schema, and normalization issues into structured diagnostics rather than throwing across the adapter contract boundary when evidence can still be represented.

**Patterns:**
- Source validation failures return `SourceRootValidation` with `ok: false`, `normalizedPath`, and diagnostics in `src/main/adapters/fake-test/discovery.ts`.
- Artifact read, JSON parse, and schema validation failures yield raw parse-diagnostic events in `src/main/adapters/fake-test/parse.ts`.
- Missing fixture metadata returns an otherwise empty `AdapterNormalizationResult` with a diagnostic in `src/main/adapters/fake-test/normalize.ts`.
- Unknown artifact references during normalization append warning diagnostics and keep processing remaining timeline events in `src/main/adapters/fake-test/normalize.ts`.
- Contract tests assert diagnostic shape and relationship integrity in `tests/contract/run-adapter-contract.ts`.

## Cross-Cutting Concerns

**Logging:** Not detected; no logging framework or console logging pattern is present in `src`.

**Validation:** Zod validates fake fixture structure in `src/main/adapters/fake-test/types.ts`; Vitest contract tests validate adapter outputs in `tests/contract/run-adapter-contract.ts`; boundary tests validate architectural imports and naming in `tests/boundaries`.

**Authentication:** Not applicable; no authentication or identity provider code is present in `src`.

**Security:** V1 code is read-only fixture ingestion. `src/main/adapters/fake-test/discovery.ts` uses `stat` for file validation and `src/main/adapters/fake-test/parse.ts` uses `readFile` for fixture reads. No shell execution, Electron preload bridge, broad file read API, or renderer Node integration code is present.

**Runtime Configuration:** Adapter roots are provided as `SourceRootConfig` values from `src/main/core/adapter-contract/types.ts`; the fake adapter descriptor includes a default root at `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.

---

*Architecture analysis: 2026-05-23*
