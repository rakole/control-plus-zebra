# Phase 1: Architecture Contracts and Fixture Proof - Research

**Researched:** 2026-05-23
**Status:** Ready for planning

## Executive Summary

Phase 1 should stay intentionally narrow: bootstrap only the TypeScript shared-core and test workspace needed to prove harness neutrality, then use one non-Gemini fake adapter fixture plus executable guardrails to lock that architecture in place. Electron shell, preload bridge, renderer pages, and real Gemini parsing all belong to later phases and should not leak into this milestone.

The highest-value implementation order is:

1. Create the Phase 1 Node/TypeScript/Vitest/ESLint workspace foundation without scaffolding Electron yet.
2. Define the shared normalized model, diagnostics, capability schema, deterministic ID helpers, and adapter contract lifecycle seams.
3. Implement a fake adapter and stable fixture that proves the contract end to end through the shared registry.
4. Add contract, golden, naming, and import-boundary tests that fail loudly when Gemini-specific or adapter-private coupling leaks into shared code.

## What Phase 1 Must Prove

### Proof obligations from roadmap and requirements

- Shared core exports harness-neutral nouns only: `Harness`, `Project`, `Session`, `SessionEvent`, `SessionMessage`, `ToolCall`, `OutputArtifact`, `ShellCommandEvidence`, diagnostics, capabilities, IDs, and confidence.
- Every normalized entity derived from harness data carries `adapterId` and, where relevant, `sourceId`.
- Adapter APIs preserve the lifecycle seams already locked in context: `validateSourceRoot`, `discoverSources`, `discoverArtifacts`, `parseArtifact`, and `normalize`.
- The fake adapter uses a raw shape that is clearly not Gemini-shaped, but still produces a realistic normalized proof artifact.
- Adapters emit evidence and diagnostics only; they cannot set verification states, run-audit classifications, or attention reasons.
- Import and naming guardrails are executable, not just written into docs.

### Scope fences

- Do not scaffold Electron main/preload/renderer in this phase. Phase 2 owns that shell.
- Do not introduce real source watching, cache persistence, or git/GitHub providers yet.
- Do not create shared `Gemini*` types, `gemini:*` IPC names, or renderer behavior keyed on Gemini specifics.
- Do not turn MVP mode into a generic app walking skeleton here. The locked roadmap goal is an architecture proof, not an end-to-end UI app slice.

## Recommended Implementation Shape

### 1. Bootstrap only the Phase 1 engineering workspace

Use npm with TypeScript 6, Vitest 4, Zod 4, and ESLint 10 so the team can build and verify the contract proof without paying the Electron/Forge setup cost yet. The workspace should establish:

- `package.json` scripts for `typecheck`, `test`, `test:boundaries`, and `lint`
- `tsconfig.json` and `vitest.config.ts` aligned to `src/**` and `tests/**`
- a `src/main/core/**` tree for shared model/contract code
- a `src/main/adapters/fake-test/**` tree for the proof adapter
- a `tests/**` tree split by contract, adapter, and boundary concerns

This keeps Phase 1 fast to execute while leaving a clean path for Electron scaffold work in Phase 2.

### 2. Model the full shared nouns now

The context decisions already locked the real normalized nouns, so Phase 1 should define them instead of placeholder aliases. The recommended shared surfaces are:

- `src/main/core/model/identifiers.ts` for deterministic adapter/source/native identity helpers
- `src/main/core/model/confidence.ts` for confidence semantics
- `src/main/core/model/capabilities.ts` for adapter/source/session capability truth states
- `src/main/core/model/entities.ts` for projects, sessions, events, messages, tool calls, shell evidence, output artifacts, and file mutations
- `src/main/core/diagnostics/diagnostic.ts` for first-class diagnostics
- `src/main/core/adapter-contract/**` for the adapter descriptor and lifecycle contract

Keep verification, run-audit, and attention-reason types out of these shared Phase 1 surfaces. Those belong to later shared-core phases.

### 3. Keep the fake adapter obviously non-Gemini-shaped

The fake fixture should look like its own tiny harness, not a Gemini imitation. A good Phase 1 proof path is:

- a small JSON fixture such as `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`
- a raw artifact descriptor that points at that file
- adapter parsing that turns the fixture into adapter-private raw events
- normalization that emits shared projects, sessions, events, messages, tool calls, shell evidence, output artifact refs, diagnostics, and capabilities

