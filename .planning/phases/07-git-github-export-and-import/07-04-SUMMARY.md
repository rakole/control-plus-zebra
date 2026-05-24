---
phase: 07-git-github-export-and-import
plan: 04
subsystem: archive-import
tags: [archive, import, source-registry, ipc, preload, renderer]
requires:
  - phase: 07-02
    provides: cached GitHub snapshot seams and repo-aware triage surfaces
  - phase: 07-03
    provides: manifest-backed archive format and export entrypoints
provides:
  - Persistent read-only imported archive sources through the normal registry and cache seams
  - Bundled `archive-reader` adapter proving harness-neutral archive handling
  - Typed import bridge plus truthful imported-source rendering in Data Sources and Sessions
affects: [phase-07, archive, import, data-sources, sessions]
key-files:
  created:
    - src/main/adapters/archive-reader/{index.ts,descriptor.ts,discovery.ts,normalize.ts}
    - src/main/app/archive-import-service.ts
    - src/main/core/archive/{archive-importer.ts,archive-reader-shared.ts}
    - tests/main/core/archive-importer.test.ts
  modified:
    - src/main/app/data-sources-view-model-service.ts
    - src/main/core/archive/archive-manifest.ts
    - src/main/core/cache/file-backed-cache-store.ts
    - src/main/core/registry/{register-bundled-adapters.ts,source-registry.ts,source-registry-store.ts}
    - src/main/electron-main.ts
    - src/main/ipc/{channels.ts,handlers.ts,view-models.ts}
    - src/preload/{index.ts,types.ts}
    - src/renderer/{components/DataSourceDetail.tsx,components/DataSourceList.tsx,data-sources-bridge.ts,routes/DataSourcesRoute.tsx}
    - tests/main/{core/source-registry.test.ts,ipc/data-sources-ipc.test.ts,ipc/data-sources-view-model-service.test.ts,ipc/ipc-handlers.test.ts,ipc/session-view-model-service.test.ts}
    - tests/preload/preload-api-surface.test.ts
    - tests/renderer/{data-sources-route.test.tsx,triage-test-helpers.ts}
requirements-completed: [GIT-05]
completed: 2026-05-24
status: complete
---

# Phase 7 Plan 04: Archive Import Summary

Archive export now has a truthful return path. Imported archives register as persistent read-only sources through the same source registry, cache, IPC, preload, and renderer seams as live sources, while every post-import live operation stays explicitly unavailable.

## Verification

- `npm run test -- --project node tests/main/core/archive-importer.test.ts tests/main/core/source-registry.test.ts tests/main/ipc/data-sources-view-model-service.test.ts tests/main/ipc/data-sources-ipc.test.ts tests/main/ipc/session-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/data-sources-route.test.tsx tests/renderer/sessions-route.test.tsx` - passed
- `npm run typecheck` - passed
- `npm run test:boundaries` - passed

## Task Commits

1. **Task 1: Register imported archives as read-only sources through the normal runtime and Data Sources seams** - not committed in this execution

## Decisions Made

- Archive import is main-owned end to end: the renderer asks to open an archive, while manifest validation, source registration, ID rebinding, and cache hydration stay in the main process.
- Imported archives are modeled as explicit persistent sources with `sourceKind: imported-archive`, `addedBy: import`, archive metadata, and read-only capability state instead of a temporary preview mode or a hidden local-root variant.
- A bundled `archive-reader` adapter keeps imported sessions inside the existing adapter and source seams, while imported sources remain permanently unable to validate, scan, watch, or query host-side git or GitHub state.

## Deviations from Plan

None - plan executed exactly as written.

## Next

Phase 7 now has a full read-only export/import loop. The next major step is Phase 8 hardening, packaging, and readiness verification.

---
*Phase: 07-git-github-export-and-import*
*Completed: 2026-05-24*
