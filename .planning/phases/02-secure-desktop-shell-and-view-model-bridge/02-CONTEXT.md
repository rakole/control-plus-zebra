# Phase 2: Secure Desktop Shell and View-Model Bridge - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the first Electron/Vite/React desktop shell around the existing Phase 1 shared core, with a narrow typed preload bridge, harness-neutral IPC/view-model boundaries, and security defaults that prevent the renderer from reaching raw filesystem, shell, or adapter-private surfaces.

</domain>

<decisions>
## Implementation Decisions

### App shell scaffold and shape
- **D-01:** Use the official Electron Forge + Vite + TypeScript scaffold as the baseline, but review and trim generated structure so it fits the repo's existing ownership boundaries instead of accepting the template wholesale.
- **D-02:** Land a future-shaped but minimal desktop shell: persistent workbench chrome with lightweight navigation/header placeholders, but only one real content route in Phase 2.
- **D-03:** Use React Router in library/declarative mode from the first renderer slice so later Overview, Projects, Sessions, Session Detail, and Diagnostics pages can slot into the same shell without a routing rewrite.

### Preload and IPC contract
- **D-04:** Preload must expose one typed method per allowed operation and never expose `ipcRenderer`, a generic invoke helper, or any broad Electron API escape hatch.
- **D-05:** Start with a small set of future-shaped harness-neutral IPC names rather than a single bootstrap blob or phase-local naming scheme, so later phases extend the same contract shape.
- **D-06:** Validate IPC inputs in the main process and return sanitized view models only; the renderer must not receive raw normalized store objects, raw filesystem records, or adapter-private types.

### First fake-data route and view-model depth
- **D-07:** The first real renderer route should be Sessions-first, using sanitized fake-adapter-backed session summaries rather than an Overview aggregate or a full Session Detail timeline.
- **D-08:** The first shell proof should show list/detail-style session browsing with summary DTOs, status/capability cues, and a selected-session preview area, while deferring deep timeline and audit panels to later phases.
- **D-09:** Fake data for the first route should flow through the main-process bridge from existing shared-core and fake-adapter proof surfaces, not renderer-local mocks.

### Security proof and verification
- **D-10:** Security defaults are locked from day one: `nodeIntegration` off, `contextIsolation` on, sandboxing on, local packaged content only, and restrictive CSP in both dev and production flows.
- **D-11:** Phase 2 should add immediate boundary/security checks for forbidden renderer APIs, preload exposure, and IPC sanitization instead of waiting until Phase 8, while full Electron smoke coverage can remain a later hardening phase.
- **D-12:** Preserve and extend the Phase 1 harness-neutrality guardrails as the shell lands; new renderer and preload code must work with the existing import/naming rules rather than creating special-case exceptions.

### the agent's Discretion
- Exact Electron file and entrypoint naming, so long as ownership remains `src/main/**`, `src/preload/**`, and `src/renderer/**`.
- Exact workbench chrome styling and component naming, so long as it reads as a local desktop tool rather than a marketing page.
- Exact initial IPC subset, so long as it stays small, harness-neutral, and aligned with the Sessions-first route.
- Exact renderer composition for the first screen, so long as it consumes sanitized summary DTOs and does not pull raw adapter/core internals into the UI.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level product brief, stack, conventions, architecture boundaries, and workflow rules for this repo.
- `.planning/ROADMAP.md` - Phase 2 goal, success criteria, and the four planned work slices (`02-01` through `02-04`).
- `.planning/REQUIREMENTS.md` - Locked Phase 2 requirement set covering `DESK-01` through `DESK-06`.
- `.planning/PROJECT.md` - Core value, read-only V1 boundary, ownership zones, and security posture.
- `.planning/STATE.md` - Current project focus, carry-forward decisions from Phase 1, and current session continuity.

### Prior phase decisions that carry forward
- `.planning/phases/01-architecture-contracts-and-fixture-proof/01-CONTEXT.md` - Phase 1 locked the harness-neutral shared-core shape, fake-adapter proof style, and boundary-enforcement expectations that Phase 2 must preserve.

