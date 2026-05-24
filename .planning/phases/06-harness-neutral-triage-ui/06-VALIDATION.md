---
phase: 06
slug: harness-neutral-triage-ui
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-24
---

# Phase 06 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest with `node` and `renderer` projects |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -- --project renderer tests/renderer/sessions-route.test.tsx && npm run test -- --project node tests/main/ipc/session-view-model-service.test.ts && npm run typecheck` |
| **Full suite command** | `npm run lint && npm run typecheck && npm run test && npm run test:boundaries` |
| **Estimated runtime** | ~75 seconds |

---

## Sampling Rate

- **After every task commit:** Run the smallest affected service or route command plus `npm run typecheck`
- **After every plan wave:** Run `npm run test -- --project renderer tests/renderer` and `npm run test -- --project node tests/main/ipc`, then `npm run test:boundaries`
- **Before `$gsd-verify-work`:** `npm run lint && npm run typecheck && npm run test && npm run test:boundaries` must be green
- **Max feedback latency:** 75 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | UI-01, UI-02, UI-03, UI-08, UI-09 | T-06-01-01, T-06-01-02, T-06-01-03 | Overview, Projects, and Sessions consume main-owned typed DTOs, keep routes adapter-neutral, and render unsupported/unknown states explicitly. | node + renderer | `npm run test -- --project node tests/main/ipc/triage-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/overview-route.test.tsx tests/renderer/projects-route.test.tsx tests/renderer/sessions-route.test.tsx` | `src/main/app/triage-view-model-service.ts` | green |
| 06-02-01 | 02 | 2 | UI-04, UI-08, UI-09 | T-06-02-01, T-06-02-02, T-06-02-03 | Session Detail renders a sanitized summary rail and chronological mixed timeline without leaking raw artifacts or provider-specific logic. | node + renderer | `npm run test -- --project node tests/main/ipc/session-detail-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/session-detail-route.test.tsx` | `src/main/app/session-detail-view-model-service.ts` | green |
| 06-03-01 | 03 | 2 | UI-05, UI-08, UI-09 | T-06-03-01, T-06-03-02, T-06-03-03 | Run Audit groups shared derived truth into claim-vs-evidence sections, keeps Phase 7 git/GitHub placeholders explicit, and never recomputes audit logic in renderer code. | node + renderer | `npm run test -- --project node tests/main/ipc/run-audit-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/run-audit-route.test.tsx` | `src/main/app/run-audit-view-model-service.ts` | green |
| 06-04-01 | 04 | 2 | UI-07, UI-08, UI-09 | T-06-04-01, T-06-04-02, T-06-04-03 | Diagnostics groups source-area and capability warnings through sanitized DTOs and shared truth-state presentation primitives. | node + renderer | `npm run test -- --project node tests/main/ipc/diagnostics-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/diagnostics-route.test.tsx` | `src/main/app/diagnostics-view-model-service.ts` | green |
| 06-05-01 | 05 | 3 | TEST-07, UI-08, UI-09 | T-06-05-01, T-06-05-02, T-06-05-03 | Cross-route truth-state tests and boundary tests prove unsupported/unknown states never render as zero/passed/clean and shared code stays harness-neutral. | renderer + boundaries | `npm run test -- --project renderer tests/renderer/triage-truth-states.test.tsx && npm run test:boundaries && npm run typecheck` | `tests/renderer/triage-truth-states.test.tsx` | green |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [x] `tests/main/ipc/triage-view-model-service.test.ts` exists for Overview and Projects rollups
- [x] `tests/main/ipc/session-detail-view-model-service.test.ts` exists for timeline sanitization
- [x] `tests/main/ipc/run-audit-view-model-service.test.ts` exists for grouped evidence DTOs
- [x] `tests/main/ipc/diagnostics-view-model-service.test.ts` exists for grouped diagnostics DTOs
- [x] `tests/renderer/overview-route.test.tsx`, `tests/renderer/projects-route.test.tsx`, `tests/renderer/session-detail-route.test.tsx`, `tests/renderer/run-audit-route.test.tsx`, `tests/renderer/diagnostics-route.test.tsx`, and `tests/renderer/triage-truth-states.test.tsx` exist

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dense split-pane triage layouts remain usable at the app's minimum window size | UI-01 through UI-07 | Renderer tests can assert DOM states, but not final readability in the packaged shell | Launch the app, resize to the current minimum window, and confirm Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics remain navigable without hidden critical controls |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or explicit Wave 0 prerequisites
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing infrastructure references
- [x] No watch-mode flags
- [x] Feedback latency under 75 seconds
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** execution complete
