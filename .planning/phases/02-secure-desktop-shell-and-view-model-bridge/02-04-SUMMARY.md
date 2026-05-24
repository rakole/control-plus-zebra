---
phase: 02-secure-desktop-shell-and-view-model-bridge
plan: 04
subsystem: ui
tags: [electron, react, renderer, preload-bridge, vitest]

requires:
  - phase: 02-02
    provides: typed preload API and sanitized session IPC DTOs
  - phase: 02-03
    provides: renderer security guardrails and boundary tests
provides:
  - Sessions-first renderer route backed by window.agentWorkbench
  - Read-only list/detail preview with reload, selection, and keyboard navigation
  - Explicit Supported, Unsupported, and Unknown capability badge rendering
  - Renderer source tests for read-only controls, provider neutrality, and main/adapter boundaries
affects: [phase-02, phase-03, phase-06, renderer, desktop-shell]

tech-stack:
  added: []
  patterns:
    - Renderer DTO typing derived from Window agentWorkbench bridge methods instead of main-process imports
    - Source-level renderer boundary tests for read-only UI scope

key-files:
  created:
    - src/renderer/components/AppShell.tsx
    - src/renderer/components/CapabilityBadge.tsx
    - src/renderer/components/LoadingSkeleton.tsx
    - src/renderer/components/SessionList.tsx
    - src/renderer/components/SessionPreview.tsx
    - src/renderer/routes/SessionsRoute.tsx
    - tests/renderer/sessions-route.test.tsx
    - tests/renderer/renderer-boundary-source.test.ts
  modified:
    - src/renderer/App.tsx
    - src/renderer/main.tsx
    - src/renderer/styles.css
    - package.json
    - vite.main.config.ts
    - vite.preload.config.ts
    - src/main/window.ts
    - tests/security/browser-window-security.test.ts

key-decisions:
  - "Renderer production code derives DTO types from the preload bridge and does not import src/main/**."
  - "The route uses the existing typed listSessions request contract instead of expanding IPC schema in a renderer-only plan."
  - "Electron main and preload Vite bundles use .cjs filenames so the CommonJS Electron output can launch inside the repo's type: module package."

patterns-established:
  - "Sessions route calls only window.agentWorkbench list/get methods for data."
  - "Unsupported and Unknown states render as explicit neutral badges, never as success labels."
  - "Renderer source tests scan for forbidden V1 mutation/control labels and provider-specific branches."

requirements-completed: [DESK-01, DESK-03, DESK-04, DESK-05]

duration: 14min
completed: 2026-05-23
status: complete
---

# Phase 2 Plan 04: Sessions-First Renderer Route Summary

Historical note: this summary records the Phase 2 renderer layout as it existed on 2026-05-23. After the Wave 9 renderer migration, current shared UI lives under `src/renderer/components/{app,ui}`, domain routes and components live under `src/renderer/features/*/{routes,components}`, `src/renderer/routes/` contains only `route-registry.tsx`, and `src/renderer/styles.css` is foundation-only. Keep the file/filepath list below as a phase artifact, not the current renderer map.

**Bridge-backed Sessions route with read-only list/detail preview, explicit capability truth states, and renderer source-boundary proof.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-23T14:19:01Z
- **Completed:** 2026-05-23T14:32:50Z
- **Tasks:** 4 complete
- **Files modified:** 17

## Accomplishments

- Built the reusable renderer shell, session list, selected preview, capability badge, and loading skeleton components.
- Wired `/sessions` as the default route with preload-backed session loading, preview selection, reload, empty/error states, and keyboard navigation.
- Added renderer tests proving bridge calls, selection behavior, exact copy, explicit Unsupported/Unknown rendering, sanitized errors, and read-only scope.
- Added source-boundary tests that reject renderer imports from `src/main/**` or adapter-private code and reject provider-specific branching.
- Fixed the Electron launch blocker caused by CommonJS Vite main output being emitted as `.js` under the repo's `type: module` package, then verified the desktop window manually.

