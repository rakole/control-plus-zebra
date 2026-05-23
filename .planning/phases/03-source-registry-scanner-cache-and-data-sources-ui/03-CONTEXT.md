# Phase 3: Source Registry, Scanner, Cache, and Data Sources UI - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the shared source-management and ingestion foundation for Agent Workbench. A user should be able to add, enable, disable, validate, and scan a harness source root from a Harnesses/Data Sources settings surface, while shared core owns safe filesystem access, scanner orchestration, artifact indexing, normalized cache persistence, validation diagnostics, and watcher boundaries. Adapters remain evidence producers only; the renderer consumes typed IPC view models only.

</domain>

<decisions>
## Implementation Decisions

### Data Sources screen shape
- **D-01:** Use a split list/detail management surface for Harnesses and Data Sources rather than a dense table or a single-use wizard.
- **D-02:** The list should make source state scan-friendly at a glance: adapter/display name, root path, enabled state, validation status, latest scan/cache status, and diagnostic count.
- **D-03:** The detail panel should own add/edit/validate/rescan interactions and show capability-aware messages, while avoiding broader Overview/Diagnostics dashboard scope reserved for later phases.

### Source validation and scan timing
- **D-04:** Adding or editing a source should validate first, then let the user explicitly scan or rescan after validation succeeds.
- **D-05:** Validation failures should preserve the attempted source entry with visible diagnostics instead of silently dropping it or treating it as an empty source.
- **D-06:** Scanning must route through shared scanner orchestration: adapters validate, discover, parse, and normalize, but they do not own unsafe filesystem traversal, watcher lifecycle, cache writes, or final audit conclusions.

### Cache and stale-data truth
- **D-07:** Phase 3 should expose concise operational truth for source/cache state on the Data Sources screen: never scanned, scanning, scan failed, scanned with diagnostics, cached, stale, unsupported, and unknown where applicable.
- **D-08:** Parser, source, cache, and normalization diagnostics should be visible enough for a user to understand why data is missing or stale, without building the full Diagnostics page early.
- **D-09:** Cache and index metadata should preserve adapter ID, source ID, artifact identity, path or native reference, size, mtime, inode when available, parser version, adapter version, schema version, and diagnostics hash so missing or changed evidence is not flattened into success.

### Path selection and source persistence
- **D-10:** Start with typed path entry plus validation and file-backed source registry persistence. This is the smallest useful read-only UX and avoids adding native picker complexity before the source contract is stable.
- **D-11:** Source registry state should persist configured roots, display names, adapter IDs, enabled/disabled state, validation result summary, and last scan/cache summary using a local file-backed store.
- **D-12:** The fake adapter should remain usable as the first Phase 3 proof source, but the source registry and IPC/UI naming must stay harness-neutral and ready for Gemini CLI in Phase 4.

### Watcher behavior boundary
- **D-13:** Persist and display source enabled/disabled state and adapter watch-plan support, but keep full live watching controls mostly internal in Phase 3.
- **D-14:** Shared watcher orchestration should consume adapter watch plans and own watcher lifecycle boundaries; adapters must not create watchers directly.
- **D-15:** If watch support is unsupported or unknown for a source or adapter, the UI should say unsupported or unknown instead of implying zero activity or a clean source.

### the agent's Discretion
- Exact file/module breakdown for source registry, scanner, artifact index, cache, and Data Sources IPC view models, as long as ownership stays in `src/main/core/**`, main-process composition, preload/IPC, and renderer DTO boundaries.
- Exact visual density and component names for the Data Sources page, as long as it reads like a quiet local desktop settings/workbench surface and does not become a marketing page.
- Exact local file format for source registry and normalized cache, as long as it is deterministic, adapter/source-aware, testable, and avoids native database packaging risk in V1.
- Exact scan-status enum names, as long as unsupported, unknown, stale, failed, and diagnostics-bearing states remain distinct from empty/success states.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level product brief, stack, conventions, architecture boundaries, workflow rules, and read-only V1 constraints.
- `.planning/ROADMAP.md` - Phase 3 goal, success criteria, and the four planned work slices (`03-01` through `03-04`).
- `.planning/REQUIREMENTS.md` - Phase 3 requirement set covering `DATA-01` through `DATA-08` and `UI-06`.
- `.planning/PROJECT.md` - Core value, read-only boundary, ownership zones, harness-neutral naming, and capability-truth rules.
- `.planning/STATE.md` - Current project position, carry-forward decisions, pending Gemini fixture concern, and cache backend note.

