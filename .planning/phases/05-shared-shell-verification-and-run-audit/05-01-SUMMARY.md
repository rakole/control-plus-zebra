---
phase: 05-shared-shell-verification-and-run-audit
plan: 01
subsystem: shared-shell-foundation
tags: [shell, scanner, cache, gemini-cli, fake-test]
requires:
  - phase: 04-04
    provides: evidence-only Gemini and fake adapter normalization with lazy output artifacts
provides:
  - Shared shell parser modules for intent, exit-code, and command-result derivation
  - Scan-time shell summary persistence in a sibling cache `derived.sessions[*].shellCommands` payload
  - Harness-neutral shell evidence links from adapters back to tool calls and output artifacts
affects: [phase-05, scanner, cache, adapters, tests]
tech-stack:
  added: []
  patterns:
    - Shared shell truth is derived in `Scanner.scanSource()` while adapter output-artifact bindings are still live
    - Adapters remain evidence-only while cache records gain sibling derived summaries
key-files:
  created:
    - src/main/core/shell/types.ts
    - src/main/core/shell/intent-classifier.ts
    - src/main/core/shell/exit-code-parser.ts
    - src/main/core/shell/shell-command-parser.ts
    - src/main/core/shell/index.ts
    - tests/main/core/shell-command-parser.test.ts
  modified:
    - src/main/core/cache/file-backed-cache-store.ts
    - src/main/core/ingestion/scanner.ts
    - src/main/core/model/entities.ts
    - src/main/adapters/fake-test/normalize.ts
    - src/main/adapters/fake-test/types.ts
    - src/main/adapters/gemini-cli/normalize.ts
    - src/main/core/ingestion/normalization-validator.ts
    - tests/contract/run-adapter-contract.ts
    - tests/main/core/scanner-cache.test.ts
key-decisions:
  - "Shared shell derivation stays scan-time so Gemini lazy sidecar bindings can be resolved before cache write."
  - "Parsed shell summaries persist beside normalized evidence in `derived`, not inside adapter-normalized entities."
  - "Explicit shell exit codes remain authoritative; raw tool success is preserved as supporting evidence but cannot override a nonzero exit code."
patterns-established:
  - "Shell commands now carry optional harness-neutral `toolCallId`, `artifactIds`, and `rawToolStatus` links when adapters know them."
requirements-completed: [AUDT-01, AUDT-02, AUDT-03, TEST-04]
duration: execution
completed: 2026-05-23
status: complete
---

# Phase 5 Plan 01: Shared Shell Foundation Summary

**Phase 5 now has a shared shell parsing foundation that classifies command intent, preserves exit-code precedence, derives shell summaries during scanning, and persists those summaries beside normalized evidence without leaking conclusions back into adapters.**

## Performance

- **Duration:** Execution during Phase 5 Wave 1
- **Completed:** 2026-05-23T19:23:07Z
- **Tasks:** 1
- **Files modified:** 10

## Accomplishments

- Added `src/main/core/shell/**` with shared intent classification, exit-code extraction, and shell summary parsing entrypoints.
- Extended normalized `ShellCommandEvidence` with optional harness-neutral relation fields so shared core can correlate shell commands with tool calls and output artifacts without Gemini-only heuristics.
- Hooked `Scanner.scanSource()` to derive parsed shell summaries before cache writes, loading lazy Gemini output artifacts while the adapter binding map is still live.
- Persisted per-session parsed shell summaries in a sibling cache `derived.sessions[*].shellCommands` payload and preserved missing-sidecar evidence as lower-confidence shell truth instead of dropping the command.
- Tightened adapter-contract and normalization validation so shell-command link fields stay relationship-safe when present.

## Task Commits

No atomic execution commits were recorded for `05-01`; this summary reflects the verified working tree implementation.

## Files Created/Modified

- `src/main/core/shell/types.ts` - shared parsed shell summary contracts
- `src/main/core/shell/intent-classifier.ts` - harness-neutral command intent detection
- `src/main/core/shell/exit-code-parser.ts` - textual exit-code extraction fallback
- `src/main/core/shell/shell-command-parser.ts` - exit-code-precedence and confidence-aware shell summary derivation
- `src/main/core/cache/file-backed-cache-store.ts` - sibling `derived.sessions[*].shellCommands` cache schema
- `src/main/core/ingestion/scanner.ts` - scan-time shell derivation and lazy artifact loading
- `src/main/adapters/gemini-cli/normalize.ts` - shell/tool/artifact relation backfill for Gemini shell evidence
- `src/main/adapters/fake-test/{types.ts,normalize.ts}` - fake fixture support for optional shell relation fields
- `tests/main/core/{shell-command-parser.test.ts,scanner-cache.test.ts}` - shell parser and scanner integration proof

## Decisions Made

- Kept shell parsing headless and shared-core-owned so verification and run audit can build on the same derived shell facts in later waves.
- Used cache-side derived shell summaries instead of storing full stdout/stderr bodies, preserving the existing lazy artifact-loading boundary.
- Treated missing sidecars as degraded evidence with diagnostics rather than erasing shell commands or fabricating success.

## Deviations from Plan

None.

## Verification

- `npm run test -- tests/main/core/shell-command-parser.test.ts tests/main/core/scanner-cache.test.ts tests/adapters/gemini-cli/gemini-output-artifact.test.ts` - passed
- `npm run typecheck` - passed

## User Setup Required

None.

## Next Phase Readiness

Phase 5 Plan 02 can now derive verification truth from persisted shared shell summaries instead of raw tool status or adapter-specific heuristics.

## Self-Check: PASSED

- Shared shell modules exist under `src/main/core/shell/**`.
- Scanner-derived shell summaries are persisted before cache writes.
- Adapters remain evidence-only while shell truth is available for later verification and audit derivation.

---
*Phase: 05-shared-shell-verification-and-run-audit*
*Completed: 2026-05-23*
