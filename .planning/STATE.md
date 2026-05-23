# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-23)

**Core value:** Agent Workbench must truthfully classify local coding-agent runs from normalized evidence, not harness-specific assumptions.
**Current focus:** Phase 1 - Architecture Contracts and Fixture Proof

## Current Position

Phase: 1 of 8 (Architecture Contracts and Fixture Proof)
Plan: 01-02 complete; 2 plans remaining in current phase
Status: In progress; Wave 3 ready to execute
Last activity: 2026-05-23 - Executed 01-02 fake adapter, registry, and smoke proof

Progress: [█████-----] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 3 min
- Total execution time: 6 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Architecture Contracts and Fixture Proof | 2/4 | 6 min | 3 min |

**Recent Trend:**
- Last 5 plans: 01-01, 01-02
- Trend: Wave 2 proof complete; contract/golden and boundary plans remain

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Initialization: Product name is Agent Workbench.
- Initialization: Gemini CLI is the first adapter, not the product architecture.
- Initialization: Phase 0/1 must prove contracts and fixtures before UI depth.
- Initialization: V1 is read-only and must not launch sessions, control terminals, create PRs, or run arbitrary shell commands.
- Phase 1 context: Use a minimal but future-shaped adapter contract with explicit lifecycle seams and mandatory structured capabilities.
- Phase 1 context: Model the full shared proof nouns now, with deterministic adapter/source/native-based IDs and first-class diagnostics/confidence.
- Phase 1 context: Use one small non-Gemini fake fixture with golden normalized output as the main proof artifact.
- Phase 1 context: Enforce strict import and naming boundaries with both lint and automated tests from the start.
- Phase 1 planning: Keep this milestone TypeScript shared-core and proof-only; defer Electron shell, preload, and renderer scaffold work to Phase 2.
- Phase 1 execution: Use a strict NodeNext TypeScript baseline and remove deprecated compiler switches instead of silencing them.
- Phase 1 execution: Capability truth states are explicit shared contracts (`supported`, `unsupported`, `unknown`) from the first milestone.
- Phase 1 execution: Shared adapter contract exposes validation, discovery, parse, and normalize seams while reserving verification and audit conclusions for later shared-core phases.
- Phase 1 execution: Bundled adapters register only through composition-root registry surfaces, not shared model or diagnostics modules.
- Phase 1 execution: Malformed fake fixtures become diagnostics and empty normalized slices instead of inferred success or silent coercion.
- Phase 1 execution: The fake proof fixture stays intentionally non-Gemini-shaped while still covering messages, tool calls, shell evidence, artifacts, and file mutations.

### Pending Todos

- Execute `01-03` reusable contract/golden/truth-rule tests.
- Execute `01-04` lint, import-boundary, and shared naming guardrails.

### Blockers/Concerns

- Real Gemini fixture corpus still needs to be gathered during adapter planning.
- Cache backend starts file-backed; revisit SQLite only if realistic fixture volume proves it necessary.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Automation | Session launching, approve/reject, terminal control, PR creation, and branch/worktree cleanup | Deferred to v2+ | Initialization |
| Extensibility | Third-party adapter plugin model and real second non-Gemini adapter | Deferred to v2+ | Initialization |
| Scale | SQLite-backed search/cache and cost estimates | Deferred to v2+ | Initialization |

## Session Continuity

Last session: 2026-05-23
Stopped at: 01-02 complete; Wave 3 ready
Resume file: .planning/phases/01-architecture-contracts-and-fixture-proof/01-03-PLAN.md
