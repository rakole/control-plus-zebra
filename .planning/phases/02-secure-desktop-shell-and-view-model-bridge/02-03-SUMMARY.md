---
phase: 02-secure-desktop-shell-and-view-model-bridge
plan: 03
subsystem: security
tags: [electron, csp, renderer-security, eslint, vitest]

requires:
  - phase: 02-01
    provides: Electron Forge/Vite BrowserWindow and renderer shell scaffold
  - phase: 02-02
    provides: Typed preload bridge and sanitized IPC view models
provides:
  - Local-only Content Security Policy builder for Electron renderer responses
  - BrowserWindow source tests for Node-disabled, isolated, sandboxed renderer defaults
  - Renderer forbidden API scans for filesystem, shell, Electron, process, require, and dynamic code usage
  - Renderer import-boundary enforcement against all main-process internals
affects: [phase-02, renderer, electron-main, security-boundaries, phase-08-smoke-tests]

tech-stack:
  added: []
  patterns: [source-level security guard tests, local-only CSP builder, renderer ESLint restrictions]

key-files:
  created:
    - src/main/security/content-security-policy.ts
    - tests/security/content-security-policy.test.ts
    - tests/security/browser-window-security.test.ts
    - tests/security/renderer-forbidden-apis.test.ts
    - tests/boundaries/fixtures/illegal-renderer-main-import.ts
  modified:
    - src/main/window.ts
    - eslint.config.mjs
    - tests/boundaries/import-boundaries.test.ts

key-decisions:
  - "CSP is registered in the main process before renderer content loads, using production local-only directives and localhost-only development connect allowances."
  - "Renderer security proof remains source/test based in Phase 2; full Electron smoke packaging remains deferred to Phase 8."
  - "Renderer import restrictions ban all src/main/** internals, while retaining the adapter-private rejection already established in Phase 1."

patterns-established:
  - "Security-sensitive Electron settings are locked with source tests while the shell surface is still small."
  - "Renderer restrictions are enforced in both Vitest source scans and practical ESLint rules."

requirements-completed: [DESK-02, DESK-05, DESK-06]

duration: 5min
completed: 2026-05-23
---

# Phase 2 Plan 03: Local-Only CSP and Renderer Security Guardrails Summary

**Local-only Electron renderer security with CSP headers, BrowserWindow default tests, renderer forbidden API scans, and main-process import-boundary enforcement**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-23T14:10:35Z
- **Completed:** 2026-05-23T14:15:47Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `buildContentSecurityPolicy({ mode })` with restrictive production directives and localhost-only development connect allowances.
- Registered the CSP response header hook in `src/main/window.ts` before `loadURL` or `loadFile` runs.
- Added security tests for BrowserWindow defaults, local renderer loading, renderer forbidden APIs, and renderer-to-main import boundaries.
- Mirrored renderer restrictions in ESLint for Electron, filesystem, shell, generic require/process, IPC, and dynamic code usage.

## Task Commits

1. **Task 1: Add local-only CSP builder and apply it to renderer responses** - `9866368` (feat)
2. **Task 2: Source-test BrowserWindow security defaults and local loading** - `da32295` (test)
3. **Task 3: Block renderer imports from main/adapters and forbidden Node/Electron APIs** - `44f082c` (test)

## Files Created/Modified

- `src/main/security/content-security-policy.ts` - Builds production and development CSP strings with localhost-only dev validation.
- `src/main/window.ts` - Registers CSP headers before renderer content loading while preserving explicit BrowserWindow security defaults.
- `tests/security/content-security-policy.test.ts` - Covers production directives, dev-local allowance, and remote dev origin rejection.
- `tests/security/browser-window-security.test.ts` - Source-tests `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, explicit preload, and no hardcoded remote renderer target.
- `tests/security/renderer-forbidden-apis.test.ts` - Scans renderer `.ts` and `.tsx` files for forbidden Node, Electron, process, require, IPC, eval, and Function usage.
- `tests/boundaries/import-boundaries.test.ts` - Rejects renderer imports from all `src/main/**` internals in addition to adapter-private code.
- `tests/boundaries/fixtures/illegal-renderer-main-import.ts` - Synthetic renderer-to-core violation fixture.
- `eslint.config.mjs` - Adds practical renderer import/global restrictions matching the source scans.

## Decisions Made

- Development CSP accepts only an explicit `http://localhost`, `http://127.0.0.1`, or `http://[::1]` origin with a port; remote dev renderer origins throw before content loading.
- The final insecure-source scan is preserved by constructing synthetic insecure strings in tests without embedding blocked source configuration literals.
- Full Electron runtime smoke coverage remains out of scope for this plan and is still owned by Phase 8.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope expansion.

## Issues Encountered

- Initial synthetic forbidden-API test assertion omitted the `fs` violation produced by `window.require("fs")`; corrected the expected test output before committing Task 3.

## Verification

- `npm run lint` - PASS
- `npm run typecheck` - PASS
- `npm run test:boundaries` - PASS
- `npm run test -- tests/security` - PASS
- `rg "https://|unsafe-eval|nodeIntegration: true|contextIsolation: false|sandbox: false" src/main src/renderer tests/security` - PASS, no matches

## Known Stubs

None. Stub-pattern scan only matched local accumulator arrays in source-scanning tests, not UI-rendered placeholder data.

## Threat Flags

None. This plan mitigated the planned renderer runtime, renderer import/global, and remote-code-loading threat surfaces without introducing new network endpoints, auth paths, file access patterns, or schema trust boundaries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02-04 can build the Sessions-first renderer route on top of the locked preload/IPC bridge and renderer guardrails. Do not weaken the new renderer import/API restrictions; route code should consume only `window.agentWorkbench` and local renderer modules.

## Self-Check: PASSED

- Created/modified files listed above exist.
- Task commits found: `9866368`, `da32295`, `44f082c`.
- Plan-level verification commands passed.

---
*Phase: 02-secure-desktop-shell-and-view-model-bridge*
*Completed: 2026-05-23*