### Architecture and security source of truth
- `.spec/spec-from-5.5-revision-1.md` - Revised architecture, renderer/main ownership boundaries, harness-neutral IPC naming, and adapter-aware security rules.
- `.spec/additional-instructions.md` - Supplemental guardrails for harness neutrality, read-only V1 scope, and "adapters emit evidence, not conclusions."

### Research grounding for Phase 2
- `.planning/research/SUMMARY.md` - Recommends secure Electron shell work before data-access growth and highlights unsafe IPC as a top risk.
- `.planning/research/ARCHITECTURE.md` - Recommended project structure, preload boundary, IPC/view-model flow, and anti-patterns relevant to the shell phase.
- `.planning/research/STACK.md` - Electron Forge, Vite, React, TypeScript, Zod, and testing/tooling recommendations for the desktop shell.
- `.planning/research/PITFALLS.md` - Unsafe Electron boundary, broad IPC exposure, and missing-evidence rendering risks that Phase 2 should actively guard against.
- `.planning/research/FEATURES.md` - Notes that renderer code should consume IPC view models only and that harness-neutral UI flows come after shared contracts exist.

### Existing code and guardrails to extend
- `package.json` - Current scripts and dependency baseline that the Electron scaffold must integrate with rather than replace.
- `tsconfig.json` - Existing strict NodeNext TypeScript baseline to preserve while adding preload and renderer targets.
- `eslint.config.mjs` - Existing harness-neutrality and import-boundary lint rules that must continue covering shared and renderer-facing code.
- `src/main/core/registry/register-bundled-adapters.ts` - Existing composition-root adapter registration seam that the Electron main process should reuse.
- `src/main/core/adapter-contract/session-source-adapter.ts` - Current public adapter contract shape that remains the shared-core source of truth.
- `tests/boundaries/import-boundaries.test.ts` - Boundary tests that already define legal/illegal imports for core, renderer, and adapters.
- `tests/boundaries/shared-naming.test.ts` - Shared naming and provider-branch guardrails that new renderer-facing code must continue passing.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` and `tsconfig.json`: already provide the strict TypeScript, lint, test, and boundary-test baseline that the Phase 2 scaffold should preserve.
- `src/main/core/registry/register-bundled-adapters.ts`: already gives the main-process composition root a clean way to stand up bundled adapters without spreading adapter imports.
- `src/main/core/adapter-contract/session-source-adapter.ts`: establishes the shared-core contract that future IPC/view-model layers should sit on top of.
- `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts`: provide existing guardrail patterns to extend as renderer and preload code land.

### Established Patterns
- Adapter-private code stays behind the registry composition root; shared core and renderer stay harness-neutral.
- The repo is currently main-process/shared-core only; `src/preload/**` and `src/renderer/**` will be new ownership zones introduced in this phase.
- Verification culture is already contract-first: lint, typecheck, Vitest, and explicit boundary tests are part of the baseline, so Phase 2 should add shell/security checks in the same style.
- The fake adapter is already the proof harness, so renderer data should come from shared-core/fake-adapter-backed paths rather than standalone UI mocks.

### Integration Points
- A new Electron main entrypoint should compose the existing bundled adapter registry rather than reimplement adapter bootstrap logic.
- A new preload layer should become the only renderer-facing bridge for Phase 2 data access.
- A new renderer route should consume sanitized fake-session summary view models coming from main-process IPC handlers.
- Existing lint and boundary tests are the right enforcement seam for renderer/import restrictions as new folders and files appear.

</code_context>

<specifics>
## Specific Ideas

- Prefer a clean internal-tool desktop shell over a marketing-style landing page.
- It is acceptable for the shell chrome to show placeholder navigation entries for later pages, as long as only the Sessions-oriented route is truly implemented in Phase 2.
- The first renderer view should already be honest about unsupported or unknown capability states rather than flattening them into zero values or success states.

</specifics>

<deferred>
## Deferred Ideas

- Full Overview aggregate dashboards before shared dashboard view models and source/scanner plumbing exist.
- Full Session Detail timeline and Run Audit UI before later phases own those shared-core and UI concerns.
- Full Electron smoke/E2E packaging proof, which remains part of later hardening/readiness work.

</deferred>

---

*Phase: 02-secure-desktop-shell-and-view-model-bridge*
*Context gathered: 2026-05-23*
