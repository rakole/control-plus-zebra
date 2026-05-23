# Phase 5: Shared Shell, Verification, and Run Audit - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement shared-core shell parsing, verification classification, and run-audit truth so any adapter that emits normalized shell/tool/file/session evidence can be judged consistently. This phase should turn existing adapter evidence into trusted shared conclusions about command failure, verification status, cancellation/incompletion, attention reasons, and capability gaps without introducing adapter-specific branches or broadening into live git/GitHub providers, control features, or UI-heavy triage work.

</domain>

<decisions>
## Implementation Decisions

### Exit-code truth and partial shell output
- **D-01:** Parsed shell exit code is authoritative when it conflicts with raw tool status.
- **D-02:** Hard verification failure requires an explicit nonzero exit code; text-only failure markers should lower confidence and add review signals, not independently force failed verification.
- **D-03:** Shared core should persist parsed command summaries, failure markers, and derived facts while keeping full stdout/stderr bodies lazy through output artifact loading.
- **D-04:** Missing or unreadable sidecar output should still yield a partial shell command record with lowered confidence and diagnostics rather than dropping the evidence or immediately collapsing the session to unknown.

### Verification coverage and rerun semantics
- **D-05:** Only `test`, `build`, `typecheck`, and `lint` intents count toward verification state in Phase 5.
- **D-06:** Verification should use the latest result per verification intent while preserving earlier failed attempts in audit evidence.
- **D-07:** Sessions with a final answer but no qualifying verification command must render verification as `not-run` and carry a `no-verification` attention reason.
- **D-08:** Unsupported and unknown shell-command capability states must stay explicit and must never be coerced to passed or clean verification.

### Audit precedence when signals conflict
- **D-09:** If a session is both cancelled and verification-failed, `cancelled` is the primary run-audit status and failed verification remains as an attention reason/evidence facet.
- **D-10:** A final answer with pending tool calls or post-claim tool activity should classify the run as `incomplete`, not merely `needs-review`.
- **D-11:** Dirty git after claimed completion should produce `needs-review` with `dirty-after-claim` attention rather than automatic verification failure.
- **D-12:** Parser warnings and missing sidecars should escalate to `needs-review` when core classification is still reliable; reserve top-level `unknown` for evidence gaps severe enough to block a trustworthy classification.

### Capability gaps and evidence fallback
- **D-13:** Shared-core verification and audit should trust capability snapshots in specificity order: session-observed first, then source, then adapter fallback.
- **D-14:** Missing capability should only force top-level `unknown` when it blocks the core conclusion being made; otherwise preserve the stronger classification and attach `capability-missing`.
- **D-15:** Phase 5 should not award a fully `clean` audit when evidence required for that claim is absent; if git context is unavailable, use `needs-review` with an explicit capability gap until later git evidence exists.
- **D-16:** Unsupported/unknown evidence states and their reason text must survive end-to-end through shared-core outputs and later view-model/UI surfaces.

### the agent's Discretion
- Exact shared-core module/file layout for shell parsing, verification, and audit logic, as long as it stays under `src/main/core/**` and keeps adapters evidence-only.
- Exact regexes/parsing heuristics for extracting exit codes, failure markers, and test summaries, as long as explicit nonzero exit codes remain the only hard verification-failure trigger.
- Exact field names for derived shell/verification/audit payloads added to internal shared-core layers, as long as they preserve adapter-neutral naming and explicit capability truth.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level product brief, architecture boundaries, stack, and GSD workflow constraints.
- `.planning/ROADMAP.md` - Phase 5 goal, success criteria, and the four planned work slices (`05-01` through `05-04`).
- `.planning/REQUIREMENTS.md` - Locked Phase 5 requirement set covering `AUDT-01` through `AUDT-09` and `TEST-04` through `TEST-06`.
- `.planning/PROJECT.md` - Core value, read-only V1 scope, explicit capability truth, and shared-core ownership rules.
- `.planning/STATE.md` - Current project position, carried-forward decisions, and the note that Phase 5 must resolve shell/verification/audit truth.

### Prior phase decisions that carry forward
- `.planning/phases/02-secure-desktop-shell-and-view-model-bridge/02-CONTEXT.md` - Locks typed preload/IPC/view-model boundaries and renderer safety rules that later audit surfaces must preserve.
- `.planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md` - Locks scanner/cache/source-registry/shared-orchestration boundaries that Phase 5 should extend rather than bypass.
- `.planning/phases/04-gemini-cli-adapter-end-to-end/04-CONTEXT.md` - Locks Gemini as evidence-only input, chat/sidecar truth rules, and the rule that shared verification/audit must sit above adapter output.

