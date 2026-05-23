# Phase 5: Shared Shell, Verification, and Run Audit - Research

**Researched:** 2026-05-24
**Status:** Ready for planning

## Executive Summary

Phase 5 should add a shared-core interpretation pipeline that sits after adapter normalization and before cache persistence. The repo already has the right evidence inputs for this: adapters emit `ShellCommandEvidence`, `ToolCall`, `OutputArtifact`, `FileMutationEvidence`, diagnostics, lifecycle state, and explicit capability snapshots; the scanner already owns the per-source orchestration point where normalization, validation, raw-artifact indexing, and cache writes happen. The safest path is to keep adapters evidence-only, run shell/verification/audit derivation in shared core during `Scanner.scanSource()`, and persist only derived summaries and truth classifications instead of raw sidecar bodies.

Two live codebase constraints matter for planning. First, Gemini output-artifact loading currently depends on an in-memory binding map populated during `normalize()`, so any shell parsing that waits until later cache reads will lose the artifact association and become brittle. Second, the current `ShellCommandEvidence` shape does not explicitly link shell commands back to tool calls or output artifacts, which makes harness-neutral shell parsing harder than it needs to be. The plan should therefore treat scan-time derivation and a small shared evidence-linking upgrade as core Phase 5 work, not incidental cleanup.

The phase should remain headless. Session IPC/view-model tests currently forbid `verificationStatus`, `runAuditStatus`, and `attentionReasons`, and the roadmap assigns user-facing audit surfaces to Phase 6. Phase 5 succeeds when the shared core can truthfully classify shell commands, verification state, and run-audit status from normalized evidence and when focused tests prove the truth rules, especially the Gemini footgun where tool success does not equal shell success.

## What Phase 5 Must Prove

### Proof obligations from roadmap and requirements

- Shared core can turn `ShellCommandEvidence` into parsed shell-command facts with command text, cwd, output source, intent, failure state, parsed failures, confidence, and diagnostics.
- Explicit nonzero shell exit-code evidence remains authoritative even when the originating tool call reports success.
- Verification state is derived only from shared shell interpretation, not from adapter tool status or UI heuristics.
- Only `test`, `build`, `typecheck`, and `lint` count toward verification state in Phase 5; `install`, `git`, and other commands remain audit evidence but not verification truth.
- Sessions with no qualifying verification command classify as `not-run`, not passed.
- Sessions without usable shell capability classify verification as `unknown` or `unsupported`, never passed.
- Run Audit covers `active`, `cancelled`, `verification-failed`, `incomplete`, `needs-review`, `clean`, and `unknown` with explicit attention reasons.
- Missing or unsupported evidence must remain explicit. Lack of git context, unreadable sidecars, parser warnings, or missing capability cannot silently collapse into `clean`.

### Current code realities that shape the solution

- `src/main/core/ingestion/scanner.ts` is the natural orchestration seam because it already has the adapter instance, scan-scoped `safeFilesystem`, raw artifacts, normalized output, and cache write path in one place.
- `src/main/adapters/gemini-cli/index.ts` exposes `loadOutputArtifact()`, but the lookup depends on a module-local `outputArtifactBindings` map populated during `normalize()`. That map is not persisted in cache, so post-scan artifact resolution is not trustworthy yet.
- `src/main/core/cache/file-backed-cache-store.ts` persists only adapter-normalized evidence today. Derived shell/verification/audit results will need an adjacent persisted shape rather than being stuffed into `AdapterNormalizationResult`.
- `src/main/app/session-view-model-service.ts` and `tests/main/ipc/session-view-model-service.test.ts` intentionally expose sanitized evidence counts and capability badges only. They are not ready for user-facing audit conclusions yet.
- `src/main/core/model/entities.ts` defines `ShellCommandEvidence` without explicit `toolCallId`, `artifactIds`, or raw tool-status linkage, which makes shell-to-output correlation harder than the Phase 5 truth rules justify.

## Scope Fences

- Do not move verification or run-audit conclusions into adapter output. `AdapterNormalizationResult` must remain evidence-only so contract and boundary tests continue to enforce the shared-core boundary.
- Do not build Git or GitHub providers in Phase 5. Git dirty-state truth should be modeled as a capability gap until Phase 7 provides real read-only git evidence.
- Do not broaden renderer routes or public IPC payloads just to surface audit fields early. Keep Phase 5 focused on shared-core interpretation and persistence.
- Do not persist full stdout/stderr bodies into normalized cache records. Persist parsed summaries, failure markers, derived facts, and diagnostics while leaving full artifact bodies lazy.
- Do not rely on Gemini-specific naming conventions or event-order quirks when a small harness-neutral shared field can make the relationship explicit.

## Recommended Implementation Shape

### 1. Add a shared interpretation layer after normalization, before cache write

Create Phase 5 modules under shared core, following the repo/spec structure:

- `src/main/core/shell/`
- `src/main/core/verification/`
- `src/main/core/audit/`

The scanner should call this shared layer immediately after `validateNormalizedResult(normalized)` succeeds and before writing the cache record. That keeps the derivation:

