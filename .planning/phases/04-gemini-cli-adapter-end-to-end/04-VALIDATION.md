---
phase: 04
slug: gemini-cli-adapter-end-to-end
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-23
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -- tests/adapters/gemini-cli` |
| **Full suite command** | `npm test && npm run test:boundaries && npm run typecheck` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- tests/adapters/gemini-cli`
- **After every plan wave:** Run `npm test && npm run test:boundaries && npm run typecheck`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | ADPT-03, ADPT-04 | T-04-01-01, T-04-01-02, T-04-01-03 | Gemini root validation and artifact discovery stay root-scoped, deterministic, and noise-tolerant. | unit | `npm run test -- tests/adapters/gemini-cli/gemini-discovery.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | ADPT-04, ADPT-06 | T-04-02-01, T-04-02-02, T-04-02-03 | Parsers continue through malformed rows, partial writes, and mixed sidecar formats with diagnostics instead of crashes. | unit | `npm run test -- tests/adapters/gemini-cli/gemini-parse.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | ADPT-05, ADPT-06 | T-04-03-01, T-04-03-02, T-04-03-03 | Normalization stays harness-neutral, preserves evidence-only output, and lazy-loads sidecars through indexed artifact reads only. | integration | `npm run test -- tests/adapters/gemini-cli/gemini-normalize.test.ts tests/main/core/scanner-cache.test.ts tests/main/ipc/session-view-model-service.test.ts` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 4 | ADPT-03, ADPT-04, ADPT-05, ADPT-06 | T-04-04-01, T-04-04-02, T-04-04-03 | Contract, golden, truth-rule, and edge-case fixtures prevent Gemini-specific drift or happy-path-only proof. | contract + regression | `npm run test -- tests/adapters/gemini-cli` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

- All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
