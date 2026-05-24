---
phase: 06-harness-neutral-triage-ui
plan: 01
subsystem: triage-foundation
tags: [overview, projects, sessions, ipc, preload]
requires: []
provides:
  - Main-owned overview and project rollups over normalized plus derived cache data
  - Real Overview and Projects routes with `/overview` as the landing page
  - Richer Sessions summaries with verification, audit, project, and capability truth
affects: [phase-06, renderer-shell, triage-dtos, preload-surface]
tech-stack:
  added: []
  patterns:
    - Triage pages consume dedicated bridge methods and strict DTOs instead of renderer-side recomputation
    - Phase 7 git and GitHub fields stay explicit Unknown placeholders in Phase 6
key-files:
  created:
    - src/main/app/triage-view-model-service.ts
    - src/renderer/routes/OverviewRoute.tsx
    - src/renderer/routes/ProjectsRoute.tsx
  modified:
    - src/main/app/session-view-model-service.ts
    - src/main/ipc/{channels,handlers,view-models}.ts
    - src/preload/{index,types}.ts
    - src/renderer/{App.tsx,components/AppShell.tsx,routes/SessionsRoute.tsx,components/SessionList.tsx,components/SessionPreview.tsx,styles.css}
    - tests/main/ipc/triage-view-model-service.test.ts
    - tests/renderer/{overview-route.test.tsx,projects-route.test.tsx,sessions-route.test.tsx}
requirements-completed: [UI-01, UI-02, UI-03]
completed: 2026-05-24
status: complete
---

# Phase 6 Plan 01: Triage Foundation Summary

Overview, Projects, and Sessions now run on main-owned triage DTOs with explicit verification, run-audit, and capability-gap states. The app shell lands on `/overview`, real nav routes replaced the placeholder items, and Sessions stayed the fast triage queue instead of absorbing detail or audit scope.

## Verification

- `npm run test -- --project node tests/main/ipc/triage-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/overview-route.test.tsx tests/renderer/projects-route.test.tsx tests/renderer/sessions-route.test.tsx` - passed
- `npm run typecheck` - passed

## Next

Plan `06-02` can build the dedicated Session Detail chronology route on top of the shared DTO, IPC, and navigation foundation landed here.

---
*Phase: 06-harness-neutral-triage-ui*
*Completed: 2026-05-24*
