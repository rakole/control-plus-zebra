---
phase: 06-harness-neutral-triage-ui
plan: 02
subsystem: session-detail
tags: [session-detail, timeline, chronology, sanitization]
requires:
  - phase: 06-01
    provides: triage routing, shared session truth DTOs, and bridge plumbing
provides:
  - Dedicated Session Detail route with summary rail and mixed timeline
  - Sanitized timeline cards for message, lifecycle, tool, shell, file, artifact, and unknown evidence markers
affects: [phase-06, session-detail, timeline-components]
key-files:
  created:
    - src/main/app/session-detail-view-model-service.ts
    - src/renderer/routes/SessionDetailRoute.tsx
    - src/renderer/components/triage/{SessionDetailSummaryRail.tsx,SessionTimeline.tsx,TimelineEventCard.tsx}
  modified:
    - src/main/ipc/{channels,handlers,view-models}.ts
    - src/preload/{index,types}.ts
    - src/renderer/styles.css
    - tests/main/ipc/session-detail-view-model-service.test.ts
    - tests/renderer/session-detail-route.test.tsx
requirements-completed: [UI-04]
completed: 2026-05-24
status: complete
---

# Phase 6 Plan 02: Session Detail Summary

Session Detail is now a distinct route that owns chronology. It leads with harness/project/IDs/lifecycle/verification/audit context in a summary rail, then renders the normalized event stream as a safe mixed timeline instead of burying chronology inside the Sessions queue.

## Verification

- `npm run test -- --project node tests/main/ipc/session-detail-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/session-detail-route.test.tsx` - passed
- `npm run typecheck` - passed

## Next

Plan `06-03` can now keep judgment separate by building Run Audit as grouped claim-vs-evidence sections over the same session truth.

---
*Phase: 06-harness-neutral-triage-ui*
*Completed: 2026-05-24*
