---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---
# Codebase Structure

**Analysis Date:** 2026-05-23

## Directory Layout

```text
control-plus-zebra/
├── AGENTS.md                         # Repository instructions, project scope, stack, architecture guardrails
├── README.md                         # Phase 1 overview and verification commands
├── package.json                      # npm scripts and TypeScript/Vitest/Zod dependencies
├── package-lock.json                 # npm lockfile
├── tsconfig.json                     # strict NodeNext TypeScript configuration
├── eslint.config.mjs                 # ESLint configuration
├── vitest.config.ts                  # Vitest configuration
├── src/
│   └── main/
│       ├── adapters/
│       │   └── fake-test/
│       │       ├── descriptor.ts     # Adapter metadata and explicit capabilities
│       │       ├── discovery.ts      # Source root validation and artifact discovery
│       │       ├── fixtures/         # Adapter-owned raw fixture inputs
│       │       ├── index.ts          # Adapter entrypoint
│       │       ├── normalize.ts      # Raw event to normalized entity mapping
│       │       ├── parse.ts          # Fixture file parsing and parse diagnostics
│       │       └── types.ts          # Zod fixture schemas and adapter-private payload types
│       └── core/
│           ├── adapter-contract/     # Shared adapter interfaces and payload/result types
│           ├── diagnostics/          # Structured diagnostic types and builder
│           ├── model/                # Harness-neutral normalized model, IDs, confidence, capabilities
│           └── registry/             # Adapter registry and bundled-adapter composition root
├── tests/
│   ├── adapters/
│   │   └── fake-test/                # Fake adapter contract, smoke, golden, and truth-rule tests
│   ├── boundaries/                   # Import and shared naming boundary tests
│   ├── contract/                     # Reusable adapter contract suite and stub adapter proof
│   └── fixtures/
│       └── fake-test/                # Checked-in normalized golden fixture
└── .planning/
    ├── codebase/                     # Generated codebase mapping docs
    ├── phases/                       # GSD phase planning artifacts
    └── research/                     # Research docs for stack, architecture, pitfalls, features
```

## Directory Purposes

**`src/main/core/adapter-contract`:**
- Purpose: Shared contract surface for all harness adapters.
- Contains: `SessionSourceAdapter`, `HarnessDescriptor`, source root types, raw artifact types, raw event types, normalization input/result types, and artifact loading types.
- Key files: `src/main/core/adapter-contract/session-source-adapter.ts`, `src/main/core/adapter-contract/types.ts`, `src/main/core/adapter-contract/index.ts`

**`src/main/core/model`:**
- Purpose: Harness-neutral data model used by adapters, future core services, and renderer-facing view models.
- Contains: capability states, confidence scores, normalized entity interfaces, stable ID helper functions, and a barrel export.
- Key files: `src/main/core/model/entities.ts`, `src/main/core/model/capabilities.ts`, `src/main/core/model/identifiers.ts`, `src/main/core/model/confidence.ts`, `src/main/core/model/index.ts`

**`src/main/core/diagnostics`:**
- Purpose: Shared diagnostic vocabulary for source, parser, artifact, normalization, and entity issues.
- Contains: diagnostic severity/scope types, `Diagnostic`, and `buildDiagnostic`.
- Key files: `src/main/core/diagnostics/diagnostic.ts`, `src/main/core/diagnostics/index.ts`

**`src/main/core/registry`:**
- Purpose: Adapter registration and bundled-adapter composition.
- Contains: `AdapterRegistry`, registry helper functions, and a barrel export.
- Key files: `src/main/core/registry/adapter-registry.ts`, `src/main/core/registry/register-bundled-adapters.ts`, `src/main/core/registry/index.ts`

