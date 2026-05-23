# Phase 2 Pattern Map

**Mapped:** 2026-05-23
**Scope:** Secure Electron shell, preload bridge, IPC view models, security checks, and Sessions-first renderer route.

## Existing Patterns To Preserve

| New Area | Closest Existing Analog | Pattern To Reuse |
|----------|-------------------------|------------------|
| Electron main composition root | `src/main/core/registry/register-bundled-adapters.ts` | Adapter imports stay isolated to composition-root surfaces; shared model and renderer do not import adapter-private files. |
| IPC/view-model schemas | `src/main/adapters/fake-test/types.ts` | Use Zod schemas at process boundaries; invalid input becomes sanitized errors or diagnostics, not unchecked objects. |
| Fake-backed proof data | `tests/adapters/fake-test/fake-adapter.smoke.test.ts` | Exercise the fake adapter through the bundled registry rather than importing renderer-local mocks. |
| Boundary tests | `tests/boundaries/import-boundaries.test.ts` | Scan source files directly and assert explicit violation reasons for forbidden imports. |
| Naming tests | `tests/boundaries/shared-naming.test.ts` | Keep shared core and renderer free of provider-specific names and branches. |
| Capability truth | `src/main/core/model/capabilities.ts` and `tests/fixtures/fake-test/phase1-session.normalized.json` | Represent unsupported and unknown capability states explicitly in DTOs and UI labels. |

## Planned File Roles

| Plan | Files / Modules | Role |
|------|-----------------|------|
| `02-01` | `forge.config.ts`, `vite.*.config.ts`, `src/main/electron-main.ts`, `src/preload/index.ts`, `src/renderer/**`, `vitest.config.ts` | Add the launchable Electron/Vite/React scaffold and renderer test harness without changing Phase 1 core contracts. |
| `02-02` | `src/main/ipc/**`, `src/main/app/**`, `src/preload/**`, `tests/main/ipc/**`, `tests/preload/**` | Define narrow IPC channels, typed preload methods, request/response validation, and sanitized fake-backed DTOs. |
| `02-03` | `src/main/security/**`, `src/main/electron-main.ts`, `tests/security/**`, `tests/boundaries/**`, `eslint.config.mjs` | Lock BrowserWindow defaults, CSP, local-only loading, and renderer forbidden API/import checks. |
| `02-04` | `src/renderer/**`, `tests/renderer/**` | Render the Sessions-first workbench route through the preload API with explicit unsupported/unknown states. |

## Implementation Notes

- Treat `src/main/core/**` as the shared contract source of truth. New app-shell services may consume core exports from main, but renderer code consumes only preload DTOs.
- Keep renderer tests source-driven where Electron runtime is not yet automated; Phase 8 owns full Electron smoke and packaging coverage.
- Add shadcn only after the Vite/React shell exists, using the approved `b2Ciqm1BK` preset and official components only.
- Do not create controls for launching sessions, approving/rejecting work, terminal execution, PR creation, cleanup, deletion, reset, or arbitrary source mutation.

