---
phase: 02-secure-desktop-shell-and-view-model-bridge
plan: 02
subsystem: ipc-preload
tags: [electron, preload, ipc, zod, view-models, fake-adapter, security]

requires:
  - phase: 02-secure-desktop-shell-and-view-model-bridge
    provides: Secure Electron shell scaffold and empty typed preload bridge from 02-01
provides:
  - Fixed harness-neutral IPC channel allowlist
  - Zod-backed renderer-safe session and shell view-model contracts
  - Fake-adapter-backed session summary and preview mapper
  - Validated IPC handlers with sanitized error envelopes
  - Typed preload bridge with one method per allowed operation
affects: [phase-02, ipc, preload, renderer-view-models, desktop-security]

tech-stack:
  added: []
  patterns: [zod ipc contracts, injectable ipc handler registration, sanitized app-layer view-model mapping, narrow preload bridge]

key-files:
  created:
    - src/main/app/session-view-model-service.ts
    - src/main/ipc/channels.ts
    - src/main/ipc/view-models.ts
    - src/main/ipc/handlers.ts
    - tests/main/ipc/session-view-model-service.test.ts
    - tests/main/ipc/ipc-handlers.test.ts
    - tests/preload/preload-api-surface.test.ts
  modified:
    - src/main/ipc/index.ts
    - src/main/electron-main.ts
    - src/preload/types.ts
    - src/preload/index.ts

key-decisions:
  - "Use exactly three Phase 2 IPC channels: app:getShellState, sessions:list, and sessions:getById."
  - "Return response envelopes for session IPC calls so handler failures can be sanitized without leaking stacks or paths."
  - "Keep private ipcRenderer.invoke usage inside preload while exposing only named product methods to the renderer."

patterns-established:
  - "Renderer-facing DTOs are smaller than normalized core entities and contain labels/counts instead of raw messages, raw artifact paths, or audit conclusions."
  - "IPC handlers are injectable and schema-validate both requests and successful responses."
  - "Preload public-surface tests inspect source files for generic bridge helper regressions."

requirements-completed: [DESK-03, DESK-04, DESK-05]

duration: 7min
completed: 2026-05-23
---

# Phase 2 Plan 02: Typed Preload and IPC Bridge Summary

**Validated Electron IPC/preload bridge that exposes sanitized fake-adapter session view models through three narrow harness-neutral operations.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-23T13:59:21Z
- **Completed:** 2026-05-23T14:06:31Z
- **Tasks:** 4
- **Files modified:** 11

## Accomplishments

- Defined the fixed IPC allowlist: `app:getShellState`, `sessions:list`, and `sessions:getById`.
- Added Zod schemas/types for shell state, session summary, session preview, list/get requests, list/get responses, explicit `Supported` / `Unsupported` / `Unknown` capability badges, and sanitized errors.
- Loaded the existing fake adapter through the bundled registry and mapped normalized evidence to renderer-safe session summaries/previews without raw content, raw artifact paths, final verification state, run-audit status, or attention reasons.
- Registered Electron IPC handlers before window creation with request validation, response validation, and sanitized `invalid-request` / `session-load-failed` errors.
- Updated preload to expose exactly `getShellState()`, `listSessions(request?)`, and `getSessionById(request)`.

## Task Commits

1. **Task 1: Define harness-neutral IPC channels and sanitized view-model schemas** - `d2b4153` (feat)
2. **Task 2: Map fake-adapter proof data into renderer-safe session view models** - `d4eada8` (feat)
3. **Task 3: Register IPC handlers with request validation and sanitized errors** - `98f0a75` (feat)
4. **Task 4: Expose one typed preload method per allowed operation** - `79fa3ad` (feat)

## Files Created/Modified

- `src/main/ipc/channels.ts` - Allowed IPC channel constants and channel type.
- `src/main/ipc/view-models.ts` - Zod schemas and TypeScript DTOs for shell/session IPC payloads.
- `src/main/ipc/handlers.ts` - Injectable IPC handler registration, request validation, response validation, and sanitized errors.
- `src/main/ipc/index.ts` - IPC module export surface.
- `src/main/app/session-view-model-service.ts` - Fake-adapter-backed app service that maps normalized data into sanitized summaries/previews.
- `src/main/electron-main.ts` - Registers IPC handlers before creating the BrowserWindow.
- `src/preload/types.ts` - Typed `window.agentWorkbench` bridge contract.
- `src/preload/index.ts` - Private `ipcRenderer.invoke` calls behind three named bridge methods.
- `tests/main/ipc/session-view-model-service.test.ts` - Fake-backed view-model and forbidden-key coverage.
- `tests/main/ipc/ipc-handlers.test.ts` - Channel registration, invalid request, sanitized error, and schema-valid response coverage.
- `tests/preload/preload-api-surface.test.ts` - Source-level preload public-surface regression coverage.

## Decisions Made

- Used response envelopes for `sessions:list` and `sessions:getById` so renderer callers receive stable sanitized failures instead of thrown Electron/Zod/adapter errors.
- Kept `app:getShellState` as a direct shell-state DTO because it has no request payload and is synchronous service state.
- Preserved `ipcRenderer.invoke` only as private preload implementation detail; no public `invoke`, `send`, `on`, `removeListener`, `ipcRenderer`, filesystem, shell, or Electron namespace is exposed.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope expansion beyond 02-02.

## Known Stubs

None. Stub scan only found local accumulator defaults and the empty default `listSessions({})` request object; no renderer-facing stub data was introduced.

## Threat Flags

None. The new IPC and preload surfaces are the exact trust-boundary surfaces described in the plan threat model and are covered by validation/tests.

## Issues Encountered

- TypeScript initially widened the capability label helper to `string`; it was narrowed to the explicit `Supported | Unsupported | Unknown` DTO union before commit.
- TypeScript initially widened the shared IPC error helper and fake test service shell-state literals; both were narrowed before commit.

## Verification

- `npm run typecheck` - passed
- `npm run test -- tests/main/ipc/session-view-model-service.test.ts` - passed, 1 file / 2 tests
- `npm run test -- tests/main/ipc/ipc-handlers.test.ts` - passed, 1 file / 3 tests
- `npm run test -- tests/preload/preload-api-surface.test.ts` - passed, 1 file / 2 tests
- `rg "gemini-cli|Gemini" src/main/ipc src/main/app src/preload` - no matches
- `rg "ipcRenderer|invoke|send|removeListener|child_process|from \"node:fs\"|from 'node:fs'" src/preload src/renderer` - only expected private `ipcRenderer.invoke` implementation calls in `src/preload/index.ts`
- `npm run lint` - passed
- `npm run test` - passed, 10 files / 23 tests

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02-03 can add CSP, broader renderer restrictions, and forbidden API checks on top of the now-fixed IPC/preload contract. Plan 02-04 can render the Sessions-first route through `window.agentWorkbench` without renderer-local mocks.

## Self-Check: PASSED

- Verified all created/modified plan files exist on disk.
- Verified task commits exist: `d2b4153`, `d4eada8`, `98f0a75`, `79fa3ad`.

---
*Phase: 02-secure-desktop-shell-and-view-model-bridge*
*Completed: 2026-05-23*