- adapter-neutral,
- scan-scoped,
- able to use `adapter.loadOutputArtifact()` while adapter-local bindings are still live,
- and independent from later renderer/UI timing.

### 2. Persist derived session insights adjacent to normalized evidence

The cleanest boundary is to keep adapter output untouched and extend cache records with a sibling derived payload, for example a persisted per-session analysis object containing:

- parsed shell command summaries,
- verification results,
- run-audit results,
- attention reasons,
- shell/audit diagnostics,
- and any confidence-degradation markers.

This keeps the adapter contract pure while still satisfying the Phase 5 decision to persist parsed facts and derived truth. `mergeNormalizedResults()` or an adjacent merge helper can later merge these derived per-session snapshots across cache records without changing adapter-owned shapes.

### 3. Tighten shell evidence linkage before building parsers

The smallest safe shared-model upgrade is to enrich `ShellCommandEvidence` with optional harness-neutral linkage fields such as:

- `toolCallId?: ToolCallId`
- `artifactIds?: OutputArtifactId[]`
- `rawToolStatus?: ToolCallStatus`

Backfill those fields in both the fake and Gemini normalizers. This avoids brittle shared-core heuristics like pairing shell commands to tool calls by timestamp or native-id naming patterns. If the team wants to avoid contract growth, the fallback is a scan-time correlation helper that joins `ShellCommandEvidence` to `ToolCall` and `OutputArtifact` using shared `eventId` and adapter output structure, but that should be treated as second-best because it bakes in more assumptions.

### 4. Parse shell commands during scan while artifact bindings are available

Phase 5 should intentionally derive shell truth during `scanSource()` instead of during later cache reads. That has three benefits:

- Gemini sidecars can be loaded safely through the adapter's existing `loadOutputArtifact()` seam.
- Parsed exit codes, output previews, failure markers, and diagnostics can be persisted once and reused.
- Missing/unreadable sidecars can immediately become shared-core diagnostics and confidence drops instead of silent later misses.

This also means Phase 5 does not need a full generic post-cache artifact resolver before planning can proceed. A reusable artifact-loading service may still be worth adding as future support infrastructure, but it is not the shortest safe route to truthful shell classification.

### 5. Keep the shell parser small and composable

`05-01` should likely split into a few focused helpers:

- `shellIntentClassifier`
- `shellExitCodeParser`
- `testOutputParser` or `parsedFailureExtractor`
- `shellCommandParser`

Recommended rules:

- Explicit nonzero exit code is the only hard failure trigger.
- Text-only failure markers create parsed failures, lower confidence, and later attention reasons, but do not independently force failed verification.
- Output source should distinguish whether truth came from inline summary, loaded artifact text, both, or missing output.
- Verification intent classification should recognize `test`, `build`, `typecheck`, `lint`, `install`, `git`, `other`, and `unknown`, with only the first four affecting verification state.

### 6. Build verification as a per-intent classifier, not a last-command shortcut

`05-02` should consume parsed shell commands and produce one shared `VerificationResult` per session. Recommended behavior:

- Track the latest result per verification intent (`test`, `build`, `typecheck`, `lint`) so successful reruns can recover verification state.
- Preserve earlier failures in audit evidence even when a later rerun passes.
- Return `not-run` when a final answer exists but no qualifying verification command ran.
- Return `unknown` or `unsupported` when shell capability is missing or insufficient.
- Decrease confidence when output artifacts are missing or unreadable.

This matches the Phase 5 context decision that reruns should recover the verification headline while earlier failures stay visible to Run Audit.

### 7. Keep Run Audit conservative and capability-aware

`05-03` should treat Run Audit as a truth table over:

- session lifecycle (`active`, `completed`, `cancelled`, `unknown`),
- final-answer / claimed-complete evidence,
- tool activity after a claimed completion,
- pending tool calls,
- verification result,
- file mutations,
- parser diagnostics,
- capability gaps,
- and git support availability.

Recommended precedence:

1. `active`
2. `cancelled`
3. `verification-failed`
4. `incomplete`
5. `needs-review`
6. `clean`
7. `unknown`

Use `unknown` only when the core conclusion itself is blocked. Otherwise preserve the strongest known classification and attach attention reasons such as `capability-missing`, `sidecar-missing`, `parser-warning`, or `no-verification`.

For `clean`, keep the bar high:

- If git context is unavailable, do not mark the run clean.
- Use `needs-review` plus `capability-missing` until Phase 7 provides real git evidence.
- Current adapter-backed fixtures should therefore bias toward `needs-review` rather than `clean` unless tests inject explicit supported git evidence into direct engine inputs.

### 8. Derive "claimed complete" conservatively

The current normalized model has assistant messages and lifecycle evidence, but not an explicit final-answer marker. The shared-core heuristic should therefore be deliberately strict:

- Require a terminal non-empty assistant message.
- Require no known later tool/file/shell activity after that claim.
- If the evidence is ambiguous, set `agentClaimedCompleted` to `unknown`, not `true`.

This keeps incomplete and cancelled runs honest instead of over-claiming successful completion based on any assistant message.

