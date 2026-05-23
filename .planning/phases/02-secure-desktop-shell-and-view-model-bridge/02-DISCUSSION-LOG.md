# Phase 2: Secure Desktop Shell and View-Model Bridge - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 02-secure-desktop-shell-and-view-model-bridge
**Areas discussed:** Shell Shape, First Route Focus, Preload and IPC Surface, Scaffold and Security Proof

---

## Shell Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Bare single-screen proof | Fastest possible shell with no durable app chrome or route structure. | |
| Future-shaped minimal workbench shell | Lightweight persistent app chrome with one real route now and room for later pages. | ✓ |
| Full multi-page shell upfront | Multiple live pages and fuller navigation structure in Phase 2. | |

**User's choice:** Future-shaped minimal workbench shell
**Notes:** Auto-selected per user instruction to choose the recommended option throughout. Follow-on recommended choices in this area: use React Router in library/declarative mode from the first renderer slice, keep the shell utilitarian and desktop-tool oriented, and avoid a marketing-style landing page.

---

## First Route Focus

| Option | Description | Selected |
|--------|-------------|----------|
| Overview-first proof | Start with top-line metrics and aggregate cards before session browsing. | |
| Sessions-first proof from fake data | Use sanitized fake-adapter-backed session summaries to prove the bridge and first shell route. | ✓ |
| Full Session Detail proof | Jump directly to a rich timeline/detail view in Phase 2. | |

**User's choice:** Sessions-first proof from fake data
**Notes:** Auto-selected recommended path. Follow-on recommended choices in this area: send summary DTOs rather than raw normalized entities, use a list/detail-shell pattern or selected-session preview rather than a full timeline, and source the data through main-process IPC from the existing fake-adapter/shared-core proof path instead of renderer-local mocks.

---

## Preload and IPC Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Single bootstrap blob | One broad preload call that returns all shell data for the first screen. | |
| Small set of future-shaped typed methods | One typed preload method per allowed operation using harness-neutral IPC naming. | ✓ |
| Broad bridge / `ipcRenderer` exposure | Give the renderer generic invoke/send power to move faster during prototyping. | |

**User's choice:** Small set of future-shaped typed methods
**Notes:** Auto-selected recommended path. Follow-on recommended choices in this area: keep IPC names harness-neutral from the start, validate request payloads in main-process handlers, and return sanitized view models only with no raw adapter-private or filesystem-facing objects crossing the boundary.

---

## Scaffold and Security Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Optimize for speed over safety | Relax Electron/security defaults during scaffold work and harden later. | |
| Secure scaffold with immediate boundary proof | Start from the official scaffold, keep strict Electron defaults, add static/security checks now, and defer full smoke tests to later hardening. | ✓ |
| Hand-roll shell from scratch | Avoid scaffold influence entirely and build every file/config manually. | |

**User's choice:** Secure scaffold with immediate boundary proof
**Notes:** Auto-selected recommended path. Follow-on recommended choices in this area: keep `nodeIntegration` off, `contextIsolation` on, sandboxing on, local-only content, and restrictive CSP; extend the Phase 1 boundary/naming guardrails as renderer code lands; add immediate static/boundary checks for forbidden API exposure now, while leaving full Electron smoke coverage for the later hardening phase.

---

## the agent's Discretion

- Exact file naming for Electron main, preload, and renderer entrypoints.
- Exact component structure and styling for the initial workbench chrome.
- Exact initial IPC method subset, provided it stays small and harness-neutral.
- Exact shape of the selected-session preview within the Sessions-first route.

## Deferred Ideas

- Full Overview aggregate dashboard before the shared dashboard/view-model layer exists.
- Full Session Detail timeline and Run Audit UI before their dedicated later phases.
- Full Electron smoke and packaging proof before the hardening/readiness phase.