### Prior phase decisions that carry forward
- `.planning/phases/01-architecture-contracts-and-fixture-proof/01-CONTEXT.md` - Locks the adapter contract lifecycle, explicit capabilities, deterministic IDs, diagnostics/confidence, fake-adapter proof style, and boundary enforcement expectations.
- `.planning/phases/02-secure-desktop-shell-and-view-model-bridge/02-CONTEXT.md` - Locks typed IPC/preload DTO boundaries, Sessions-first shell shape, renderer safety constraints, and fake-backed view-model flow that Phase 3 should extend.

### Architecture and source-management source of truth
- `.spec/spec-from-5.5-revision-1.md` - Defines the harness-neutral source registry, scanner/indexer, watcher orchestrator, cache layer, adapter boundary, and Data Sources/Harnesses settings vocabulary.
- `.spec/additional-instructions.md` - Supplemental guardrails for read-only V1, adapters emitting evidence rather than conclusions, unsupported/unknown truth, and no provider-specific UI branches.

### Research grounding
- `.planning/research/SUMMARY.md` - Recommends proving shared source/cache infrastructure before Gemini adapter depth and UI-heavy triage.
- `.planning/research/ARCHITECTURE.md` - Recommends source registry, scanner/indexer, watcher orchestration, normalized store/cache, IPC/view-model flow, and renderer boundary responsibilities.
- `.planning/research/STACK.md` - Confirms the Electron/Vite/React/TypeScript/Zod/Vitest stack and file-backed cache recommendation.
- `.planning/research/PITFALLS.md` - Highlights first-adapter lock-in, unsafe filesystem boundaries, cache identity collisions, unsupported-as-zero rendering, and watcher ownership risks.
- `.planning/research/FEATURES.md` - Describes Harnesses/Data Sources and Diagnostics-facing capabilities that Phase 3 should begin without absorbing all Phase 6 UI scope.