## Task Commits

1. **Task 1: Build renderer shell/list/preview components** - `611b79c` (feat)
2. **Task 2: Wire Sessions route to preload bridge** - `91788a6` (feat)
3. **Task 3: Prove renderer read-only boundaries** - `fd13e2f` (test)
4. **Task 4: Manual local launch check fix and verification** - `f4196f0` (fix)

## Files Created/Modified

- `src/renderer/components/AppShell.tsx` - Persistent 224px sidebar, 56px header, active Sessions nav, and disabled placeholder nav.
- `src/renderer/components/CapabilityBadge.tsx` - Exact Supported, Unsupported, and Unknown badge labels.
- `src/renderer/components/LoadingSkeleton.tsx` - Compact session-row and preview loading state.
- `src/renderer/components/SessionList.tsx` - Dense selectable rows with timestamps, adapter display names, lifecycle labels, and capability warnings.
- `src/renderer/components/SessionPreview.tsx` - Selected summary preview with harness display, status, timestamps, diagnostic count, capability warnings, and evidence counts only.
- `src/renderer/routes/SessionsRoute.tsx` - Read-only bridge-backed Sessions route.
- `src/renderer/App.tsx` - Routes `/` and unknown paths to `/sessions`.
- `src/renderer/styles.css` - UI-SPEC layout, color, spacing, selected row, skeleton, and responsive styles.
- `tests/renderer/sessions-route.test.tsx` - Renderer behavior and copy tests.
- `tests/renderer/renderer-boundary-source.test.ts` - Renderer source-scope and provider-neutrality tests.
- `package.json` / `vite.main.config.ts` / `vite.preload.config.ts` / `src/main/window.ts` - Electron main/preload bundles now emit and load `.cjs` files so the dev app launches under `type: module`.
- `src/renderer/main.tsx` - Imports the React plugin preamble from a module entrypoint so the strict CSP does not need unsafe script permissions for dev refresh.
- `tests/security/browser-window-security.test.ts` - Locks the preload path to `preload.cjs`.

## Decisions Made

- Used `Window["agentWorkbench"]` return types inside renderer code so production renderer source stays free of direct `src/main/**` imports.
- Kept `listSessions()` on the existing typed preload contract. The plan action mentioned `{ limit: 50 }`, but the current IPC request schema does not define `limit`; expanding IPC was outside this renderer-only slice.
- Kept the repo's `type: module` baseline and fixed Electron's CommonJS runtime expectation by naming generated main/preload bundles `.cjs` instead of weakening the TypeScript/ESM project posture.

## Deviations from Plan

### Auto-fixed Issues

**1. Electron main/preload bundles needed CommonJS filenames under `type: module`**
- **Found during:** Task 4 (Manual local launch check)
- **Issue:** `npm start` built the app but Electron threw `ReferenceError: require is not defined in ES module scope` because Vite emitted CommonJS main-process code as `.vite/build/electron-main.js` while `package.json` declares `"type": "module"`.
- **Fix:** Changed the Electron app entry to `.vite/build/electron-main.cjs`, configured the main Vite lib output as `electron-main.cjs`, emitted `preload.cjs`, updated `src/main/window.ts`, and source-tested the preload path.
- **Files modified:** `package.json`, `vite.main.config.ts`, `vite.preload.config.ts`, `src/main/window.ts`, `tests/security/browser-window-security.test.ts`
- **Verification:** `npm run typecheck`, browser-window security test, `npm run package`, and `npm start`
- **Committed in:** `f4196f0`