The key is not fixture breadth; it is a stable, repeatable proof that the registry and shared contract do not need Gemini assumptions.

### 4. Make import and naming rules executable from day one

Phase 1 should not rely on future reviewer discipline for architecture boundaries. Add both:

- boundary tests that fail when `src/main/core/**` or `src/renderer/**` imports adapter-private code, or when one adapter imports a sibling adapter
- naming guards that fail if shared code introduces `Gemini*` type names or Gemini-shaped shared runtime symbols

Because the repo has no renderer implementation yet, boundary tests should include synthetic violation fixtures so the check itself is proven before Phase 2 adds real renderer files.

## Recommended Plan Split

| Plan | Wave | Why it exists |
|------|------|----------------|
| `01-01` | 1 | Establish the TypeScript/Vitest workspace plus the shared model, diagnostics, ID, capability, and adapter-contract surfaces. |
| `01-02` | 2 | Build the fake adapter, fake fixture, and registry wiring on top of the shared contract from `01-01`. |
| `01-03` | 3 | Add reusable contract and golden tests once the fake adapter path exists. |
| `01-04` | 3 | Add boundary and naming enforcement once the shared and adapter folder structure is real. |

### Dependency rationale

- `01-02` depends on `01-01` because the fake adapter needs the final shared contract/model shapes.
- `01-03` depends on `01-02` because the tests need a real adapter and fixture to exercise.
- `01-04` depends on `01-02` because boundary tests are more meaningful once adapter-private folders exist.
- `01-03` and `01-04` can run in parallel if `01-01` owns the baseline package scripts/config and each plan stays inside its declared files.

## Validation Architecture

### Test infrastructure for this phase

- **Framework:** Vitest in Node mode
- **Type safety gate:** `npm run typecheck`
- **Boundary gate:** `npm run test:boundaries`
- **Contract/golden gate:** `npm run test -- tests/contract tests/adapters/fake-test`
- **Full Phase 1 verification:** `npm run lint && npm run typecheck && npm run test`

### What must be validated

- shared contracts compile and expose the locked lifecycle method names
- normalized entity schemas require `adapterId` and `sourceId` where relevant
- fake adapter descriptor and capabilities pass a shared adapter contract suite
- fake fixture normalization stays stable through a checked-in golden artifact
- unsupported capability states remain explicit, not flattened to numeric zero or clean status
- boundary and naming checks fail on synthetic violations as well as real code

### Fast feedback strategy

- During `01-01` and `01-02`, use `npm run typecheck` after each task-level slice.
- During `01-03`, use targeted Vitest runs against the contract and fake-adapter suites before full `npm run test`.
- During `01-04`, use targeted boundary runs before `npm run lint`.
- Before declaring the phase execution-ready, the repo should pass `npm run lint && npm run typecheck && npm run test`.

## Security and Truth Guardrails

- Treat adapter output as untrusted local evidence; validate it before shared-core merge.
- Use deterministic adapter/source/native-based IDs to avoid cross-harness collisions and spoofing.
- Keep Phase 1 read-only with respect to external systems: no shell execution surfaces, no GitHub mutations, and no renderer filesystem access.
- Ensure the fake adapter fixture includes shell evidence only as normalized evidence, not as interpreted verification truth.

## Risks to Watch During Execution

### Risk 1: accidental Electron scope creep

If the executor starts scaffolding Electron Forge, preload APIs, or renderer routes in Phase 1, stop and move that work back to Phase 2. Phase 1 should remain contract-proof-only.

### Risk 2: fake adapter turns into a Gemini surrogate

If the fixture starts using `.project_root`, JSONL chat rows, sidecar naming, or other Gemini-specific shapes, the proof is no longer demonstrating neutrality. Keep the raw format intentionally different.

### Risk 3: guardrails become doc-only

If import boundaries or Gemini naming rules are merely comments or README notes, the phase has not actually prevented regression. They must execute in CI-friendly commands.

## Planning Assumptions

- npm is the package manager for the first implementation slice unless the user changes that direction later.
- Phase 1 can create the base `package-lock.json` because the repo is currently pre-implementation and git-clean.
- Generic GSD walking-skeleton behavior is treated as non-applicable here because it would conflict with the locked roadmap scope for Phase 1.

---
*Research completed: 2026-05-23*
*Ready for planning: yes*
