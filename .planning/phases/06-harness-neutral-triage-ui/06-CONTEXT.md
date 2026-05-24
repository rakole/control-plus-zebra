# Phase 6: Harness-Neutral Triage UI - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the existing read-only shell into a real triage workspace with Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics surfaces that expose shared-core audit truth honestly. This phase should surface verification, run-audit, lifecycle, activity, and capability-gap signals through harness-neutral IPC/view models and renderer routes without introducing provider-specific branches, mutating controls, or fake git/GitHub conclusions before Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Triage entrypoint and navigation flow
- **D-01:** Once Phase 6 routes exist, `Overview` should become the default landing page instead of keeping `Sessions` as the home route.
- **D-02:** The left navigation should promote `Overview`, `Projects`, `Sessions`, and `Diagnostics` to real routes while keeping `Data Sources` available as the configuration/setup surface.
- **D-03:** Overview should be an attention-first triage dashboard: totals, recent/active activity, failed verification, cancelled runs, needs-attention counts, tool activity, activity-over-time, and harness filters, with links outward to Projects and Sessions instead of deep inline detail.
- **D-04:** Empty or early-stage installs should still route truthfully: when no scanned session data exists, Overview may point users back to Data Sources, but Data Sources should not remain the permanent default once triage data is present.

### Projects page truth before Phase 7 git providers
- **D-05:** Phase 6 should ship a real Projects page now, driven by normalized project/session/audit rollups, instead of deferring the whole page until Phase 7.
- **D-06:** Project-level git and GitHub fields required by the product contract (`branch`, `HEAD`, `dirty state`, changed/untracked files, PR state) must render as explicit `Unknown` or `Unsupported` placeholders until the shared git/GitHub providers land in Phase 7; the UI must not infer or invent them from session evidence.
- **D-07:** Project summaries should group all observed harnesses under the shared project identity and use shared audit/verification truth for the latest triage signal, rather than privileging any single adapter.
- **D-08:** The first Projects slice should prioritize session count, observed harnesses, latest activity, latest verification/audit truth, and repo path visibility; deeper repo-state inspection stays a later-phase concern.

### Sessions, Session Detail, and Run Audit separation
- **D-09:** Keep `Sessions` as the fast triage surface, evolving the current list/detail pattern into a denser summary view rather than turning it into the full evidence browser.
- **D-10:** Add a separate `Session Detail` route for the chronological mixed timeline of normalized evidence, with the current preview card treated as the lightweight precursor rather than the final detail experience.
- **D-11:** Add a dedicated `Run Audit` route or subview for sectioned claim-vs-evidence review; audit evidence should not be buried inside the general chronological timeline.
- **D-12:** Sessions rows/cards should surface the shared-core truth that matters for triage first: audit status, verification status, lifecycle, project, harness, capability warnings, command/file/tool counts, and failed-command signal when supported.
- **D-13:** Session Detail should use progressive disclosure: lead with harness badge, project, IDs, lifecycle, verification/audit summaries, and attention reasons, then show a mixed timeline of messages, lifecycle events, tool calls, shell commands, file mutations, output artifacts, and unknown/raw evidence markers.
- **D-14:** Run Audit should group evidence by product-facing questions (`claim vs evidence`, `verification`, `files changed`, `commands`, `cancellation/incompletion`, `git/GitHub`, `capability gaps`, `parser diagnostics`) instead of replaying one long event feed.

### Diagnostics and warning voice
- **D-15:** Diagnostics should read like an operator console for trust and ingestion issues: grouped, actionable, and scan-friendly first, with raw diagnostic codes/messages still visible inside each group.
- **D-16:** Capability warnings, unsupported states, and unknown states must reuse one shared vocabulary across Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics so the same evidence gap never looks clean in one surface and broken in another.
- **D-17:** Diagnostics groups should reflect the real source areas already present in the system (`adapter`, `source`, `normalization`, `cache`) and extend naturally to parser/capability-oriented views without inventing a separate provider-specific taxonomy.
- **D-18:** Diagnostics and warning surfaces must stay sanitized renderer DTOs: enough detail to explain truth and uncertainty, but no raw filesystem dumps, unsafe command output leakage, or adapter-private object exposure.

