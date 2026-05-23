# Phase 1: Architecture Contracts and Fixture Proof - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the harness-neutral shared core for Agent Workbench by defining the Phase 1 adapter/model contracts, normalizing a fake adapter fixture through that contract, and enforcing import/naming boundaries before any Electron shell or Gemini-specific shared abstractions are introduced.

</domain>

<decisions>
## Implementation Decisions

### Contract surface
- **D-01:** Phase 1 should define only the contract surface needed for this milestone, not the full long-term adapter API.
- **D-02:** Even within that minimal surface, keep the explicit lifecycle seams: `validateSourceRoot`, `discoverSources`, `discoverArtifacts`, `parseArtifact`, and `normalize`.
- **D-03:** Capabilities are mandatory and structured from day one, with explicit support for unsupported/unknown truth semantics and a path for adapter-, source-, and session-level capability data.
- **D-04:** Method signatures should already be async/stream-friendly so later real adapters do not require a contract-shape rewrite.

### Normalized model depth
- **D-05:** Model the real shared nouns now: project, session, event, message, tool call, shell command evidence, output artifact, diagnostics, capabilities, IDs, and confidence.
- **D-06:** Shared IDs should be deterministic and derived from adapter identity, source identity, and native identity so future cache/session collisions are avoided by design.
- **D-07:** Diagnostics and confidence are first-class parts of the normalized contract, not test-only metadata or comments on fixtures.
- **D-08:** Keep a hard boundary between adapter evidence and later shared-core conclusions such as verification or run-audit classifications.

### Fake adapter proof style
- **D-09:** Use one small but representative fake fixture for Phase 1 rather than a broader fake fixture pack.
- **D-10:** That fixture should prove the contract/model shape end to end; exhaustive unsupported-capability permutations can wait for later phases, while schema/tests still enforce truth semantics now.
- **D-11:** The fake raw artifact format should be simple and intentionally non-Gemini-shaped so the proof demonstrates harness neutrality instead of mimicking Gemini.
- **D-12:** Stable golden normalized output is the main proof artifact for the fake adapter.

### Boundary enforcement
- **D-13:** Enforce Phase 1 architecture boundaries with both lint feedback and automated tests.
- **D-14:** Use strict folder-boundary enforcement: `src/main/core/**` and `src/renderer/**` must not import adapter-private files, and adapters must not import each other.
- **D-15:** Anchor allowed adapter imports in explicit shared surfaces such as contract, model, diagnostics, and minimal registry-facing types instead of allowing broad shared-core imports.
- **D-16:** Add explicit guardrails so shared code cannot drift toward `Gemini*` naming or other Gemini-shaped abstractions.

### the agent's Discretion
- Exact file and module breakdown inside the approved shared surfaces.
- Exact capability enum/property names, as long as they preserve the mandatory structured capability semantics above.
- Exact lint/test tooling choices for enforcing the locked boundaries.
- Exact fake fixture field values beyond the required proof shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level project brief, stack, conventions, architecture boundaries, and workflow constraints.
- `.planning/ROADMAP.md` - Phase 1 goal, success criteria, and the four planned work slices (`01-01` through `01-04`).
- `.planning/REQUIREMENTS.md` - Phase 1 requirement set covering `ARCH-01` through `ARCH-07`, `ADPT-01`, `ADPT-02`, `ADPT-07`, and `TEST-01` through `TEST-03`.
- `.planning/PROJECT.md` - Core value, V1 read-only boundary, harness-neutral naming rules, and ownership zones for shared core vs adapters vs renderer.

### Architecture and milestone proof constraints
- `.spec/spec-from-5.5-revision-1.md` - Revised shared architecture, ownership boundaries, and the intended adapter contract shape that keeps Gemini behind `gemini-cli`.
- `.spec/additional-instructions.md` - First-milestone proof obligations, shared naming guardrails, and explicit "adapters emit evidence, not conclusions" rules.

### Research grounding for planning
- `.planning/research/SUMMARY.md` - High-level rationale for proving adapter neutrality before UI depth and the recommended phase ordering.
- `.planning/research/ARCHITECTURE.md` - Recommended project structure, shared/adapters boundary, data flow, and anti-patterns relevant to Phase 1.
- `.planning/research/PITFALLS.md` - Failure modes Phase 1 is explicitly preventing, including first-adapter lock-in, cache/ID collisions, and boundary drift.
- `.planning/research/STACK.md` - Recommended implementation stack and testing/tooling choices that Phase 1 planning should assume.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No implementation assets exist yet: there is no `src/` tree, scaffolded Electron app, adapter folder, or test harness to reuse.
- The current reusable artifacts are planning and spec documents only, especially the research docs and the master spec corrections.

### Established Patterns
- The repo is intentionally pre-implementation, so the most important established patterns are documentary: harness-neutral naming, explicit ownership boundaries, read-only V1 scope, and contract-backed proof before UI work.
- Phase artifacts should follow the GSD phase-directory convention under `.planning/phases/NN-name/`.
- Planning should assume the researched stack and folder direction from `.planning/research/ARCHITECTURE.md` and `.planning/research/STACK.md`.

### Integration Points
- Phase 1 is expected to create the first shared-core surfaces under `src/main/core/**` and the first adapter proof area under `src/main/adapters/<id>/**`.
- Boundary tests and lint rules need to land as part of the initial scaffold, because there is no existing codebase to retrofit later.
- The fake adapter and its golden tests are the integration seam that will anchor future Gemini and non-Gemini adapters to the same shared contract.

</code_context>

<specifics>
## Specific Ideas

- Keep the slice tight: define only the Phase 1 contract surface, but make it future-shaped enough that later adapters do not need a contract rewrite.
- Preserve the full ingestion lifecycle shape even in the minimal proof so the fake adapter does not accidentally hardcode a shortcut architecture.
- Make the fake adapter visibly non-Gemini-shaped to prove the shared core is truly harness-neutral.
- Turn architecture rules into executable guardrails early rather than leaving them as code-review conventions.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 01-architecture-contracts-and-fixture-proof*
*Context gathered: 2026-05-23*