## Recommended Plan Split

| Plan | Wave | Why it exists |
|------|------|----------------|
| `05-01` | 1 | Add shared shell parsing modules, scan-time shell derivation plumbing, and any minimal `ShellCommandEvidence` linkage fields needed to keep parsing harness-neutral. |
| `05-02` | 2 | Add verification classifier, per-intent latest-result semantics, no-verification handling, and unsupported/unknown capability truth. |
| `05-03` | 3 | Add run-audit engine, attention reasons, completion heuristics, and conservative clean-vs-needs-review precedence with git-capability gating. |
| `05-04` | 4 | Add focused fixtures and tests for exit-code precedence, reruns, missing sidecars, capability gaps, cancelled/incomplete truth, and clean classification edge cases. |

### Dependency rationale

- `05-01` must happen first because both verification and run audit depend on parsed shell-command facts rather than raw evidence rows.
- `05-02` should land before `05-03` because Run Audit should consume a shared verification result instead of re-deriving verification ad hoc.
- `05-03` can stay headless and internal because Phase 6 owns public audit presentation.
- `05-04` should lock the full truth table only after the shell, verification, and audit modules have settled.

## Validation Architecture

### Test layers this phase should add

- **Pure unit tests** for `shellExitCodeParser`, `shellIntentClassifier`, output/failure parsing, `verificationClassifier`, and `runAuditEngine`.
- **Scanner integration tests** that prove shared derivation runs during scan, persists derived summaries, and survives reload through cache records.
- **Adapter-backed fixture tests** using fake fixtures for synthetic truth-table cases and Gemini fixtures for real artifact/sidecar/cancellation footguns.
- **Truth-rule tests** that keep boundary expectations intact: adapters still emit evidence only, and shared-core conclusions do not leak back into adapter-normalized payloads.

### How to split fixture responsibility

- Use the fake adapter for highly controlled Phase 5 cases: explicit nonzero exit codes, reruns by intent, post-claim tool activity, pending tool calls, and sessions with no verification.
- Use Gemini fixtures to prove realistic sidecar loading, missing sidecars, parse diagnostics, cancelled sessions, and the tool-success-vs-shell-success footgun.
- Use direct engine unit inputs for `clean` because current real adapters report `gitContextCapture` as unsupported, which should intentionally block a clean audit headline.

### Specific proof points to cover

- Nonzero exit code beats tool-call success.
- Text-only failure markers degrade confidence and produce parsed failures without forcing hard verification failure by themselves.
- Latest verification result per intent wins, but earlier failures remain in audit evidence.
- No verification command produces `not-run` plus `no-verification`.
- Missing shell capability produces `unknown` or `unsupported`, not `passed`.
- Cancelled plus failed verification resolves to `cancelled` primary with `failed-verification` attention.
- Final answer plus pending or later tool activity resolves to `incomplete`.
- Missing sidecars and parser warnings degrade confidence and usually produce `needs-review`, not silent clean success.
- `clean` is impossible when git evidence is absent.

## Risks To Watch During Execution

### Risk 1: shell-to-artifact correlation stays implicit

If shared core has to guess shell-command artifact ownership from event ordering or naming conventions, the Phase 5 parser will quietly become Gemini-shaped. Prefer explicit shared linkage fields or a scan-time correlation helper that is clearly documented and tested.

### Risk 2: derived conclusions leak into adapter contracts

It will be tempting to tack `verificationStatus` or `runAuditStatus` onto normalized session objects because those are already flowing through cache and session services. That would violate the evidence-only adapter boundary and fight existing contract tests.

### Risk 3: `clean` is awarded without real git evidence

Current adapter capabilities report git context as unsupported. If the audit engine still emits `clean`, it will violate the product's truthfulness goal. Keep `clean` gated behind explicit supporting evidence and treat missing git context as a review gap.

### Risk 4: final-answer heuristics overclaim completion

Assistant messages can appear before later tools, cancellation, or missing verification. If "any assistant message" becomes "claimed complete," incomplete runs will be overstated. Keep the heuristic narrow and fall back to `unknown` when the transcript is ambiguous.

### Risk 5: artifact loading is designed for post-cache use too early

The current Gemini artifact-loader binding is scan-scoped. If Phase 5 assumes artifact text can always be reloaded from cached normalized records without adding a new persisted link layer, output parsing will be flaky across reloads and restarts.

## Planning Assumptions

- Phase 5 may safely extend internal shared-core/cache shapes even if public IPC/view-model contracts stay unchanged.
- A small shared-model upgrade to `ShellCommandEvidence` is acceptable if it remains harness-neutral and improves shared parsing correctness.
- The first Phase 5 implementation can compute and persist derived shell/verification/audit summaries during scan without solving every future lazy-artifact-read workflow.
- Current session summaries/previews should remain sanitized and audit-light until Phase 6 exposes richer triage surfaces.
- `clean` classification will need direct engine tests with synthetic git support until the real read-only git provider lands in Phase 7.

---
*Research completed: 2026-05-24*
*Ready for planning: yes*
