# Phase 1: Architecture Contracts and Fixture Proof - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 1-Architecture Contracts and Fixture Proof
**Areas discussed:** Contract surface, Normalized model depth, Fake adapter proof style, Boundary enforcement

---

## Contract surface

| Option | Description | Selected |
|--------|-------------|----------|
| Phase-1 core only | Define only the milestone-needed contract surface: descriptor, capabilities, source validation/discovery hooks, raw artifact discovery/parsing, normalization, and diagnostics. | ✓ |
| Core + near-future seams | Include the Phase-1 core plus placeholders for likely next seams like watch plans and output artifact loading. | |
| Full long-term contract now | Model the broad long-term contract, including later-phase surfaces, from the beginning. | |

**User's choice:** Phase-1 core only
**Notes:** Follow-up decisions locked within this area: keep the explicit lifecycle hooks (`validateSourceRoot`, `discoverSources`, `discoverArtifacts`, `parseArtifact`, `normalize`); make capabilities mandatory and structured from day one; and use async/stream-friendly method signatures immediately.

---

## Normalized model depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full Phase-1 proof model | Define the real shared nouns now: project, session, event, message, tool call, shell command evidence, output artifact, diagnostics, capabilities, IDs, and confidence. | ✓ |
| Core session model only | Focus first on projects, sessions, events, and diagnostics; add the rest later. | |
| Very thin proof model | Normalize the minimum needed to prove the adapter path, then grow the model phase by phase. | |

**User's choice:** Full Phase-1 proof model
**Notes:** Follow-up decisions locked within this area: shared IDs should be deterministic from adapter/source/native identity; diagnostics and confidence are first-class model fields; and evidence must stay clearly separated from later shared-core conclusions like verification or run-audit states.

---

## Fake adapter proof style

| Option | Description | Selected |
|--------|-------------|----------|
| One small but representative fixture | Use one deterministic fake fixture that still exercises the shared model shape end to end. | ✓ |
| Tiny fixture set | Use 2-3 fake fixtures to cover clean, capability-gap, and diagnostic cases earlier. | |
| Happy path only | Keep the fake proof as narrow as possible and leave most truth-state coverage to later phases. | |

**User's choice:** One small but representative fixture
**Notes:** Follow-up decisions locked within this area: the fixture should prove the contract shape rather than exhaustively covering every capability state; the fake raw format should stay simple and intentionally non-Gemini-shaped; and golden normalized output should be the primary regression-proof artifact.

---

## Boundary enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Both lint and tests from Phase 1 | Use fast feedback through lint/import rules and a hard backstop through automated boundary tests. | ✓ |
| Tests only for Phase 1 | Rely on explicit boundary tests first and add lint once the scaffold settles. | |
| Lint only for Phase 1 | Use import rules initially and add deeper automated enforcement later. | |

**User's choice:** Both lint and tests from Phase 1
**Notes:** Follow-up decisions locked within this area: enforce strict folder boundaries including adapter-to-adapter blocking; anchor allowed imports in explicit shared surfaces like contract/model/diagnostics; and automate guardrails against shared `Gemini*` naming or other Gemini-shaped abstractions.

---

## the agent's Discretion

- None explicitly delegated during discussion.

## Deferred Ideas

- None.