**`src/main/adapters/fake-test`:**
- Purpose: Fake/stub harness adapter proving the shared core and UI contracts are not Gemini-hardcoded.
- Contains: adapter descriptor, source/artifact discovery, parser, normalizer, Zod schemas, adapter entrypoint, and a raw fixture file.
- Key files: `src/main/adapters/fake-test/index.ts`, `src/main/adapters/fake-test/descriptor.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/parse.ts`, `src/main/adapters/fake-test/normalize.ts`, `src/main/adapters/fake-test/types.ts`, `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`

**`tests/contract`:**
- Purpose: Reusable contract tests that every adapter should satisfy.
- Contains: `runAdapterContractSuite`, `exerciseAdapter`, assertion helpers, and an inline stub adapter used to prove the contract is adapter-neutral.
- Key files: `tests/contract/run-adapter-contract.ts`, `tests/contract/adapter-contract.test.ts`

**`tests/adapters/fake-test`:**
- Purpose: Adapter-specific coverage for `src/main/adapters/fake-test`.
- Contains: contract tests, bundled registry smoke proof, truth-rule tests, and golden normalized snapshot comparison.
- Key files: `tests/adapters/fake-test/fake-adapter.contract.test.ts`, `tests/adapters/fake-test/fake-adapter.smoke.test.ts`, `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts`, `tests/adapters/fake-test/fake-adapter.golden.test.ts`

**`tests/boundaries`:**
- Purpose: Enforce architectural import boundaries and shared naming rules.
- Contains: import scanner tests, shared naming scanner tests, and synthetic illegal import fixtures.
- Key files: `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`, `tests/boundaries/fixtures/illegal-core-import.ts`, `tests/boundaries/fixtures/illegal-renderer-import.ts`, `tests/boundaries/fixtures/illegal-adapter-import.ts`

**`tests/fixtures`:**
- Purpose: Checked-in expected normalized outputs for golden tests.
- Contains: stable normalized snapshots.
- Key files: `tests/fixtures/fake-test/phase1-session.normalized.json`

**`src/renderer`:**
- Purpose: Reserved renderer layer referenced by boundary tests and AGENTS architecture guidance.
- Contains: Not detected.
- Key files: Not applicable.

## Key File Locations

**Entry Points:**
- `src/main/core/registry/index.ts`: Public registry barrel for bundled adapter composition.
- `src/main/core/registry/register-bundled-adapters.ts`: Registers bundled adapters and imports adapter entrypoints.
- `src/main/core/adapter-contract/index.ts`: Public shared adapter contract barrel.
- `src/main/core/model/index.ts`: Public shared model barrel.
- `src/main/adapters/fake-test/index.ts`: Fake adapter entrypoint.
- `tests/contract/run-adapter-contract.ts`: Reusable adapter contract test entrypoint.
- `tests/adapters/fake-test/fake-adapter.smoke.test.ts`: End-to-end fake adapter smoke entrypoint through the bundled registry.

**Configuration:**
- `package.json`: npm scripts (`lint`, `typecheck`, `test`, `test:boundaries`) and dependencies.
- `package-lock.json`: npm dependency lockfile.
- `tsconfig.json`: strict TypeScript settings with `module`/`moduleResolution` set to `NodeNext`.
- `eslint.config.mjs`: ESLint configuration.
- `vitest.config.ts`: Vitest configuration.
- `AGENTS.md`: Repository-level architecture, conventions, scope, and workflow instructions.
- `README.md`: Phase 1 overview and verification commands.

**Core Logic:**
- `src/main/core/adapter-contract/session-source-adapter.ts`: Adapter interface and descriptor shape.
- `src/main/core/adapter-contract/types.ts`: Adapter lifecycle payloads and normalized result shape.
- `src/main/core/model/entities.ts`: Normalized entity interfaces.
- `src/main/core/model/capabilities.ts`: Explicit supported/unsupported/unknown capability states.
- `src/main/core/model/identifiers.ts`: Stable ID generation helpers.
- `src/main/core/diagnostics/diagnostic.ts`: Diagnostic builder and types.
- `src/main/core/registry/adapter-registry.ts`: Adapter registry implementation.
- `src/main/adapters/fake-test/normalize.ts`: Fake adapter normalization logic.
- `src/main/adapters/fake-test/parse.ts`: Fake fixture parser.
- `src/main/adapters/fake-test/discovery.ts`: Fake source/artifact discovery.

