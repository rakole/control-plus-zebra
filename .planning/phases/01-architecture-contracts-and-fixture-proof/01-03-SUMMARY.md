---
phase: 01-architecture-contracts-and-fixture-proof
plan: 03
subsystem: testing
tags: [vitest, contract-tests, fake-adapter, golden-fixture, capability-truth]
requires:
  - phase: 01-02
    provides: bundled fake-test adapter, deterministic normalization flow, and a live fixture path to exercise
provides:
  - Reusable adapter contract harness covering descriptor metadata, lifecycle hooks, diagnostics, normalization shape, and unsupported capability truth states
  - Fake adapter contract, golden, and truth-rule regression suites
  - Checked-in normalized fake-session proof artifact with stable, reviewable IDs
affects: [phase-01-boundary-tests, future-gemini-cli-adapter-tests, phase-05-audit-truth]
tech-stack:
  added: []
  patterns:
    [shared Vitest adapter contract harness, stable golden snapshot rewriting, explicit unsupported and evidence-only truth tests]
key-files:
  created:
    - tests/contract/run-adapter-contract.ts
    - tests/contract/adapter-contract.test.ts
    - tests/adapters/fake-test/fake-adapter.contract.test.ts
    - tests/adapters/fake-test/fake-adapter.golden.test.ts
    - tests/adapters/fake-test/fake-adapter.truth-rules.test.ts
    - tests/fixtures/fake-test/phase1-session.normalized.json
  modified: []
key-decisions:
  - "Prove the shared harness with a stub adapter in tests/contract, then reuse the same assertion layer from the fake adapter entrypoint."
  - "Scrub path-derived hashed IDs into native-ID-backed stable snapshot IDs so the checked-in golden artifact stays cross-machine diffable."
  - "Enforce evidence-only semantics twice: once in the shared contract harness and again in a dedicated truth-rule regression suite."
patterns-established:
  - "Future adapters can add contract coverage by calling runAdapterContractSuite with fixture-specific expectations instead of rewriting assertion logic."
  - "Golden artifacts should preserve normalized relationships while replacing unstable IDs with stable native-ID labels."
  - "Unsupported and unknown capability semantics stay executable through dedicated tests rather than prose-only requirements."
requirements-completed: [TEST-01, TEST-02, ARCH-05, ARCH-06]
duration: 3min
completed: 2026-05-23
---

# Phase 1 Plan 03: Architecture Contracts and Fixture Proof Summary

**Reusable adapter contract harness with fake-adapter golden normalization and truth-rule regressions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-23T12:44:58Z
- **Completed:** 2026-05-23T12:47:29Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Added `runAdapterContractSuite` plus lifecycle helpers that assert descriptor metadata, capability truth states, discovery hooks, diagnostics, normalization shape, and evidence-only output.
- Locked the `fake-test` adapter to that shared harness and to a checked-in normalized JSON golden artifact with stable IDs.
- Added direct truth-rule tests that fail when unsupported capabilities flatten into implicit values or when adapter output grows verification/run-audit conclusion fields.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the reusable adapter contract harness** - `e97bb50` (test)
2. **Task 2: Lock the fake adapter to contract and golden expectations** - `30e1602` (test)
3. **Task 3: Add truth-rule regression tests for unsupported states and evidence-only semantics** - `15e2719` (test)

## Files Created/Modified
- `tests/contract/run-adapter-contract.ts` - Shared contract harness and lifecycle helpers for adapter test suites.
- `tests/contract/adapter-contract.test.ts` - Stub-backed proof that the harness is adapter-agnostic and enforces explicit capability truth states.
- `tests/adapters/fake-test/fake-adapter.contract.test.ts` - Fake adapter entrypoint that runs through the shared contract harness.
- `tests/adapters/fake-test/fake-adapter.golden.test.ts` - Golden regression suite that rewrites unstable IDs into a stable snapshot before diffing.
- `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts` - Truth-rule coverage for unsupported capability semantics and evidence-only adapter output.
- `tests/fixtures/fake-test/phase1-session.normalized.json` - Approved normalized proof artifact for regression review.
- `.planning/phases/01-architecture-contracts-and-fixture-proof/01-03-SUMMARY.md` - Execution summary for this plan slice.

## Decisions Made
- Used a stub adapter in `tests/contract` so the reusable harness is proven independently from the fake adapter fixture path.
- Kept the checked-in golden artifact readable by replacing path-derived hashed IDs with stable native-ID labels instead of snapshotting machine-specific values.
- Treated evidence-only semantics as a contract concern, not just a fake-adapter detail, by forbidding verification and run-audit conclusion keys in shared assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing `expect` import in the harness proof test**
- **Found during:** Task 1 (Build the reusable adapter contract harness)
- **Issue:** The first contract-harness proof run failed because `tests/contract/adapter-contract.test.ts` referenced `expect` inside the custom assertion callback without importing it.
- **Fix:** Added the Vitest `expect` import and removed an unused helper from the proof file.
- **Files modified:** `tests/contract/adapter-contract.test.ts`
- **Verification:** `npm run test -- tests/contract/adapter-contract.test.ts`
- **Committed in:** `e97bb50` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The auto-fix stayed inside the owned test slice and did not expand scope.

## Issues Encountered
None beyond the auto-fixed test import issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `01-04` can add import-boundary and naming enforcement without touching the adapter contract proof slice.
- Future adapters, including `gemini-cli`, can add their own fixture path and expectations by reusing `tests/contract/run-adapter-contract.ts`.
- Shared STATE/ROADMAP close-out remains intentionally deferred to the parent wave coordinator.

## Self-Check: PASSED

---
*Phase: 01-architecture-contracts-and-fixture-proof*
*Completed: 2026-05-23*
