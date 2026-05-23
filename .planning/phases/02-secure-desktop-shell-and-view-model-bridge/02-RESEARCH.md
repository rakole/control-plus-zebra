# Phase 2: Secure Desktop Shell and View-Model Bridge - Research

**Researched:** 2026-05-23
**Status:** Ready for planning

## Executive Summary

Phase 2 should turn the Phase 1 shared-core proof into a secure desktop shell without letting Electron convenience features punch holes through the repo's harness-neutral and read-only boundaries. The highest-value path is to scaffold Electron Forge + Vite + React + TypeScript in a way that preserves the existing strict TypeScript/Vitest/lint baseline, then add a narrow preload/API surface, a sanitized IPC/view-model seam, hard renderer security checks, and one real Sessions-first route backed by fake-adapter data flowing through main-process handlers.

The phase should stay intentionally shallow on product breadth. It needs one honest desktop shell proof, not a broad app. Source scanning, Gemini-specific parsing, deep session timelines, run-audit panels, and Git/GitHub enrichment remain later-phase work.

The highest-value implementation order is:

1. Scaffold Electron Forge + Vite + React + TypeScript around the current repo without weakening strict defaults or Phase 1 boundaries.
2. Define typed preload and IPC contracts that return sanitized view models only.
3. Lock in renderer security defaults, CSP, and forbidden API checks before the shell grows.
4. Render one Sessions-first workbench route from fake-adapter-backed view-model data with placeholder chrome for later pages.

## What Phase 2 Must Prove

### Proof obligations from roadmap and requirements

- The repo can launch a macOS Electron app shell built with Electron Forge, Vite, React, and TypeScript without replacing or bypassing the Phase 1 workspace contracts.
- The renderer runs with `nodeIntegration: false`, `contextIsolation: true`, sandboxing enabled, and local-only content loading in both development and packaged-oriented flows.
- Preload exposes one typed method per allowed operation and does not expose `ipcRenderer`, generic `invoke`, raw filesystem access, or a broad Electron bridge.
- Main-process IPC handlers validate input and return sanitized view models rather than raw adapter output, raw normalized store objects, or adapter-private types.
- Renderer code remains harness-neutral and cannot import `src/main/adapters/**` or other main-process internals.
- The first real route uses fake-adapter-backed data through the main/preload/renderer seam, proving the UI is not built around local mocks or Gemini-specific assumptions.

### Scope fences

- Do not add source scanning, cache, watcher orchestration, Gemini fixture parsing, or real source-root configuration yet. Phase 3 and Phase 4 own those concerns.
- Do not add Run Audit, Session Detail timeline depth, Git/GitHub context, export/import, or shell-verification logic. Those belong to later phases.
- Do not expose generic bridge helpers such as `window.electron`, `window.ipc`, `ipcRenderer`, or a catch-all `invoke(channel, payload)` surface.
- Do not let the first UI proof turn into a marketing page or a broad dashboard. The locked phase direction is a utilitarian workbench shell with one real Sessions-first route.
- Do not treat unsupported capability states as zero values or success states in the first route.

## Recommended Implementation Shape

### 1. Scaffold Electron around the existing strict workspace

Phase 1 already established the NodeNext TypeScript/Vitest/lint baseline, so the Electron scaffold should be additive rather than destructive. The recommended shape is:

- keep `src/main/core/**` and `src/main/adapters/**` as-is
- add Electron composition entrypoints under `src/main/**`
- add `src/preload/**` for the typed bridge
- add `src/renderer/**` for the React app shell
- add only the config files needed for Electron Forge + Vite + renderer builds

The important constraint is ownership, not exact filenames. Shared core still owns normalized models and registry behavior; renderer still consumes IPC view models only.

### 2. Introduce an explicit app-shell service seam in main

Do not let the renderer reach into the adapter registry or shared-core entities directly. Add a small main-process application layer that:

- creates the bundled adapter registry
- obtains fake-adapter-backed proof data
- maps it into renderer-safe session summary/detail DTOs
- exposes those DTOs through narrow IPC handlers

This keeps future scanner/store growth inside main while giving the renderer a stable boundary from the first screen.

### 3. Keep IPC names future-shaped and harness-neutral

The spec explicitly warns against channel names like `gemini:getSessions`. Start with future-shaped names such as:

- `sessions:list`
- `sessions:getById`
- `app:getShellState`

The preload layer should wrap each channel in a dedicated typed method. Zod-backed validation should happen on the main side for requests and on the bridge/view-model side for responses where practical.

### 4. Use a Sessions-first workbench route

The first real screen should prove the end-to-end shell rather than maximize product breadth. A strong Phase 2 proof is:

- persistent app frame with a left nav or header for future pages
- one implemented Sessions route
- list/detail or list/preview layout
- harness badge, status, timestamps, and capability-warning summaries
- explicit unsupported/unknown states rather than flattened counts