**Testing:**
- `tests/contract/run-adapter-contract.ts`: Adapter lifecycle and normalized graph assertions.
- `tests/contract/adapter-contract.test.ts`: Inline non-fake stub adapter proof.
- `tests/adapters/fake-test/fake-adapter.contract.test.ts`: Fake adapter contract invocation.
- `tests/adapters/fake-test/fake-adapter.smoke.test.ts`: Bundled registry smoke test.
- `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts`: Explicit unsupported/unknown states and evidence-only output tests.
- `tests/adapters/fake-test/fake-adapter.golden.test.ts`: Golden normalized fixture comparison.
- `tests/boundaries/import-boundaries.test.ts`: Layer import boundary tests.
- `tests/boundaries/shared-naming.test.ts`: Harness-neutral shared naming and forbidden conclusion field tests.
- `tests/fixtures/fake-test/phase1-session.normalized.json`: Expected normalized snapshot.

## Naming Conventions

**Files:**
- Use lower-case kebab-case adapter IDs and adapter directories: `src/main/adapters/fake-test`.
- Use focused lower-case module names for adapter stages: `descriptor.ts`, `discovery.ts`, `parse.ts`, `normalize.ts`, `types.ts`, `index.ts`.
- Use `index.ts` only as a barrel or public entrypoint: `src/main/core/model/index.ts`, `src/main/core/adapter-contract/index.ts`, `src/main/core/registry/index.ts`, `src/main/adapters/fake-test/index.ts`.
- Use `*.test.ts` for Vitest files: `tests/adapters/fake-test/fake-adapter.contract.test.ts`, `tests/boundaries/import-boundaries.test.ts`.
- Use fixture suffixes that state the fixture role: `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`, `tests/fixtures/fake-test/phase1-session.normalized.json`.

**Directories:**
- Put shared main-process/core code under `src/main/core/<domain>`.
- Put harness-specific code under `src/main/adapters/<adapter-id>`.
- Put adapter-specific tests under `tests/adapters/<adapter-id>`.
- Put reusable cross-adapter contract tests under `tests/contract`.
- Put architectural boundary tests under `tests/boundaries`.
- Put golden expected outputs under `tests/fixtures/<adapter-id>`.

**Types and Symbols:**
- Use harness-neutral shared type names in `src/main/core/**`: `HarnessDescriptor`, `SessionSourceAdapter`, `RawHarnessEvent`, `Session`, `SessionEvent`, `ToolCall`, `ShellCommandEvidence`, `OutputArtifact`, `Diagnostic`.
- Keep adapter-specific prefixes inside adapter-private files: `FakeRawEvent`, `FakeTimelineEvent`, `fakeTestAdapter`, `fakeHarnessFixtureSchema` in `src/main/adapters/fake-test/**`.
- Use verb-prefixed lifecycle functions for adapter stages: `validateFakeTestSourceRoot`, `discoverFakeTestSources`, `discoverFakeTestArtifacts`, `parseFakeTestArtifact`, `normalizeFakeTestEvents`.
- Use `create<Entity>Id` for stable ID helpers in `src/main/core/model/identifiers.ts`.
- Use `build*` helper names for pure object construction helpers such as `buildDiagnostic` in `src/main/core/diagnostics/diagnostic.ts`.

## Where to Add New Code

**New Harness Adapter:**
- Primary code: `src/main/adapters/<adapter-id>/index.ts`, `src/main/adapters/<adapter-id>/descriptor.ts`, `src/main/adapters/<adapter-id>/discovery.ts`, `src/main/adapters/<adapter-id>/parse.ts`, `src/main/adapters/<adapter-id>/normalize.ts`, `src/main/adapters/<adapter-id>/types.ts`
- Fixture inputs: `src/main/adapters/<adapter-id>/fixtures/`
- Registry registration: `src/main/core/registry/register-bundled-adapters.ts`
- Contract tests: `tests/adapters/<adapter-id>/<adapter-id>.contract.test.ts`
- Smoke/truth tests: `tests/adapters/<adapter-id>/`
- Golden outputs: `tests/fixtures/<adapter-id>/`

