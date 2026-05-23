---
phase: 05-shared-shell-verification-and-run-audit
plan: 03
subsystem: run-audit-engine
tags: [audit, verification, scanner, ipc-boundary]
requires:
  - phase: 05-02
    provides: persisted shared verification truth and qualifying shell-intent summaries
provides:
  - Shared run-audit engine with conservative precedence and attention reasons
  - Persisted per-session audit results in the cache `derived` payload
  - Verified IPC/session-preview boundary that still omits verification and audit conclusions
affects: [phase-05, audit, scanner, cache, ipc, tests]
tech-stack:
  added: []
  patterns:
    - Run audit consumes shared verification truth instead of re-deriving verification ad hoc
    - Internal cache conclusions can grow while current session previews remain sanitized
key-files:
  created:
    - src/main/core/audit/types.ts
    - src/main/core/audit/claim-completion.ts
    - src/main/core/audit/run-audit-engine.ts
    - src/main/core/audit/index.ts
    - tests/main/core/run-audit-engine.test.ts
  modified:
    - src/main/core/cache/file-backed-cache-store.ts
    - src/main/core/ingestion/scanner.ts
    - tests/main/core/scanner-cache.test.ts
    - tests/main/ipc/session-view-model-service.test.ts
key-decisions:
  - "Run audit now applies the shared precedence `active -> cancelled -> verification-failed -> incomplete -> needs-review -> clean -> unknown`."
  - "Post-claim incompleteness only considers later tool/file/shell activity, not lazily surfaced output-artifact bookkeeping."
  - "Current session summaries and previews stay headless even though cache records now persist verification and audit conclusions internally."
patterns-established:
  - "Attention reasons preserve the dispute trail alongside the primary status so cancelled, incomplete, missing-sidecar, parser-warning, and capability-gap cases remain explainable."
requirements-completed: [AUDT-07, AUDT-08, AUDT-09]
duration: execution
completed: 2026-05-23
status: complete
---

# Phase 5 Plan 03: Run Audit Summary

**Phase 5 now derives conservative run-audit status and attention reasons from shared lifecycle, shell, verification, and diagnostic evidence while keeping the current IPC/session-preview surface free of those conclusions.**

## Performance

- **Duration:** Execution during Phase 5 Wave 3
- **Completed:** 2026-05-23T19:23:07Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Added `src/main/core/audit/**` with a completion-claim heuristic and the shared run-audit engine.
- Persisted per-session audit results beside shell and verification summaries in the cache `derived` payload.
- Implemented the shared status precedence for active, cancelled, verification-failed, incomplete, needs-review, clean, and unknown runs.
- Added attention reasons for failed verification, no verification, pending tool calls, post-claim activity, missing sidecars, parser warnings, capability gaps, and uncertain claims.
- Proved that current session summaries and previews remain sanitized even when the underlying cache records now include rich audit state.

## Task Commits

No atomic execution commits were recorded for `05-03`; this summary reflects the verified working tree implementation.

## Files Created/Modified

- `src/main/core/audit/types.ts` - shared run-audit status, completion-claim, and attention-reason contracts
- `src/main/core/audit/claim-completion.ts` - conservative terminal-assistant claim heuristic
- `src/main/core/audit/run-audit-engine.ts` - primary status derivation and attention reason logic
- `src/main/core/cache/file-backed-cache-store.ts` - cache schema support for persisted audit results
- `src/main/core/ingestion/scanner.ts` - scan-time audit persistence on top of shared shell and verification truth
- `tests/main/core/run-audit-engine.test.ts` - precedence, cancellation, incompleteness, and needs-review proof
- `tests/main/ipc/session-view-model-service.test.ts` - preserved sanitized session-summary/session-preview boundary

## Decisions Made

- Limited post-claim incompleteness to later tool/file/shell activity so delayed artifact bookkeeping does not overstate incomplete runs.
- Kept `clean` gated behind explicit supported git capability, which means current scanned sessions still resolve to reviewable states rather than overclaiming cleanliness before Phase 7.
- Reserved `unknown` for truly blocked conclusions and used `needs-review` for degradations that still preserve a trustworthy primary classification.

## Deviations from Plan

None.

## Verification

- `npm run test -- tests/main/core/run-audit-engine.test.ts tests/main/core/scanner-cache.test.ts tests/main/ipc/session-view-model-service.test.ts` - passed
- `npm run typecheck` - passed

## User Setup Required

None.

## Next Phase Readiness

Phase 5 Plan 04 can now lock the truth table with focused fake and Gemini fixtures plus regression coverage over the shared shell, verification, and run-audit pipeline.

## Self-Check: PASSED

- Shared audit modules exist under `src/main/core/audit/**`.
- Scanner persists run-audit status and attention reasons without leaking them into current IPC outputs.
- Precedence, incompleteness, cancellation, and boundary behavior all have executable proof.

---
*Phase: 05-shared-shell-verification-and-run-audit*
*Completed: 2026-05-23*
