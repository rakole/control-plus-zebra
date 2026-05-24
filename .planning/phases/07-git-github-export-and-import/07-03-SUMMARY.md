---
phase: 07-git-github-export-and-import
plan: 03
subsystem: archive-export
tags: [archive, export, ipc, preload, renderer, safe-filesystem]
requires:
  - phase: 07-01
    provides: validated git snapshots and shared project cache seam
  - phase: 07-02
    provides: project and run-audit repo context surfaces ready for export entrypoints
provides:
  - Harness-neutral archive export with normalized-only default
  - Raw-artifact export gated by indexed allowlisted reads and privacy acknowledgement
  - Typed main-owned export bridge for Projects and Run Audit
affects: [phase-07, export, projects, run-audit, safe-filesystem]
key-files:
  created:
    - src/main/core/archive/{archive-manifest.ts,archive-exporter.ts}
    - src/main/app/archive-export-service.ts
    - tests/main/core/archive-exporter.test.ts
  modified:
    - src/main/core/security/safe-filesystem.ts
    - src/main/ipc/{channels.ts,handlers.ts,view-models.ts}
    - src/preload/{index.ts,types.ts}
    - src/renderer/routes/{ProjectsRoute.tsx,RunAuditRoute.tsx}
    - tests/main/ipc/{ipc-handlers.test.ts,triage-view-model-service.test.ts,run-audit-view-model-service.test.ts,data-sources-ipc.test.ts}
    - tests/renderer/{projects-route.test.tsx,run-audit-route.test.tsx,triage-test-helpers.ts}
requirements-completed: [GIT-04, GIT-06]
completed: 2026-05-24
status: complete
---

# Phase 7 Plan 03: Archive Export Summary

Projects and Run Audit can now create harness-neutral archives from shared cache and source data without widening the app into a generic file copier. Normalized payloads export by default, raw artifacts stay opt-in behind explicit privacy warning copy, and raw reads are hard-gated to indexed allowlisted artifacts.

## Verification

- `npm run test -- --project node tests/main/core/archive-exporter.test.ts tests/main/core/safe-filesystem.test.ts tests/main/ipc/ipc-handlers.test.ts tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/run-audit-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx` - passed
- `npm run typecheck` - passed
- `npm run test:boundaries` - passed
- `npm run lint` - passed

## Task Commits

1. **Task 1: Add manifest-backed export with privacy warnings and indexed raw-artifact gating** - `a8c5959` (`feat(07-03): add archive export flows`)

## Decisions Made

- Archive export is main-owned end to end: renderer routes submit typed scope and opt-in intent only, while destination selection and archive assembly stay in the main process.
- Raw artifact export now depends on indexed artifact identity, not merely being inside an allowed root, so `readIndexedTextArtifact()` cannot quietly degrade into arbitrary file reads.
- The archive format is a read-only JSON bundle with manifest metadata, archived source metadata, filtered cache records, source diagnostics, and optional raw text artifacts, which keeps 07-04 importable without adding executable payloads or live source bindings.

## Deviations from Plan

None - plan executed exactly as written.

## Next

Plan `07-04` can build import-on-top of the new manifest-backed archive shape and the explicit `archive-reader` source semantics, but Phase 7 remains paused here until import work is intentionally started.

---
*Phase: 07-git-github-export-and-import*
*Completed: 2026-05-24*
