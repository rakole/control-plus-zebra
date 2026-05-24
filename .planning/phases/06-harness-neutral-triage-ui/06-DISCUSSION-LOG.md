# Phase 6: Harness-Neutral Triage UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 06-harness-neutral-triage-ui
**Areas discussed:** Triage entrypoint and nav flow, Projects page truth before Phase 7 git work, Session drill-in vs Run Audit split, Diagnostics and warning voice

---

## Triage entrypoint and nav flow

| Option | Description | Selected |
|--------|-------------|----------|
| Overview first | Make `Overview` the triage landing page once the route exists, with summary metrics and links into deeper surfaces. | ✓ |
| Keep Sessions first | Preserve the current `/sessions` default even after Overview is implemented. | |
| Keep setup first | Continue routing users primarily to `Data Sources` until later phases. | |

**User's choice:** Autonomous mode selected the recommended default: `Overview first`.
**Notes:** [auto] Promoted `Overview`, `Projects`, and `Diagnostics` from placeholder nav items to real routes in the plan. Kept `Data Sources` available as the setup/config route rather than the permanent home screen. Locked an attention-first Overview instead of a deep dashboard that duplicates later detail pages.

---

## Projects page truth before Phase 7 git work

| Option | Description | Selected |
|--------|-------------|----------|
| Truthful placeholders | Build the Projects page now from normalized project/session/audit rollups and render git/GitHub fields as explicit `Unknown` or `Unsupported` until Phase 7 providers land. | ✓ |
| Defer Projects page | Wait until git/GitHub providers exist before shipping any Projects surface. | |
| Infer repo state | Guess branch/dirty/latest repo state from session evidence even without shared providers. | |

**User's choice:** Autonomous mode selected the recommended default: `Truthful placeholders`.
**Notes:** [auto] Locked cross-harness project grouping, latest triage truth from shared verification/audit, and honest repo-state placeholders instead of hidden columns or invented values.

---

## Session drill-in vs Run Audit split

| Option | Description | Selected |
|--------|-------------|----------|
| Separate triage and deep review | Keep `Sessions` as the fast triage list/detail surface, add a dedicated `Session Detail` timeline view, and make `Run Audit` its own evidence-grouped route or subview. | ✓ |
| Everything in Sessions | Expand the Sessions route until it contains the full timeline and audit review inline. | |
| Audit-first session view | Make Run Audit the primary per-session screen and treat timeline detail as secondary. | |

**User's choice:** Autonomous mode selected the recommended default: `Separate triage and deep review`.
**Notes:** [auto] Kept the current Sessions master/detail pattern as the precursor for quick triage. Locked chronology for Session Detail and grouped trust review for Run Audit so the UI does not mix timeline playback with evidence judgment.

---

## Diagnostics and warning voice

| Option | Description | Selected |
|--------|-------------|----------|
| Operator-style grouped diagnostics | Lead with grouped actionable diagnostics and warning summaries, while still showing raw diagnostic codes/messages inside each group. | ✓ |
| Raw evidence browser | Show low-level diagnostic records with minimal grouping or opinionated prioritization. | |
| Soft summary cards only | Keep diagnostics high-level and avoid exposing detailed warning evidence. | |

**User's choice:** Autonomous mode selected the recommended default: `Operator-style grouped diagnostics`.
**Notes:** [auto] Reused shared warning vocabulary across pages, kept sanitized renderer DTO boundaries, and aligned diagnostics groups with existing adapter/source/normalization/cache source areas plus capability-oriented trust gaps.

---

## the agent's Discretion

- Exact nesting and naming for new routes under the existing hash-router shell.
- Exact component/file split for Overview, Projects, Session Detail, Run Audit, and Diagnostics surfaces.
- Exact DTO/service decomposition for dashboard rollups, project summaries, session detail, run audit sections, and grouped diagnostics.
- Exact charting or summary presentation choices for Overview, provided they remain read-only and capability-aware.

## Deferred Ideas

- Saved filters and richer search across Projects and Sessions.
- Real git/GitHub provider-backed repo truth, which remains Phase 7 work.
- Token-cost reporting or richer model-usage analytics beyond capability-gated counts.