### Shell, verification, and audit source of truth
- `.spec/spec-from-5.5-revision-1.md` - Defines shared shell-command parsing responsibilities, verification rules, audit precedence, and attention-reason vocabulary.
- `.spec/additional-instructions.md` - Reinforces that tool success never overrides shell exit failure, adapters emit evidence not conclusions, and unsupported data must stay explicit.
- `.planning/research/ARCHITECTURE.md` - Shared-core ownership guidance for cross-adapter interpretation layers.
- `.planning/research/PITFALLS.md` - Highlights the Gemini/tool-status footgun, parser uncertainty, and the risk of flattening missing evidence into clean results.

### Existing shared seams to extend
- `src/main/core/model/entities.ts` - Current normalized `ShellCommandEvidence`, session, tool, file-mutation, and event shapes that Phase 5 must interpret without breaking adapter contracts.
- `src/main/adapters/gemini-cli/normalize.ts` - Existing Gemini mapping of `run_shell_command` evidence and file mutation evidence that shared-core parsing will consume.
- `src/main/core/ingestion/normalization-validator.ts` - Normalized-output validation seam that new shared interpretation layers must respect.
- `src/main/core/ingestion/session-merger.ts` - Cross-record merge seam where derived verification/audit inputs will be aggregated per session.
- `src/main/core/cache/file-backed-cache-store.ts` - File-backed normalized cache contract that Phase 5-derived facts must coexist with.
- `src/main/app/session-view-model-service.ts` - Current session summary/previews that later phases will extend with verification/audit truth instead of adapter-specific UI branches.

### Existing tests and guardrails
- `tests/adapters/gemini-cli/gemini-adapter.truth-rules.test.ts` - Existing evidence-only and capability-truth baseline that Phase 5 must preserve while adding shared conclusions elsewhere.
- `tests/contract/run-adapter-contract.ts` - Contract harness that already guards against leaking verification or audit conclusions out of adapters.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/main/adapters/gemini-cli/normalize.ts`: already emits shell-command evidence from `run_shell_command` and keeps Gemini-specific raw interpretation private.
- `src/main/core/model/entities.ts`: provides the current normalized shell/tool/file/session nouns that Phase 5 should build on rather than rename.
- `src/main/core/cache/file-backed-cache-store.ts`: provides the persistence seam for normalized records and any adjacent shared-core derived summaries.
- `src/main/core/ingestion/normalization-validator.ts` and `src/main/core/ingestion/session-merger.ts`: already validate and aggregate adapter output, making them natural handoff points for shared shell/verification/audit layers.
- `src/main/app/session-view-model-service.ts`: shows the current adapter-neutral summary surface where later verification/audit status can surface without provider branches.
- `tests/adapters/gemini-cli/gemini-adapter.truth-rules.test.ts`: already proves explicit unsupported/unknown states and evidence-only adapter behavior.

### Established Patterns
- Adapters emit evidence and diagnostics only; shared core owns conclusions.
- Capability truth is explicit at adapter, source, and session levels and must remain so through later layers.
- Full output bodies are intentionally lazy via output artifacts; normalized/cache records should prefer derived summaries over duplicated sidecar bodies.
- Current cache/merge/runtime flow aggregates normalized session evidence before the UI sees it, so Phase 5 should add interpretation after normalization rather than pushing logic back into adapters.
- Primary classification and subordinate attention reasons should coexist, preserving both the strongest status and the reasons a run still needs trust scrutiny.

### Integration Points
- Add shared-core shell parsing, verification classification, and audit modules under `src/main/core/**`, not under `src/main/adapters/**`.
- Feed derived per-session shell/verification/audit outputs from the merged normalized session graph so both fake and Gemini adapters inherit the same logic.
- Extend existing view-model services later with verification/audit summaries instead of introducing adapter- or harness-specific renderer branching.
- Add focused fixtures/tests for exit-code precedence, rerun semantics, cancellation precedence, missing sidecars, capability gaps, and clean-versus-needs-review boundaries.

</code_context>

<specifics>
## Specific Ideas

- Keep full shell output lazy; store parsed summaries, failure markers, and confidence-bearing derived facts instead of raw sidecar bodies in the normalized cache.
- Let the latest result per verification intent govern verification state, but preserve earlier failures as audit evidence so the run history remains explainable.
- Treat `clean` as a high bar: if a required evidence class such as git context is unavailable, preserve the capability gap explicitly instead of silently promoting the run to clean.
- Carry unsupported/unknown reason text all the way through future IPC and UI surfaces so missing evidence stays visible rather than flattening into zero values.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 05-shared-shell-verification-and-run-audit*
*Context gathered: 2026-05-24*
