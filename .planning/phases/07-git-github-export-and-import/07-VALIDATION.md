---
phase: 07
slug: git-github-export-and-import
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-24
---

# Phase 07 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest with `node` and `renderer` projects |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -- --project node tests/main/core/scanner-cache.test.ts tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/run-audit-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx && npm run typecheck` |
| **Full suite command** | `npm run lint && npm run typecheck && npm run test && npm run test:boundaries` |
| **Estimated runtime** | ~105 seconds |

---

## Sampling Rate

- **After every task commit:** Run the smallest affected plan command plus `npm run typecheck`
- **After every plan wave:** Run `npm run test -- --project node tests/main/core tests/main/ipc` and `npm run test -- --project renderer tests/renderer`, then `npm run test:boundaries`
- **Before `$gsd-verify-work`:** `npm run lint && npm run typecheck && npm run test && npm run test:boundaries` must be green
- **Max feedback latency:** 105 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | GIT-01, GIT-02 | T-07-01-01, T-07-01-02, T-07-01-03 | Shared git snapshots are project-scoped, root-confidence-gated, fixed-command-only, and degrade to explicit Unknown or Unsupported states instead of fake clean repo truth. | node + renderer | `npm run test -- --project node tests/main/core/git-snapshot-provider.test.ts tests/main/core/scanner-cache.test.ts tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/run-audit-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx` | `src/main/core/git/git-snapshot-provider.ts` | pending |
| 07-02-01 | 02 | 2 | GIT-03 | T-07-02-01, T-07-02-02, T-07-02-03 | Shared GitHub snapshots run only after validated git context, use fixed read-only `gh` commands, and surface No Matching PR, Unknown, or Unsupported states without blocking triage. | node + renderer | `npm run test -- --project node tests/main/core/github-snapshot-provider.test.ts tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/run-audit-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx` | `src/main/core/github/github-snapshot-provider.ts` | pending |
| 07-03-01 | 03 | 2 | GIT-04, GIT-06 | T-07-03-01, T-07-03-02, T-07-03-03 | Export archives are harness-neutral, normalized-only by default, raw-inclusive only through indexed allowlisted artifacts, and always record privacy-warning acceptance and raw inclusion in the manifest. | node + renderer | `npm run test -- --project node tests/main/core/archive-exporter.test.ts tests/main/ipc/ipc-handlers.test.ts tests/main/ipc/run-audit-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/projects-route.test.tsx tests/renderer/run-audit-route.test.tsx` | `src/main/core/archive/archive-exporter.ts` | pending |
| 07-04-01 | 04 | 3 | GIT-05 | T-07-04-01, T-07-04-02, T-07-04-03 | Imported archives register as persistent read-only sources, reuse the existing runtime and cache seams, and never re-enable validate, scan, watch, git, or GitHub operations against the host machine. | node + renderer | `npm run test -- --project node tests/main/core/archive-importer.test.ts tests/main/core/source-registry.test.ts tests/main/ipc/data-sources-view-model-service.test.ts tests/main/ipc/data-sources-ipc.test.ts tests/main/ipc/session-view-model-service.test.ts && npm run test -- --project renderer tests/renderer/data-sources-route.test.tsx tests/renderer/sessions-route.test.tsx` | `src/main/core/archive/archive-importer.ts` | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `tests/main/core/git-snapshot-provider.test.ts` - read-only git provider coverage for root-confidence gating, remote/top-level mismatch, and timeout degradation
- [ ] `tests/main/core/github-snapshot-provider.test.ts` - read-only `gh` coverage for availability, auth gaps, no-match PR, and timeout semantics
- [ ] `tests/main/core/archive-exporter.test.ts` - archive manifest, normalized-only default, and raw-artifact allowlist coverage
- [ ] `tests/main/core/archive-importer.test.ts` - archive manifest parsing, source registration, cache hydration, and read-only metadata coverage
- [ ] `tests/main/ipc/ipc-handlers.test.ts` export/import cases - typed IPC and sanitized error handling for archive operations
- [ ] `tests/renderer/projects-route.test.tsx`, `tests/renderer/run-audit-route.test.tsx`, and `tests/renderer/data-sources-route.test.tsx` extensions - route-level truth-state, privacy-warning, and imported-source rendering coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Export confirmation keeps `Normalized Only` as the default and shows the raw-data privacy warning with the checkbox unchecked | GIT-04, GIT-06 | Renderer tests can prove labels and state, but not final desktop dialog behavior and operator clarity | Launch the app, open Projects and Run Audit export actions, confirm the warning copy is visible, the raw checkbox starts unchecked, and export never starts until the user confirms |
| Imported archives appear as read-only sources with disabled live actions in the packaged shell | GIT-05 | Automated tests cover DTOs and route logic, but not the full main-owned picker flow and final shell interaction | Launch the app, import a real archive, confirm the source appears in Data Sources with Imported Archive and Read Only labels, and verify validate, scan, watch, git, and GitHub actions stay unavailable |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or explicit Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing infrastructure references
- [x] No watch-mode flags
- [x] Feedback latency under 105 seconds
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