### Existing code and guardrails to extend
- `src/main/core/adapter-contract/session-source-adapter.ts` - Current adapter lifecycle contract with validation, discovery, parsing, normalization, and optional artifact loading.
- `src/main/core/adapter-contract/types.ts` - Current `SourceRootConfig`, `SourceRootValidation`, `DiscoveredHarnessSource`, `RawArtifactRef`, `AdapterNormalizationResult`, and capability snapshot types.
- `src/main/core/model/capabilities.ts` - Explicit supported/unsupported/unknown capability states to preserve through source and cache UI.
- `src/main/core/model/identifiers.ts` - Deterministic adapter/source/native identity helpers that scanner/cache keys should build on.
- `src/main/app/session-view-model-service.ts` - Existing fake-backed main-process view-model service; useful pattern, but Phase 3 should extract real source/scanner/cache services instead of continuing hardcoded fixture loading.
- `src/main/ipc/channels.ts` - Current narrow IPC channel list to extend with source/data-source operations.
- `src/main/ipc/view-models.ts` - Current Zod-validated IPC view-model schema pattern to reuse for source registry, scan status, and diagnostics DTOs.
- `src/main/ipc/handlers.ts` - Current request validation and sanitized-error pattern for IPC handlers.
- `src/preload/index.ts` and `src/preload/types.ts` - Current one-method-per-operation bridge surface to extend without exposing generic invoke or filesystem APIs.
- `src/renderer/components/AppShell.tsx` - Existing navigation shell where a Data Sources/Harnesses route can replace or activate the current disabled navigation placeholder.
- `src/renderer/routes/SessionsRoute.tsx` - Existing renderer data-loading/error/empty-state pattern through `window.agentWorkbench`.
- `tests/boundaries/import-boundaries.test.ts` - Existing boundary enforcement for core, renderer, and adapter-private imports.
- `tests/boundaries/shared-naming.test.ts` - Existing shared naming and forbidden provider-branch/conclusion-field guardrails.
- `tests/main/ipc/ipc-handlers.test.ts` - Existing IPC handler validation test pattern to extend for Data Sources operations.
- `tests/preload/preload-api-surface.test.ts` - Existing preload API surface guardrail to extend when adding source operations.
- `tests/renderer/renderer-boundary-source.test.ts` - Existing renderer boundary scan pattern that should continue covering new Data Sources UI.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/main/core/adapter-contract/session-source-adapter.ts` and `src/main/core/adapter-contract/types.ts`: already define validation, discovery, parsing, normalization, source root config, discovered source, raw artifact, and normalization result contracts that Phase 3 should orchestrate rather than replace.
- `src/main/core/model/capabilities.ts` and `src/main/core/model/identifiers.ts`: already provide explicit truth states and deterministic IDs that should shape source registry status, cache keys, and UI badges.
- `src/main/app/session-view-model-service.ts`: demonstrates the current end-to-end fake adapter flow and IPC DTO sanitization pattern; it also reveals the hardcoded fixture-loading seam Phase 3 should replace with real source/scanner/cache services.
- `src/main/ipc/channels.ts`, `src/main/ipc/view-models.ts`, and `src/main/ipc/handlers.ts`: provide the narrow channel, Zod schema, validated request, and sanitized error conventions for adding Data Sources operations.
- `src/preload/index.ts` and `src/preload/types.ts`: provide the one-method-per-operation bridge pattern that must remain narrow.
- `src/renderer/components/AppShell.tsx` and `src/renderer/routes/SessionsRoute.tsx`: provide existing shell/navigation and renderer loading/error/empty-state patterns for the Data Sources page.
- `tests/boundaries/**`, `tests/main/ipc/**`, `tests/preload/**`, and `tests/renderer/**`: provide boundary, IPC, bridge, and renderer safety test patterns that should expand with Phase 3.

### Established Patterns
- Renderer code uses `window.agentWorkbench` and sanitized IPC view models only.
- IPC handlers validate inputs with Zod and return sanitized errors instead of raw exceptions or filesystem details.
- Shared core and renderer-facing code must stay harness-neutral and avoid adapter-private imports.
- Adapters own harness-specific parsing/mapping, while shared core owns cross-adapter contracts and later scanner/cache/audit behavior.
- Tests encode architecture rules directly, so Phase 3 should add source/scanner/cache behavior with matching contract and boundary coverage.

### Integration Points
- Add source registry, safe filesystem helper, scanner, artifact index, normalization validation, and cache modules under shared main-process/core ownership.
- Extend main-process service/IPC/preload surfaces with data-source list/add/update/enable/disable/validate/scan operations as narrow methods.
- Replace hardcoded fake fixture loading in the current session view-model path with source-registry-backed scan/cache data while keeping the fake adapter as a proof source.
- Add a Data Sources/Harnesses route to the existing app shell and keep broader Overview, Run Audit, and full Diagnostics pages deferred.
- Extend adapter contract tests or scanner-specific tests so malformed normalized fragments are rejected or diagnosed before reaching the store.

</code_context>

<specifics>
## Specific Ideas

- Use typed path entry first for source roots; defer native picker UX until the shared source registry is proven.
- Keep the Data Sources page operational and compact: list configured sources, select one, inspect status/diagnostics, validate, enable/disable, and scan/rescan.
- Make cache and diagnostic state honest but not overbuilt: enough to explain missing/stale data, not a full cache inspector.
- Keep watcher controls restrained: show enabled/source support state, but do not build full live-watch management UI in this phase.
- Treat the fake adapter as the Phase 3 proof source, while preserving Phase 4 readiness for Gemini CLI source roots.

</specifics>

<deferred>
## Deferred Ideas

- Native macOS directory/file picker UX can be added after typed-path source registry behavior is proven.
- Deep cache inspector and full Diagnostics page belong after the scanner/cache contracts are stable and Phase 6 owns diagnostics UI depth.
- Full live watcher controls and real-time scan UX should wait until watcher orchestration behavior is implemented and tested enough to expose safely.

</deferred>

---

*Phase: 3-Source Registry, Scanner, Cache, and Data Sources UI*
*Context gathered: 2026-05-23*
