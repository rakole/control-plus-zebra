---
phase: 07-git-github-export-and-import
plan: 02
subsystem: github-snapshot
tags: [github, gh, scanner, cache, renderer]
requires:
  - phase: 07-01
    provides: validated git snapshots and shared project cache seam
provides:
  - Shared read-only GitHub snapshot collection gated by validated git context
  - Cached project GitHub state for Projects and Run Audit
  - Explicit No Matching PR, Unknown, and Unsupported GitHub truth states
affects: [phase-07, github, run-audit, projects]
key-files:
  created:
    - src/main/core/github/github-snapshot-provider.ts
    - tests/main/core/github-snapshot-provider.test.ts
  modified:
    - src/main/core/{cache/file-backed-cache-store.ts,ingestion/scanner.ts}
    - src/main/app/{triage-view-model-service.ts,run-audit-view-model-service.ts}
    - src/main/ipc/view-models.ts
    - src/renderer/routes/ProjectsRoute.tsx
    - tests/main/{ipc/triage-view-model-service.test.ts,ipc/run-audit-view-model-service.test.ts,ipc/ipc-handlers.test.ts,ipc/triage-test-runtime.ts}
    - tests/renderer/{projects-route.test.tsx,run-audit-route.test.tsx,triage-test-helpers.ts}
requirements-completed: [GIT-03]
completed: 2026-05-24
status: complete
---

# Phase 7 Plan 02: GitHub Snapshot Summary

Projects and Run Audit now layer optional shared GitHub context over the validated git snapshot seam. The app can surface PR, checks, and review or merge summary when available, while missing `gh`, auth gaps, and no-match branches stay explicit instead of blocking the broader triage UI.

## Verification

- `npm run test -- --project node tests/main/core/github-snapshot-provider.test.ts tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/run-audit-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx` - passed
- `npm run typecheck` - passed
- `npm run test:boundaries` - passed

## Task Commits

1. **Task 1: Add shared GitHub snapshots and truthful PR summary rendering** - `69f4a36` (`feat(07-02): add shared github snapshots`)

## Decisions Made

- GitHub snapshot collection stays hard-gated behind the shared validated git snapshot plus remote URL instead of inventing repo lookups from renderer state or raw session text.
- `No Matching PR` is modeled as a neutral first-class state, separate from Unknown and Unsupported, and propagated consistently through Projects and Run Audit.
- The service-test runtime injects a fake `gh` runner so no-match PR behavior stays deterministic without relying on local GitHub authentication.

## Deviations from Plan

None - plan executed exactly as written.

## Next

Plan `07-03` can now attach export entrypoints to repo-aware Projects and Run Audit surfaces, and `07-04` can later import archived GitHub snapshot data without re-querying the network.

---
*Phase: 07-git-github-export-and-import*
*Completed: 2026-05-24*
