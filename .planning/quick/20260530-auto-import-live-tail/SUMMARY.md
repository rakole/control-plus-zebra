---
quick_id: 20260530-auto-import-live-tail
slug: auto-import-live-tail
status: complete
completed_at: "2026-05-30T14:16:27Z"
---

# Auto Import + Live Tail Summary

Implemented the first stale-triggered background snapshot refresh slice for registered local sources.

## Implementation

- Added `BackgroundScanScheduler` to own startup reconciliation, source filtering, coalesced queueing, same-source dedupe, one-at-a-time background scans, watch-plan restore, and scanner status fields.
- Wired the runtime watch orchestrator's update signal into the scheduler while preserving the existing stale-cache hook.
- Switched Electron app composition to use `createElectronUtilityScanJobRunner` with `utilityProcess.fork`, so production background scans run outside the renderer/main UI path.
- Extended `scanner:getStatus` with queued, active background, coalescing, watching, and last-background-scan fields.
- Added focused scheduler tests for eligible-source filtering, startup reconciliation, coalescing, and scoped watch update routing.
- Added `.local/live-load/auto-import-live-tail-strategy.md` as the requested local strategy artifact.

## Verification

- `npx vitest run tests/main/app/background-scan-scheduler.test.ts tests/main/app/electron-utility-scan-job-runner.test.ts tests/main/ipc/data-sources-ipc.test.ts tests/main/ipc/ipc-handlers.test.ts tests/main/core/watch-orchestrator.test.ts` - passed, 5 files and 19 tests.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
