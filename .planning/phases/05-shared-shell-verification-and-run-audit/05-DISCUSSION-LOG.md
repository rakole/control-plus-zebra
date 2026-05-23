# Phase 5: Shared Shell, Verification, and Run Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 05-shared-shell-verification-and-run-audit
**Areas discussed:** Exit-code truth and partial shell output, Verification coverage and rerun semantics, Audit precedence when signals conflict, Capability gaps and evidence fallback
**Execution mode:** Non-interactive. Recommended options were selected per explicit user instruction.

---

## Exit-code truth and partial shell output

### Question 1

| Option | Description | Selected |
|--------|-------------|----------|
| Parsed exit code is authoritative | Shared truth rule that prevents tool-success masking a failed shell command. | ✓ |
| Tool status is authoritative | Simpler, but repeats the Gemini footgun the product is meant to correct. | |
| Treat every conflict as unknown | Cautious, but discards clear failure signals. | |

**User's choice:** Parsed exit code is authoritative
**Notes:** Selected as the recommended option for the non-interactive run.

### Question 2

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit exit code for hard failure | Keep hard verification failure tied to explicit nonzero exit code; treat text-only failure as a low-confidence warning or review signal. | ✓ |
| Failure text alone can fail verification | Aggressive, but risky across harnesses. | |
| Ignore text-only failure markers | Simple, but hides obvious problems. | |

**User's choice:** Explicit exit code for hard failure
**Notes:** This preserves a strict truth rule while still surfacing suspicious output as lower-confidence audit evidence.

### Question 3

| Option | Description | Selected |
|--------|-------------|----------|
| Persist summaries, keep full output lazy | Store derived shell facts while keeping full output in lazy-loaded artifacts. | ✓ |
| Persist full stdout and stderr bodies in cache | Easier for UI later, but bloats cache and duplicates sidecars. | |
| Persist only command text and exit code | Lean, but too thin for audit evidence. | |

**User's choice:** Persist summaries, keep full output lazy
**Notes:** Aligns with the existing output-artifact loading pattern from Phase 4.

### Question 4

| Option | Description | Selected |
|--------|-------------|----------|
| Emit partial command with diagnostics | Preserve evidence with lowered confidence when sidecar output is missing or unreadable. | ✓ |
| Drop the shell command entirely | Avoids ambiguity, but throws away evidence. | |
| Mark the whole session unknown immediately | Safe, but too blunt. | |

**User's choice:** Emit partial command with diagnostics
**Notes:** Keeps the audit explainable without overstating certainty.

---

## Verification coverage and rerun semantics

### Question 1

| Option | Description | Selected |
|--------|-------------|----------|
| Only test/build/typecheck/lint count | Keeps verification scoped to commands that actually prove readiness. | ✓ |
| Include install commands too | Can catch setup failures, but mixes preparation with verification. | |
| Any shell command can affect verification | Broad, but noisy. | |

**User's choice:** Only test/build/typecheck/lint count
**Notes:** Chosen to keep verification precise and adapter-neutral.

### Question 2

| Option | Description | Selected |
|--------|-------------|----------|
| Latest result per intent wins | Preserve earlier failures in audit evidence, but let a later successful rerun of the same intent recover verification state. | ✓ |
| Any earlier failure poisons the session forever | Conservative, but punishes successful reruns. | |
| Only the single last verification command matters | Simple, but loses coverage nuance across intents. | |

**User's choice:** Latest result per intent wins
**Notes:** This balances truthful recovery with historical traceability.

### Question 3

| Option | Description | Selected |
|--------|-------------|----------|
| Verification = not-run with attention | Explicitly flag the missing verification step when a final answer exists. | ✓ |
| Verification = passed if no diagnostics exist | Misleading. | |
| Verification = unknown for every such session | Too coarse when shell support exists. | |

**User's choice:** Verification = not-run with attention
**Notes:** This matches the roadmap and spec truth rule.

### Question 4

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve unsupported vs unknown explicitly | Keep capability truth visible and never infer passed. | ✓ |
| Collapse both to not-run | Simpler, but hides capability truth. | |
| Treat missing capability as clean | Unsafe. | |

**User's choice:** Preserve unsupported vs unknown explicitly
**Notes:** This keeps Phase 5 aligned with existing capability-badge semantics.

---