**New Adapter Contract Capability or Lifecycle Field:**
- Shared contract code: `src/main/core/adapter-contract/types.ts` or `src/main/core/adapter-contract/session-source-adapter.ts`
- Capability model code: `src/main/core/model/capabilities.ts`
- Adapter implementations: `src/main/adapters/<adapter-id>/descriptor.ts` and `src/main/adapters/<adapter-id>/normalize.ts`
- Contract enforcement: `tests/contract/run-adapter-contract.ts`
- Boundary naming enforcement: `tests/boundaries/shared-naming.test.ts`

**New Normalized Entity Field:**
- Entity interface: `src/main/core/model/entities.ts`
- Stable ID helper, if a new entity type is added: `src/main/core/model/identifiers.ts`
- Adapter mapping: `src/main/adapters/<adapter-id>/normalize.ts`
- Contract assertions: `tests/contract/run-adapter-contract.ts`
- Golden snapshots: `tests/fixtures/<adapter-id>/`

**New Shared Diagnostic Type or Scope:**
- Diagnostic model: `src/main/core/diagnostics/diagnostic.ts`
- Adapter use sites: `src/main/adapters/<adapter-id>/discovery.ts`, `src/main/adapters/<adapter-id>/parse.ts`, `src/main/adapters/<adapter-id>/normalize.ts`
- Contract assertions: `tests/contract/run-adapter-contract.ts`

**New Renderer Code:**
- Implementation: `src/renderer/`
- Import boundary coverage: `tests/boundaries/import-boundaries.test.ts`
- Naming boundary coverage: `tests/boundaries/shared-naming.test.ts`
- Do not import adapter-private files from `src/renderer/**`; consume shared/core view model surfaces only.

**New Shared Utility:**
- Shared core utilities that are part of normalized evidence contracts: `src/main/core/<domain>/`
- Adapter-private helpers: `src/main/adapters/<adapter-id>/`
- Test-only helpers: `tests/contract/` for reusable adapter contract helpers, or the nearest `tests/<area>/` directory for area-specific helpers.

**New Fixture:**
- Raw adapter fixture: `src/main/adapters/<adapter-id>/fixtures/<scenario>.fixture.json`
- Normalized golden fixture: `tests/fixtures/<adapter-id>/<scenario>.normalized.json`
- Golden test update: `tests/adapters/<adapter-id>/`

## Special Directories

**`src/main/adapters/fake-test/fixtures`:**
- Purpose: Adapter-owned raw fixture evidence for the fake harness.
- Generated: No
- Committed: Yes

**`tests/fixtures/fake-test`:**
- Purpose: Expected normalized golden snapshots for fake adapter tests.
- Generated: Test can refresh contents when intentionally updated through `tests/adapters/fake-test/fake-adapter.golden.test.ts`.
- Committed: Yes

**`tests/boundaries/fixtures`:**
- Purpose: Synthetic illegal import fixtures used to prove boundary tests fail for invalid patterns.
- Generated: No
- Committed: Yes

**`.planning/research`:**
- Purpose: Research and planning context for stack, architecture, features, and pitfalls.
- Generated: Yes
- Committed: Repository planning artifacts.

**`.planning/phases`:**
- Purpose: GSD phase plans and execution artifacts.
- Generated: Yes
- Committed: Repository planning artifacts.

**`.planning/codebase`:**
- Purpose: Codebase mapping documents consumed by GSD planning/execution commands.
- Generated: Yes
- Committed: Repository planning artifacts.

---

*Structure analysis: 2026-05-23*
