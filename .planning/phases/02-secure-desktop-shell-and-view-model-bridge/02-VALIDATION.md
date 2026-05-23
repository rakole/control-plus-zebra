---
phase: 02
slug: secure-desktop-shell-and-view-model-bridge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 02 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest plus renderer test harness additions during Wave 1 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run lint && npm run typecheck && npm run test` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run lint && npm run typecheck && npm run test`
- **Before `$gsd-verify-work`:** `npm run lint && npm run typecheck && npm run test` must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | DESK-01 | T-02-01 / T-02-02 | Electron/Vite/React scaffold integrates with the existing strict repo without weakening TypeScript or boundary checks | typecheck | `npm run typecheck` | `package.json` | pending |
| 02-01-T2 | 01 | 1 | DESK-06 | T-02-02 | Main process loads only local app content and keeps packaged/local entrypoints explicit | source + typecheck | `npm run typecheck` | `src/main` | pending |
| 02-02-T1 | 02 | 2 | DESK-03 | T-02-03 | Preload exposes one typed method per allowed IPC operation and never exposes `ipcRenderer` or a generic invoke bridge | unit | `npm run test -- tests/main/ipc tests/preload` | `src/preload` | pending |
| 02-02-T2 | 02 | 2 | DESK-04 | T-02-03 | IPC handlers validate payloads and map shared-core data into sanitized renderer DTOs only | unit | `npm run test -- tests/main/ipc` | `src/main/ipc` | pending |
| 02-03-T1 | 03 | 2 | DESK-02 | T-02-02 | BrowserWindow defaults, sandboxing, and CSP keep renderer execution restricted | boundary + unit | `npm run lint && npm run test -- tests/security tests/boundaries` | `src/main` | pending |
| 02-03-T2 | 03 | 2 | DESK-05 | T-02-03 / T-02-04 | Renderer cannot import adapter-private/main-process internals or call forbidden APIs | boundary | `npm run test:boundaries` | `tests/boundaries` | pending |
| 02-04-T1 | 04 | 3 | DESK-01 | T-02-04 | Sessions-first shell route renders through the real preload/API seam instead of renderer-local mocks | renderer | `npm run test -- tests/renderer` | `src/renderer` | pending |
| 02-04-T2 | 04 | 3 | DESK-04 | T-02-04 | Session view models preserve unsupported/unknown capability truth in the first route | renderer + unit | `npm run test -- tests/renderer tests/main/ipc` | `src/renderer` | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] Electron Forge + Vite scaffold files exist and are wired into `package.json`
- [ ] Renderer test harness exists for `src/renderer/**` coverage
- [ ] IPC/preload test folders exist for main/preload boundary verification
- [ ] Security and CSP assertions have at least one automated test entrypoint

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| App window launches into the local shell with the Sessions-first route visible | DESK-01 | Full Electron smoke automation is deferred to a later hardening phase | Start the app with the project’s Phase 2 dev command, verify one local window opens, and confirm the shell renders the Sessions-oriented chrome without remote navigation |

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing infrastructure references
- [ ] No watch-mode flags
- [ ] Feedback latency under 45 seconds
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
