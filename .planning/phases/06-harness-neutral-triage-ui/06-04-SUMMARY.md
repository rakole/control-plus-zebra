---
phase: 06-harness-neutral-triage-ui
plan: 04
subsystem: diagnostics-and-shared-truth
tags: [diagnostics, capability-warnings, shared-badges]
requires:
  - phase: 06-01
    provides: triage routes and main-owned rollups
provides:
  - Grouped Diagnostics route over source, normalization, cache, and capability issues
  - Shared truth-state badge and capability-warning presentation across triage pages
affects: [phase-06, diagnostics, shared-ui-primitives]
key-files:
  created:
    - src/main/app/diagnostics-view-model-service.ts
    - src/renderer/routes/DiagnosticsRoute.tsx
    - src/renderer/components/triage/{TruthStateBadge.tsx,CapabilityWarningPanel.tsx,DiagnosticGroup.tsx}
  modified:
    - src/main/ipc/{channels,handlers,view-models}.ts
    - src/preload/{index,types}.ts
    - src/renderer/styles.css
    - tests/main/ipc/diagnostics-view-model-service.test.ts
    - tests/renderer/diagnostics-route.test.tsx
requirements-completed: [UI-07]
completed: 2026-05-24
status: complete
---

# Phase 6 Plan 04: Diagnostics Summary

Diagnostics is now a first-class operator surface instead of scattered warning copy. Source-area and capability problems are grouped through sanitized DTOs, and shared truth-state presentation now keeps Unknown and Unsupported language consistent across Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics.

## Verification

- `npm run test -- --project node tests/main/ipc/diagnostics-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/diagnostics-route.test.tsx` - passed
- `npm run typecheck` - passed

## Next

Plan `06-05` can close the phase with cross-route truth-state regressions and broader renderer or boundary proof.

---
*Phase: 06-harness-neutral-triage-ui*
*Completed: 2026-05-24*