This aligns with the phase context decision to use fake-adapter-backed session summaries and defer deep timeline/audit panels.

## Recommended Plan Split

| Plan | Wave | Why it exists |
|------|------|----------------|
| `02-01` | 1 | Scaffold Electron Forge + Vite + React + TypeScript and integrate it with the Phase 1 repo structure without weakening security defaults. |
| `02-02` | 2 | Define the preload bridge, IPC channels, request/response validation, and sanitized view-model mapping. |
| `02-03` | 2 | Lock in CSP, BrowserWindow security defaults, forbidden API restrictions, and boundary checks while the surface area is still small. |
| `02-04` | 3 | Build the first Sessions-first app shell route backed by fake-adapter data through the main/preload/renderer seam. |

### Dependency rationale

- `02-01` must land first because the Electron/Vite/React structure and scripts are prerequisite infrastructure.
- `02-02` depends on `02-01` because the preload and IPC layer need real entrypoints and app wiring.
- `02-03` depends on `02-01` and should land before or alongside renderer work so unsafe defaults do not become entrenched.
- `02-04` depends on `02-02` and `02-03` because the first route should consume the final sanitized bridge and inherit the locked renderer restrictions.

## Validation Architecture

### Test infrastructure for this phase

- **Frameworks:** Vitest for unit/boundary tests, React Testing Library or equivalent renderer harness via Vitest, and lightweight manual launch checks for the desktop shell
- **Type safety gate:** `npm run typecheck`
- **Boundary/security gate:** `npm run lint && npm run test:boundaries`
- **Targeted app-shell gate:** targeted Vitest runs for main/preload/renderer slices as they land
- **Full Phase 2 verification:** `npm run lint && npm run typecheck && npm run test`

### What must be validated

- Electron scaffold files compile without breaking existing shared-core tests.
- BrowserWindow creation and dev/prod content loading paths preserve strict renderer security defaults.
- Preload exports only the approved typed methods and does not leak `ipcRenderer` or generic bridge helpers.
- IPC handlers reject invalid payloads and return sanitized DTOs that are safe for renderer consumption.
- Renderer code cannot import adapter-private modules or use forbidden browser/Node/Electron APIs.
- The Sessions-first route renders fake-adapter-backed session summaries and shows unsupported/unknown states honestly.

### Fast feedback strategy

- During `02-01`, use `npm run typecheck` after each scaffold/config slice.
- During `02-02`, run targeted IPC/preload tests plus `npm run typecheck`.
- During `02-03`, run `npm run lint && npm run test:boundaries` after each security rule or boundary change.
- During `02-04`, run targeted renderer tests first, then the full suite before closing the phase.

## Security and Truth Guardrails

- BrowserWindow defaults must be explicit and locked in code: no Node integration in renderer, context isolation on, sandbox on, and only the preload bridge exposed.
- CSP should default to local-only content and avoid remote script execution. Development allowances should be minimal and explicitly justified.
- Renderer-facing view models must be deliberately smaller than shared-core entities. Do not pass raw normalized objects just because they already exist.
- The fake adapter remains the proof source in this phase. UI code should not introduce provider-specific branches or Gemini-shaped labels.
- Read-only V1 constraints still apply. The desktop shell must not add shell execution, source mutation, PR mutation, or live harness control paths.

## Risks to Watch During Execution

### Risk 1: scaffold drift breaks Phase 1 guarantees

Electron Forge and Vite scaffolds can overwrite package scripts, TypeScript settings, or directory ownership assumptions. Integrate them surgically so the repo keeps its Phase 1 strictness, naming rules, and shared-core boundaries.

### Risk 2: preload becomes a convenience backdoor

The fastest Electron prototypes often expose `ipcRenderer`, generic invoke helpers, or broad filesystem/Electron APIs. That would directly violate `DESK-03` through `DESK-05`. Treat preload as a product surface, not a temporary shortcut.

### Risk 3: UI proof relies on local mocks instead of the real bridge

If the Sessions screen uses renderer-local fake data, the phase will not have proven the view-model boundary. The first route must get its data through main-process mapping and preload APIs.

### Risk 4: security proof is deferred too late

If CSP, forbidden API checks, and boundary rules wait until the shell is feature-rich, the repo will accumulate insecure assumptions. Lock them in during Phase 2 while the surface area is still small.

## Planning Assumptions

- npm remains the package manager and Phase 2 can update `package-lock.json` as Electron/React tooling lands.
- Electron Forge + Vite is the implementation baseline unless a repo-local constraint emerges during execution that blocks it.
- Full packaged Electron smoke coverage remains a later hardening concern even though Phase 2 should still prove a launchable shell.
- A dedicated UI design contract is still required before executable plans are written for this frontend phase.

---
*Research completed: 2026-05-23*
*Ready for planning: yes*