## Audit precedence when signals conflict

### Question 1

| Option | Description | Selected |
|--------|-------------|----------|
| Cancelled primary, failed-verification as attention | Preserves the spec's precedence while keeping the failure visible. | ✓ |
| Verification-failed primary | Makes tests the main headline. | |
| Needs-review primary | Treats conflict itself as the top-level result. | |

**User's choice:** Cancelled primary, failed-verification as attention
**Notes:** Chosen to preserve a stable precedence order across adapters.

### Question 2

| Option | Description | Selected |
|--------|-------------|----------|
| Incomplete primary | Pending tool calls or post-claim activity mean the run is not actually settled. | ✓ |
| Needs-review primary | Softer, but understates unresolved work. | |
| Clean if the final answer sounds confident | Unsafe. | |

**User's choice:** Incomplete primary
**Notes:** This protects the product's "claimed done vs reality" wedge.

### Question 3

| Option | Description | Selected |
|--------|-------------|----------|
| Needs-review with dirty-after-claim | Dirty git is trust-relevant, but not the same thing as failed verification. | ✓ |
| Automatic failure | Too strict for generated docs or known staged work. | |
| Ignore git dirtiness unless tests fail | Misses trust risk. | |

**User's choice:** Needs-review with dirty-after-claim
**Notes:** Keeps git truth visible without conflating it with build/test outcomes.

### Question 4

| Option | Description | Selected |
|--------|-------------|----------|
| Needs-review when classification is still possible; unknown only when evidence is too incomplete | Keeps the audit conservative without discarding usable evidence. | ✓ |
| Always unknown | Too blunt. | |
| Never affect top-level audit if some evidence exists | Hides parser risk. | |

**User's choice:** Needs-review when classification is still possible; unknown only when evidence is too incomplete
**Notes:** This preserves a meaningful distinction between degraded confidence and blocked classification.

---

## Capability gaps and evidence fallback

### Question 1

| Option | Description | Selected |
|--------|-------------|----------|
| Session-observed first, then source, then adapter | Uses the most specific truth available. | ✓ |
| Adapter descriptor only | Easy, but ignores session-level truth. | |
| Source capability only | Better than adapter-only, but still misses observed session gaps. | |

**User's choice:** Session-observed first, then source, then adapter
**Notes:** Matches the existing three-level capability model.

### Question 2

| Option | Description | Selected |
|--------|-------------|----------|
| Unknown only when capability gap blocks the core conclusion | Otherwise preserve the stronger status and attach capability-missing attention. | ✓ |
| Always unknown whenever any capability is missing | Too coarse. | |
| Never unknown; always needs-review | Can overstate certainty. | |

**User's choice:** Unknown only when capability gap blocks the core conclusion
**Notes:** This keeps the audit conservative without erasing stronger confirmed states.

### Question 3

| Option | Description | Selected |
|--------|-------------|----------|
| No fully clean status without the required evidence | Use needs-review with an explicit capability gap until git evidence exists. | ✓ |
| Clean based on shell and messages alone | Optimistic. | |
| Always unknown whenever git is unavailable | Too blunt. | |

**User's choice:** No fully clean status without the required evidence
**Notes:** Chosen to keep `clean` as a high-confidence label rather than a best-effort guess.

### Question 4

| Option | Description | Selected |
|--------|-------------|----------|
| Surface explicit unsupported/unknown states and reason text end-to-end | Keeps missing evidence visible in future IPC and UI layers. | ✓ |
| Collapse to zero/empty values and mention gaps only in diagnostics | Hides truth at the main surface. | |
| Hide unsupported capabilities unless the user opens a debug panel | Too easy to miss. | |

**User's choice:** Surface explicit unsupported/unknown states and reason text end-to-end
**Notes:** This carries Phase 1-4 truthfulness decisions forward into later UI work.

---

## the agent's Discretion

- Exact shared-core module/file layout for shell parsing, verification, and audit logic, as long as it stays under `src/main/core/**`.
- Exact exit-code, failure-marker, and summary-parsing heuristics, as long as explicit nonzero exit codes remain the only hard verification-failure trigger.
- Exact field names for derived shell/verification/audit payloads added in shared core, as long as they stay harness-neutral and preserve explicit capability truth.

## Deferred Ideas

None - discussion stayed within phase scope.
