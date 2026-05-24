---
phase: 07-git-github-export-and-import
plan: 01
subsystem: git-snapshot
tags: [git, scanner, cache, ipc, renderer]
requires:
  - phase: 06-05
    provides: cross-route truth-state coverage and triage DTO patterns
provides:
  - Shared root-confidence gating and read-only git snapshot collection
  - Project-scoped git snapshot persistence in the derived cache
  - Projects and Run Audit repo-truth surfaces backed by shared git state
affects: [phase-07, git, run-audit, projects]
key-files:
  created:
    - src/main/core/git/root-confidence.ts
    - src/main/core/git/git-snapshot-provider.ts
    - tests/main/core/git-snapshot-provider.test.ts
  modified:
    - src/main/core/{cache/file-backed-cache-store.ts,ingestion/scanner.ts}
    - src/main/app/{triage-view-model-service.ts,run-audit-view-model-service.ts}
    - src/main/ipc/view-models.ts
    - src/renderer/routes/{ProjectsRoute.tsx,RunAuditRoute.tsx}
    - tests/main/{core/scanner-cache.test.ts,ipc/triage-view-model-service.test.ts,ipc/run-audit-view-model-service.test.ts,ipc/ipc-handlers.test.ts,ipc/triage-test-runtime.ts}
    - tests/renderer/{projects-route.test.tsx,run-audit-route.test.tsx,triage-test-helpers.ts}
requirements-completed: [GIT-01, GIT-02]
completed: 2026-05-24
status: complete
---

# Phase 7 Plan 01: Git Snapshot Foundation Summary

Shared root-confidence gating now drives read-only git snapshots from scan time through Projects and Run Audit. Validated repositories surface real branch, HEAD, dirty-state, count, and remote URL data, while unsafe or missing roots stay explicitly Unknown or Unsupported instead of collapsing into clean-looking placeholders.

## Verification

- `npm run test -- --project node tests/main/core/git-snapshot-provider.test.ts tests/main/core/scanner-cache.test.ts tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/run-audit-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx` - passed
- `npm run typecheck` - passed
- `npm run test:boundaries` - passed

## Task Commits

1. **Task 1: Add shared git snapshots and replace placeholder repo truth in Projects and Run Audit** - `2ef72ac` (`feat(07-01): add shared git snapshots`)

## Decisions Made

- Root-confidence defaults to `observed` when a project root path exists, but `inferred` and `unknown` inputs hard-stop before any git command runs.
- Project git truth is derived once during scanning and stored in the derived cache so Projects and Run Audit consume the same validated snapshot.
- Remote URL is treated as a field-level unknown when missing or timed out without discarding the rest of an otherwise valid git snapshot.

## Deviations from Plan

None - plan executed exactly as written.

## Next

Phase 7 can now build `07-02` GitHub snapshots and `07-03` archive export on top of the shared project-scoped git snapshot seam and its explicit Unknown or Unsupported degradation rules.

---
*Phase: 07-git-github-export-and-import*
*Completed: 2026-05-24*
