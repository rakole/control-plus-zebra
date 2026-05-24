---
phase: 06-harness-neutral-triage-ui
plan: 03
subsystem: run-audit-surface
tags: [run-audit, evidence-groups, placeholders]
requires:
  - phase: 06-01
    provides: triage foundation and session truth DTOs
provides:
  - Dedicated Run Audit route with product-facing grouped evidence sections
  - Explicit Phase 7 git and GitHub placeholders that never infer repo truth from session evidence
affects: [phase-06, run-audit, evidence-review]
key-files:
  created:
    - src/main/app/run-audit-view-model-service.ts
    - src/renderer/routes/RunAuditRoute.tsx
  modified:
    - src/main/ipc/{channels,handlers,view-models}.ts
    - src/preload/{index,types}.ts
    - src/renderer/styles.css
    - tests/main/ipc/run-audit-view-model-service.test.ts
    - tests/renderer/run-audit-route.test.tsx
requirements-completed: [UI-05]
completed: 2026-05-24
status: complete
---

# Phase 6 Plan 03: Run Audit Summary

Run Audit now has its own route and grouped evidence model. Claim-vs-evidence, verification, files changed, commands, cancellation/incompletion, git or GitHub placeholders, capability gaps, and parser diagnostics are sectioned for triage instead of replayed as one long feed.

## Verification

- `npm run test -- --project node tests/main/ipc/run-audit-view-model-service.test.ts` - passed
- `npm run test -- --project renderer tests/renderer/run-audit-route.test.tsx` - passed
- `npm run typecheck` - passed

## Next

Plan `06-04` can centralize diagnostics and shared truth-state presentation across all triage pages.

---
*Phase: 06-harness-neutral-triage-ui*
*Completed: 2026-05-24*
