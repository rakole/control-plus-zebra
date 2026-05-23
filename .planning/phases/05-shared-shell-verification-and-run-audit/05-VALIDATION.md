---
phase: 05
slug: shared-shell-verification-and-run-audit
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-24
---

# Phase 05 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -- tests/main/core && npm run typecheck` |
| **Full suite command** | `npm run lint && npm run typecheck && npm run test -- tests/main/core tests/adapters/fake-test tests/adapters/gemini-cli tests/main/ipc/session-view-model-service.test.ts && npm run test:boundaries` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- tests/main/core && npm run typecheck`
- **After every plan wave:** Run `npm run lint && npm run typecheck && npm run test -- tests/main/core tests/adapters/fake-test tests/adapters/gemini-cli tests/main/ipc/session-view-model-service.test.ts && npm run test:boundaries`
- **Before `$gsd-verify-work`:** `npm run lint && npm run typecheck && npm run test -- tests/main/core tests/adapters/fake-test tests/adapters/gemini-cli tests/main/ipc/session-view-model-service.test.ts && npm run test:boundaries` must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | AUDT-01, AUDT-02, AUDT-03, TEST-04 | T-05-01-01, T-05-01-02, T-05-01-03 | Shared shell parsing stays harness-neutral, scan-time, and exit-code-authoritative without leaking conclusions into adapter output. | unit + scanner integration | `npm run test -- tests/main/core/shell-command-parser.test.ts tests/main/core/scanner-cache.test.ts tests/adapters/gemini-cli/gemini-output-artifact.test.ts` | `src/main/core/shell/` | green |
| 05-02-01 | 02 | 2 | AUDT-04, AUDT-05, AUDT-06, TEST-05 | T-05-02-01, T-05-02-02, T-05-02-03 | Verification uses only qualifying intents, latest-result-per-intent semantics, and explicit supported/unsupported/unknown capability truth. | unit + scanner integration | `npm run test -- tests/main/core/verification-classifier.test.ts tests/main/core/scanner-cache.test.ts` | `src/main/core/verification/` | green |
| 05-03-01 | 03 | 3 | AUDT-07, AUDT-08, AUDT-09 | T-05-03-01, T-05-03-02, T-05-03-03 | Run audit applies the shared precedence order, preserves attention reasons, and keeps current IPC/session previews free of audit conclusion leakage. | unit + integration | `npm run test -- tests/main/core/run-audit-engine.test.ts tests/main/core/scanner-cache.test.ts tests/main/ipc/session-view-model-service.test.ts` | `src/main/core/audit/` | green |
| 05-04-01 | 04 | 4 | TEST-04, TEST-05, TEST-06 | T-05-04-01, T-05-04-02, T-05-04-03 | The fixture corpus and regression suite fail loudly on exit-code precedence drift, capability-gap flattening, or adapter/view-model conclusion leakage. | regression + boundaries | `npm run test -- tests/main/core tests/adapters/fake-test tests/adapters/gemini-cli tests/main/ipc/session-view-model-service.test.ts && npm run test:boundaries && npm run typecheck` | `tests/main/core/` | green |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All Phase 5 behaviors should have automated verification. No manual-only checks are expected in this phase.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing infrastructure references
- [x] No watch-mode flags
- [x] Feedback latency under 60 seconds
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
