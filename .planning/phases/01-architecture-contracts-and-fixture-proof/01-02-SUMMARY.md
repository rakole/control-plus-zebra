---
phase: 01-architecture-contracts-and-fixture-proof
plan: 02
subsystem: infra
tags: [fake-adapter, adapter-registry, zod, vitest, normalization]
requires:
  - phase: 01-01
    provides: shared harness-neutral model, deterministic ID helpers, and the evidence-only adapter contract
provides:
  - Bundled `fake-test` adapter descriptor and discovery surfaces
  - Non-Gemini phase fixture that normalizes through the shared contract
  - Composition-root registry wiring and a smoke proof through the adapter lifecycle
affects: [contract-tests, boundary-tests, phase-2-view-models]
tech-stack:
  added: []
  patterns: [composition-root adapter registration, deterministic adapter/source/native IDs, parse-diagnostic fallback for malformed fixtures]
key-files:
  created:
    - src/main/adapters/fake-test/descriptor.ts
    - src/main/adapters/fake-test/normalize.ts
    - src/main/core/registry/register-bundled-adapters.ts
    - tests/adapters/fake-test/fake-adapter.smoke.test.ts
  modified: []
key-decisions:
  - "Keep the fake raw fixture visibly non-Gemini-shaped while still exercising messages, tool calls, shell evidence, artifacts, and file mutations."
  - "Register bundled adapters only from the composition-root registry surfaces so shared model and diagnostics code stay adapter-private-import free."
  - "Convert malformed fake fixtures into adapter diagnostics and empty normalized slices instead of silently coercing data or inferring success."
patterns-established:
  - "Bundled adapters plug into shared core through descriptor registration, not shared-core provider branches."
  - "Normalized fake-test entities derive IDs from adapter identity, source identity, and native fixture identity."
requirements-completed: [ARCH-01, ADPT-01, ADPT-02, ADPT-07]
duration: 5min
completed: 2026-05-23
---

# Phase 1 Plan 02: Architecture Contracts and Fixture Proof Summary

**Bundled fake-test adapter registry proof with deterministic normalization, parse diagnostics, and a non-Gemini fixture**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-23T12:30:06Z
- **Completed:** 2026-05-23T12:35:06Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- Added the `fake-test` descriptor, explicit capabilities, fixture discovery helpers, and a representative non-Gemini raw harness fixture.
- Implemented fake fixture parsing and normalization into shared project, session, event, message, tool, shell, artifact, file-mutation, diagnostic, and capability envelopes with deterministic IDs.
- Wired the bundled adapter registry through a composition root and proved the full fake adapter lifecycle with a Vitest smoke test.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the fake adapter descriptor, raw fixture, and discovery surfaces** - `0807cef` (feat)
2. **Task 2: Implement parse and normalize flow with deterministic IDs** - `56fe72c` (feat)
3. **Task 3: Register the fake adapter and add one end-to-end smoke proof** - `5b1d662` (feat)

## Files Created/Modified
- `src/main/adapters/fake-test/descriptor.ts` - Fake adapter metadata and explicit harness capability truth states.
- `src/main/adapters/fake-test/discovery.ts` - Source validation plus single-fixture source/artifact discovery.
- `src/main/adapters/fake-test/parse.ts` - Fixture parsing into adapter-private raw events and parse-diagnostic events.
- `src/main/adapters/fake-test/normalize.ts` - Shared-model normalization with deterministic IDs, source-bound evidence, and capability envelopes.
- `src/main/core/registry/register-bundled-adapters.ts` - Explicit composition-root registration for bundled adapters.
- `tests/adapters/fake-test/fake-adapter.smoke.test.ts` - End-to-end registry smoke proof through validation, discovery, parse, and normalize.

## Decisions Made
- Used a single JSON fixture file as the fake harness source root so the proof stays deterministic and obviously distinct from Gemini log shapes.
- Kept verification truth out of adapter output even when shell evidence is present; the adapter only emits evidence, diagnostics, and capability state.
- Added a parse-diagnostic path for read, JSON, and schema failures so malformed fixtures degrade into diagnostics instead of unsafe defaults.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added parse diagnostics for malformed fake fixtures**
- **Found during:** Task 2 (Implement parse and normalize flow with deterministic IDs)
- **Issue:** The initial parse path validated the fixture schema but surfaced malformed or unreadable fixtures as thrown errors, which violated the threat-model requirement to emit diagnostics instead of silently coercing data or crashing the adapter path.
- **Fix:** Added explicit parse-diagnostic raw events for read, JSON, and schema failures, then mapped them into shared diagnostics with empty normalized slices when fixture metadata is unavailable.
- **Files modified:** `src/main/adapters/fake-test/parse.ts`, `src/main/adapters/fake-test/normalize.ts`, `src/main/adapters/fake-test/types.ts`
- **Verification:** `npm run typecheck`, `npm run test -- tests/adapters/fake-test/fake-adapter.smoke.test.ts`
- **Committed in:** `56fe72c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The auto-fix stayed inside the planned fake adapter slice and tightened the phase truth guarantees without expanding scope.

## Issues Encountered
- The in-progress Task 2 code had a wrong shared-type import and `exactOptionalPropertyTypes` mismatches; those were resolved while finishing the planned normalize flow.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `01-03` can now add reusable contract and golden normalization tests against a live fake adapter proof path.
- `01-04` can now enforce adapter/core import and naming boundaries against a real `src/main/adapters/fake-test/**` surface and bundled registry entrypoint.

## Self-Check: PASSED

---
*Phase: 01-architecture-contracts-and-fixture-proof*
*Completed: 2026-05-23*