### the agent's Discretion
- Exact route naming and nesting for `Overview`, `Projects`, `Session Detail`, and `Run Audit`, as long as Overview becomes the triage entrypoint and Run Audit remains a distinct evidence view.
- Exact card/table composition and visual density, as long as triage signals stay scan-first and capability gaps remain explicit.
- Exact aggregation helpers and view-model service boundaries needed to expose project rollups, session detail, audit sections, and diagnostics groups through typed IPC.
- Exact chart and activity-summary implementation choices for Overview, as long as they stay read-only, harness-neutral, and truthful when capabilities are missing.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level product brief, architecture boundaries, stack, and GSD workflow constraints.
- `.planning/ROADMAP.md` - Phase 6 goal, success criteria, and the five planned work slices (`06-01` through `06-05`).
- `.planning/REQUIREMENTS.md` - Locked Phase 6 requirement set covering `UI-01` through `UI-09` and `TEST-07`.
- `.planning/PROJECT.md` - Core value, read-only V1 boundary, harness-neutral ownership zones, and truth rules for unsupported/unknown evidence.
- `.planning/STATE.md` - Current project position and the carry-forward note that Phase 6 must surface the internal audit truth completed in Phase 5.

### Prior phase decisions that carry forward
- `.planning/phases/02-secure-desktop-shell-and-view-model-bridge/02-CONTEXT.md` - Locks typed preload/IPC/view-model boundaries, Sessions-first shell history, and renderer safety rules that Phase 6 must extend without weakening.
- `.planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md` - Locks the shared source-registry/scanner/cache/runtime flow and the Data Sources route patterns that remain part of the workbench shell.
- `.planning/phases/04-gemini-cli-adapter-end-to-end/04-CONTEXT.md` - Locks the rule that adapter-private evidence stays behind shared normalized contracts and renderer/provider branches stay metadata-driven only.
- `.planning/phases/05-shared-shell-verification-and-run-audit/05-CONTEXT.md` - Locks the shared verification and run-audit truth model, precedence rules, and capability-gap semantics that Phase 6 must render honestly.

### Phase 6 UI and truth-model source of truth
- `.spec/spec-from-5.5-revision-1.md` - Defines the product-facing Overview, Projects, Sessions, Session Detail, and Run Audit expectations plus harness-neutral naming and audit concepts.
- `.spec/additional-instructions.md` - Reinforces read-only V1 scope, shared-core ownership of verification/audit, and the requirement that unsupported data never render as clean or passed.
- `.planning/research/SUMMARY.md` - Recommends surfacing UI only after shared shell/verification/audit contracts exist and calls out missing-evidence flattening as a core risk.
- `.planning/research/FEATURES.md` - Describes the sessions dashboard, verification truth, run audit wedge, and the need to keep triage surfaces capability-aware.
- `.planning/research/ARCHITECTURE.md` - Recommends main-process-owned ingestion/audit with renderer consumption via narrow typed IPC view models.
- `.planning/research/PITFALLS.md` - Highlights the risk of `count || 0` dashboards and hidden capability warnings, which Phase 6 must avoid directly.

