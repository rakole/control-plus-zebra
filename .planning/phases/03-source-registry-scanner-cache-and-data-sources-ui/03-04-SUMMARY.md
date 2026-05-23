---
phase: 03-source-registry-scanner-cache-and-data-sources-ui
plan: 04
subsystem: watcher
tags: [watcher, boundaries, capabilities, adapters]
requires:
  - phase: 03-02
    provides: safe adapter context surface and shared adapter contract extensions
provides:
  - Shared watch-plan contract and orchestrator ownership boundary
  - Explicit supported, unsupported, and unknown watch truth states
  - Adapter capability metadata for watch support without live watcher controls
affects: [phase-03, data-sources, guardrails, future-watchers]
tech-stack:
  added: []
  patterns:
    - Adapters may describe watch metadata but shared core owns lifecycle orchestration
    - Watch support truth remains explicit without implying activity, cleanliness, or auto-start
key-files:
  created:
    - src/main/core/watcher/watch-plan.ts
    - src/main/core/watcher/watch-orchestrator.ts
    - src/main/core/watcher/index.ts
    - tests/main/core/watch-orchestrator.test.ts
  modified:
    - src/main/core/adapter-contract/session-source-adapter.ts
    - src/main/core/adapter-contract/types.ts
    - src/main/adapters/fake-test/descriptor.ts
    - tests/boundaries/import-boundaries.test.ts
key-decisions:
  - "Watch support remains metadata and orchestration proof only in Phase 3; no live controls were added."
  - "Fallback watch plans preserve unsupported and unknown capability truth rather than treating missing support as zero."
patterns-established:
  - "Adapters may implement getWatchPlan while lifecycle authority stays in WatchOrchestrator."
  - "Boundary tests protect against adapter-owned watcher lifecycle drift."
requirements-completed: [DATA-07]
duration: retroactive-validation
completed: 2026-05-23
status: complete
---

# Phase 3 Plan 04: Watch Orchestrator Boundary Summary

**Shared watch-plan metadata and orchestrator boundaries without exposing live watcher controls.**

## Performance

- **Duration:** Retroactive validation of existing implementation
- **Started:** Not recorded; implementation pre-existed this closeout pass
- **Completed:** 2026-05-23T17:26:25Z
- **Tasks:** 1
- **Files modified:** 8

## Accomplishments

- Added watch-plan types and a shared `WatchOrchestrator` that resolves adapter watch metadata centrally.
- Extended the adapter contract so watch support can be reported without giving adapters watcher lifecycle authority.
- Added tests and boundary checks that keep unsupported and unknown watch states explicit and block watcher drift into adapter-private code.

## Task Commits

No atomic execution commits were available in git history for `03-04`. The implementation was validated from the existing working tree and passing tests during this summary pass.

## Files Created/Modified

- `src/main/core/watcher/watch-plan.ts` - shared watch-plan and support truth contract
- `src/main/core/watcher/watch-orchestrator.ts` - central watch-plan resolution and fallback handling
- `src/main/core/adapter-contract/session-source-adapter.ts` - optional `getWatchPlan` seam
- `src/main/adapters/fake-test/descriptor.ts` - fake adapter capability metadata now includes parser/watch plan support
- `tests/main/core/watch-orchestrator.test.ts` - orchestrator behavior proof
- `tests/boundaries/import-boundaries.test.ts` - guardrail against adapter-owned watcher lifecycle imports

## Decisions Made

- Kept Phase 3 to support-truth exposure only; start/stop watcher controls remain explicitly deferred.
- Used shared fallback plans so missing adapter watch implementations still yield honest capability states.

## Deviations from Plan

None. This closeout pass only validated the existing implementation and wrote the missing summary document.

## Issues Encountered

Phase 3 implementation existed without `03-04-SUMMARY.md` or matching execution commits, so this summary is reconstructed from the plan, working tree, and passing verification.

## Verification

- `npm test -- tests/main/core/source-registry.test.ts tests/main/core/safe-filesystem.test.ts tests/main/core/scanner-cache.test.ts tests/main/core/watch-orchestrator.test.ts tests/main/core/file-backed-cache-store.test.ts tests/main/core/cache-keys.test.ts tests/main/ipc/data-sources-ipc.test.ts tests/main/ipc/data-sources-view-model-service.test.ts tests/preload/preload-api-surface.test.ts` - passed
- `npm run test:boundaries` - passed
- `npm run typecheck` - passed
- `npm test` - passed, 24 files / 69 tests
- `npm run lint` - passed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Data Sources UI and future watch-capable adapters can now consume a shared watch-support contract without introducing live watcher scope into Phase 3.

## Self-Check: PASSED

- Required watcher files exist on disk.
- Focused and full verification passed against the current implementation.

---
*Phase: 03-source-registry-scanner-cache-and-data-sources-ui*
*Completed: 2026-05-23*
