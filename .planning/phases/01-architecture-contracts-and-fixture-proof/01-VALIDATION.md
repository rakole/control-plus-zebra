---
phase: 01
slug: architecture-contracts-and-fixture-proof
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 01 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run lint && npm run typecheck && npm run test` |
| **Estimated runtime** | ~25 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run test`
- **Before `$gsd-verify-work`:** `npm run lint && npm run typecheck && npm run test` must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | ARCH-02 | T-01-01 / T-01-02 | Shared-core workspace exists without Electron scope creep | typecheck | `npm run typecheck` | `package.json` | pending |
| 01-01-T2 | 01 | 1 | ARCH-03 | T-01-02 | Normalized entities require adapter/source identity where relevant | source + typecheck | `npm run typecheck` | `src/main/core/model/entities.ts` | pending |
| 01-01-T3 | 01 | 1 | ARCH-05 | T-01-01 | Adapter contract exposes lifecycle seams but no verification conclusions | source + typecheck | `npm run typecheck` | `src/main/core/adapter-contract/session-source-adapter.ts` | pending |
| 01-02-T1 | 02 | 2 | ADPT-02 | T-02-01 | Fake fixture remains non-Gemini-shaped and adapter-private | unit | `npm run test -- tests/adapters/fake-test/fake-adapter.smoke.test.ts` | `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json` | pending |
| 01-02-T2 | 02 | 2 | ADPT-01 | T-02-02 | Registry can expose bundled descriptor data without shared-core importing adapter internals | unit | `npm run test -- tests/adapters/fake-test/fake-adapter.smoke.test.ts` | `src/main/core/registry/register-bundled-adapters.ts` | pending |
| 01-03-T1 | 03 | 3 | TEST-01 | T-03-01 | Shared contract suite validates descriptor, capabilities, discovery, normalization, and diagnostics | unit | `npm run test -- tests/contract tests/adapters/fake-test` | `tests/contract/adapter-contract.test.ts` | pending |
| 01-03-T2 | 03 | 3 | TEST-02 | T-03-01 | Golden output diff catches normalization drift | golden | `npm run test -- tests/adapters/fake-test/fake-adapter.golden.test.ts` | `tests/fixtures/fake-test/phase1-session.normalized.json` | pending |
| 01-04-T1 | 04 | 3 | TEST-03 | T-04-01 | Core, renderer, and adapter folders cannot cross import forbidden boundaries | boundary | `npm run test:boundaries` | `tests/boundaries/import-boundaries.test.ts` | pending |
| 01-04-T2 | 04 | 3 | ARCH-07 | T-04-02 | Shared code rejects `Gemini*` names and provider-specific behavior leaks | boundary + lint | `npm run lint && npm run test:boundaries` | `tests/boundaries/shared-naming.test.ts` | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `package.json` - install TypeScript, Vitest, Zod, and ESLint plus scripts for `typecheck`, `test`, `test:boundaries`, and `lint`
- [ ] `tsconfig.json` - compile `src/**` and `tests/**` with explicit path roots
- [ ] `vitest.config.ts` - Node-mode Vitest config for shared-core and adapter tests
- [ ] `eslint.config.mjs` - import-boundary and naming checks

---

## Manual-Only Verifications

All Phase 1 behaviors have automated verification. No manual-only checks are expected in this phase.

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing infrastructure references
- [ ] No watch-mode flags
- [ ] Feedback latency under 30 seconds
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
