---
phase: 01-architecture-contracts-and-fixture-proof
plan: 01
subsystem: infra
tags: [typescript, vitest, zod, adapter-contract, normalized-model]
requires: []
provides:
  - Phase 1 npm and TypeScript workspace baseline
  - Harness-neutral shared model with deterministic IDs
  - Evidence-only adapter lifecycle contract
affects: [fake-adapter, contract-tests, boundary-tests]
tech-stack:
  added: [npm, TypeScript 6.0.3, Vitest 4.1.7, Zod 4.4.3, ESLint 10.4.0, typescript-eslint 8.59.4]
  patterns: [NodeNext ESM baseline, deterministic adapter/source/native IDs, evidence-only adapter normalization]
key-files:
  created:
    - package.json
    - tsconfig.json
    - vitest.config.ts
    - src/main/core/model/entities.ts
    - src/main/core/diagnostics/diagnostic.ts
    - src/main/core/adapter-contract/session-source-adapter.ts
  modified: []
key-decisions:
  - "Use a strict NodeNext TypeScript baseline so later Electron/main-process work can extend the same shared contracts cleanly."
  - "Model capabilities as explicit supported/unsupported/unknown truth states instead of omitting missing features."
  - "Keep adapter normalization outputs limited to evidence, diagnostics, and capabilities so later shared verification and audit phases own conclusions."
patterns-established:
  - "Shared normalized entities always carry adapterId and source-bound entities carry sourceId."
  - "Stable IDs are derived from adapter identity, source identity, and native identity."
  - "Adapters depend on shared contract/model/diagnostics surfaces rather than inventing provider-specific shared types."
requirements-completed: [ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ADPT-07]
duration: 1min
completed: 2026-05-23
---

# Phase 01: Architecture Contracts and Fixture Proof Summary

**TypeScript shared-core foundation with harness-neutral models, deterministic IDs, and an evidence-only adapter lifecycle contract**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-23T12:22:26Z
- **Completed:** 2026-05-23T12:23:05Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments
- Bootstrapped the repo as a Phase 1 npm/TypeScript/Vitest workspace without pulling Electron or renderer scaffolding into scope.
- Defined the shared model nouns, capability truth states, diagnostics, confidence values, and deterministic ID helpers the rest of Phase 1 will build on.
- Published an async-friendly adapter contract that exposes lifecycle seams and normalization result types while keeping verification and run-audit conclusions out of adapter output.

## Task Commits

Each task was committed atomically:

1. **Task 1: Bootstrap the Phase 1 TypeScript and test workspace** - `a091a47` (chore)
2. **Task 2: Define the harness-neutral normalized model and diagnostics surfaces** - `1ae5db7` (feat)
3. **Task 3: Publish the adapter lifecycle contract with evidence-only outputs** - `9baad57` (feat)

## Files Created/Modified
- `package.json` - Phase 1 scripts plus the TypeScript/Vitest/Zod/ESLint dependency baseline
- `tsconfig.json` - Strict NodeNext typecheck settings covering `src/**` and `tests/**`
- `vitest.config.ts` - Node-mode test runner config for the Phase 1 proof suites
- `src/main/core/model/entities.ts` - Shared harness-neutral entities for projects, sessions, messages, tools, shell evidence, artifacts, and file mutations
- `src/main/core/diagnostics/diagnostic.ts` - First-class diagnostic contract and helper for deterministic diagnostic IDs
- `src/main/core/adapter-contract/session-source-adapter.ts` - Harness descriptor and adapter lifecycle seams for validation, discovery, parsing, and normalization

## Decisions Made
- Used plain harness-neutral shared names and left all provider-specific vocabulary out of the shared core.
- Kept capability state structured and mandatory from the first milestone so unsupported and unknown stay explicit.
- Treated verification and run-audit results as out of scope for adapter outputs even though lifecycle/session evidence is modeled here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed a deprecated TypeScript 6 compiler flag**
- **Found during:** Task 1 (Bootstrap the Phase 1 TypeScript and test workspace)
- **Issue:** `esModuleInterop=false` now hard-errors under TypeScript 6 deprecation enforcement, which blocked the baseline typecheck.
- **Fix:** Removed the deprecated flag instead of suppressing the warning so the Phase 1 compiler baseline stays future-compatible.
- **Files modified:** `tsconfig.json`
- **Verification:** `npm run typecheck`
- **Committed in:** `a091a47` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix stayed inside the planned scaffold scope and improved the long-term baseline without changing the milestone surface area.

## Issues Encountered
- The installed `gsd-sdk` in this environment does not expose the `query` subcommands referenced by the workflow wrapper, so execution used the checked-in phase artifacts directly while preserving the same plan order and verification gates.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `01-02` can now implement the fake adapter and registry against a stable shared contract surface.
- Lint rules and boundary enforcement are intentionally deferred to `01-04`; the `lint` script exists but its config is not expected to pass until that plan lands.

## Self-Check: PASSED

---
*Phase: 01-architecture-contracts-and-fixture-proof*
*Completed: 2026-05-23*