### Existing code and tests to extend
- `src/renderer/App.tsx` - Current route table showing `Sessions` and `Data Sources` as the only live routes and the place Overview/Projects/Diagnostics routing will expand from.
- `src/renderer/components/AppShell.tsx` - Existing navigation shell with disabled placeholders for `Overview`, `Projects`, and `Diagnostics`; primary seam for Phase 6 nav promotion.
- `src/renderer/routes/SessionsRoute.tsx` - Current list/detail sessions triage surface and reload flow that should become the lightweight triage entry into deeper session views.
- `src/renderer/components/SessionList.tsx` - Current session summary row pattern and capability-warning surfacing that can evolve into richer triage summaries.
- `src/renderer/components/SessionPreview.tsx` - Current selected-session preview pattern that should graduate into a dedicated Session Detail route.
- `src/renderer/routes/DataSourcesRoute.tsx` - Existing workbench route pattern, loading/error handling, and configuration/setup surface that remains in the shell after Overview lands.
- `src/main/app/session-view-model-service.ts` - Current sanitized session summary/preview service and the first obvious seam for exposing project rollups, session detail, and audit-aware DTOs.
- `src/main/ipc/view-models.ts` - Typed IPC schema layer where new Overview, Projects, Session Detail, Run Audit, and Diagnostics DTOs must stay harness-neutral and sanitized.
- `src/main/core/cache/file-backed-cache-store.ts` - Source of truth for persisted derived session verification/audit shape that Phase 6 surfaces should consume.
- `src/main/core/ingestion/scanner.ts` - Scan-time derivation pipeline that already computes verification and run audit during cache writes.
- `tests/main/core/scanner-cache.test.ts` - Regression proof that derived verification/audit truth already exists for fake and Gemini evidence.
- `tests/renderer/sessions-route.test.tsx` - Current renderer proof for unsupported/unknown capability surfacing and read-only Sessions behavior.
- `tests/renderer/data-sources-route.test.tsx` - Existing route/UI testing pattern to mirror for new Phase 6 renderer pages.
- `tests/boundaries/import-boundaries.test.ts` - Guardrail that must keep renderer and shared core from importing adapter-private files.
- `tests/boundaries/shared-naming.test.ts` - Guardrail that blocks provider-specific shared naming and conclusion leakage in the wrong layers.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/renderer/components/AppShell.tsx`: already provides the stable workbench chrome and the exact placeholder nav entries that Phase 6 needs to activate.
- `src/renderer/routes/SessionsRoute.tsx`, `src/renderer/components/SessionList.tsx`, and `src/renderer/components/SessionPreview.tsx`: already prove the list/detail triage interaction, loading states, sanitized error handling, and capability-warning presentation style.
- `src/renderer/routes/DataSourcesRoute.tsx`: already demonstrates how a richer workbench route handles selection, editor state, bridge calls, and explicit unsupported/unknown messaging.
- `src/main/app/session-view-model-service.ts`: already loads normalized session data from the shared runtime/cache path and converts it into sanitized renderer DTOs, making it the right place to add richer triage summaries or split-out services.
- `src/main/ipc/view-models.ts`: already defines strict Zod schemas for renderer DTOs and explicit label enums for capability states and sanitized errors.
- `src/main/core/cache/file-backed-cache-store.ts` and `src/main/core/ingestion/scanner.ts`: already persist the derived verification and run-audit truths that the new UI should expose instead of recomputing in the renderer.

### Established Patterns
- Renderer code consumes `window.agentWorkbench` bridge methods and sanitized view models only.
- Unsupported and unknown capability states already render explicitly in Sessions and Data Sources and should remain first-class on every new surface.
- Adapter-neutral shell structure already exists: shared app shell, shared route skeleton, shared DTO schemas, and shared-core derived truth all sit above adapter-private code.
- Current UI patterns favor scan-friendly list/detail layouts, route-local loading/error/empty states, and capability badges rather than dense raw dumps.

### Integration Points
- Expand `src/renderer/App.tsx` and `src/renderer/components/AppShell.tsx` to make Overview, Projects, Diagnostics, Session Detail, and Run Audit real routes.
- Add new main-process view-model services or extend existing ones for dashboard/project/session-detail/audit/diagnostics DTOs through `src/main/app/**` and `src/main/ipc/**`.
- Reuse the derived cache payload from `src/main/core/cache/file-backed-cache-store.ts` rather than recalculating audit state in renderer code.
- Mirror the existing renderer test style in `tests/renderer/**` and preserve the current boundary tests so new pages stay capability-aware and adapter-neutral.

</code_context>

<specifics>
## Specific Ideas

- Overview should become the triage home once session data exists, but it can still hand first-run users back to Data Sources when no scanned evidence is available yet.
- Projects should be useful before git providers exist by showing cross-harness project rollups and explicit `Unknown`/`Unsupported` git fields instead of hiding the columns or inventing values.
- Session Detail and Run Audit should intentionally split chronology from judgment: timeline in Session Detail, evidence-grouped trust review in Run Audit.
- Diagnostics should feel like an operator surface for trust and ingestion issues: grouped counts first, raw diagnostic code/message second, and capability-gap language shared with the rest of the app.

</specifics>

<deferred>
## Deferred Ideas

- Saved cross-page filters, search, and custom triage presets can wait until the first complete triage surfaces exist.
- Real git/GitHub branch, dirty-state, and PR data remain Phase 7 work.
- Token-usage charts or model-cost reporting should stay gated behind real capability support and later product scope.

</deferred>

---

*Phase: 06-harness-neutral-triage-ui*
*Context gathered: 2026-05-24*
