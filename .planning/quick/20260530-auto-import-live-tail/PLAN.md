---
quick_id: 20260530-auto-import-live-tail
slug: auto-import-live-tail
status: in-progress
created_at: "2026-05-30T00:00:00Z"
---

# Auto Import + Live Tail

Implement stale-triggered background snapshot refresh for registered local sources.

## Scope

- Add a main-process background scan scheduler for valid local sources only.
- Use startup reconciliation to find changed cached sources and enqueue stale or never-scanned sources.
- Route watch update signals into coalesced background scans through the existing watch orchestrator seam.
- Surface queue/active/coalescing counts through `scanner:getStatus`.
- Use Electron utility scans in the packaged app composition.
- Write the strategy artifact to `.local/live-load/auto-import-live-tail-strategy.md`.

## Verification

- Focused scheduler and IPC tests for filtering, coalescing, status, and watch-signal enqueue behavior.
- Focused utility-runner coverage should continue to pass.
- Typecheck/lint if the touched shared types require it.