**2. React Fast Refresh preamble needed module initialization under strict CSP**
- **Found during:** Task 4 (Manual local launch check)
- **Issue:** After the Electron main process launched, Vite reported `@vitejs/plugin-react can't detect preamble` because the strict Electron CSP prevents the plugin's inline preamble from being a reliable initialization path.
- **Fix:** Imported `@vitejs/plugin-react/preamble` from `src/renderer/main.tsx`, preserving the local-only CSP without adding `unsafe-eval` or remote script permissions.
- **Files modified:** `src/renderer/main.tsx`
- **Verification:** `npm start` launched the window and no further Vite client error appeared after reload.
- **Committed in:** `f4196f0`

### Plan Adjustments

**1. Existing bridge request contract has no `limit` field**
- **Found during:** Task 2 (Sessions route data loading)
- **Issue:** Plan text requested `window.agentWorkbench.listSessions({ limit: 50 })`, but `ListSessionsRequest` currently only supports optional `adapterId`.
- **Adjustment:** Called `window.agentWorkbench.listSessions()` through the existing typed preload contract instead of changing IPC/schema files outside the renderer plan scope.
- **Files modified:** `src/renderer/routes/SessionsRoute.tsx`, `tests/renderer/sessions-route.test.tsx`
- **Verification:** `npm run typecheck`, `npm run test -- tests/renderer/sessions-route.test.tsx`

**Total deviations:** 2 auto-fixed; 1 scoped plan adjustment.
**Impact on plan:** Renderer behavior remains read-only and bridge-backed. The launch fixes preserve the approved Electron/Vite stack and strict CSP instead of broadening permissions.

## Issues Encountered

**Manual launch checkpoint initially blocked, then resolved.**

`npm start` progressed through Electron Forge system checks, Vite renderer dev server startup, and main/preload bundle builds. It reported:

- `Local: http://localhost:5173/`
- `Built main process and preload bundles`
- `Launched Electron app. Type rs in terminal to restart main process.`

Electron then threw during load:

```text
ReferenceError: require is not defined in ES module scope
file:///Users/rhishi/dev/repositories/control-plus-zebra/.vite/build/electron-main.js:23:16
package.json contains "type": "module"
```

The startup blocker was fixed in `f4196f0` by emitting Electron main/preload bundles as `.cjs`. A second dev-launch pass opened one local Electron window titled `Agent Workbench` at `localhost:5173/#/sessions`. Computer Use verified the visible route showed `Sessions`, `Reload Sessions`, fake-backed session rows, a selected-session preview, `Unsupported` and `Unknown` capability badges, and no launch, approve, reject, terminal, PR, cleanup, delete, reset, or arbitrary mutation controls.

## Verification

- `npm run lint` - PASS
- `npm run typecheck` - PASS
- `npm run test` - PASS, 15 files / 43 tests
- `npm run test:boundaries` - PASS, 2 files / 9 tests
- `npm run test:renderer` - PASS, 1 file / 7 tests
- `npm run test -- tests/security/renderer-forbidden-apis.test.ts` - PASS, 1 file / 2 tests
- `npm run test -- tests/security/browser-window-security.test.ts` - PASS, 1 file / 3 tests
- `npm run package` - PASS
- `npm start` - PASS, Electron app launched and manual UI checkpoint passed via Computer Use

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - manual local launch verification passed in this execution.

## Next Phase Readiness

Phase 2 is ready for phase-level verification and routing to Phase 3 planning/execution. Phase 8 still owns automated Electron smoke coverage, but the Phase 2 manual launch checkpoint has passed.

## Self-Check: PASSED

- Created files exist: `src/renderer/components/AppShell.tsx`, `src/renderer/routes/SessionsRoute.tsx`, `tests/renderer/sessions-route.test.tsx`, `tests/renderer/renderer-boundary-source.test.ts`
- Task commits exist: `611b79c`, `91788a6`, `fd13e2f`, `f4196f0`
- Automated verification passed: lint, typecheck, full tests, boundaries, renderer tests, security tests, and packaging
- Manual launch acceptance passed: one local Electron window opens to Sessions with read-only fake-backed content

---
*Phase: 02-secure-desktop-shell-and-view-model-bridge*
*Completed: 2026-05-23*
