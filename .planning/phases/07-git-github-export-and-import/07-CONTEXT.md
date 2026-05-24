# Phase 7: Git, GitHub, Export, and Import - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich the existing harness-neutral triage workspace with shared read-only git context, optional shared read-only GitHub context, and portable archive export/import so Projects, Run Audit, and imported sessions become more trustworthy without mutating local repositories, remote pull requests, or live harness artifacts.

</domain>

<decisions>
## Implementation Decisions

### Repo-root confidence gate and shared git scope
- **D-01:** Shared git inspection may use only validated repository roots. `observed` roots may be tried as validation candidates, but snapshots are published only after git confirms the repo top level; `inferred` and `unknown` roots never run git commands.
- **D-02:** Git snapshot data should be project-scoped shared state reused across Projects and Run Audit surfaces, not recomputed per renderer route or per session page load.
- **D-03:** Phase 7 git scope is limited to fixed read-only fields: branch, HEAD SHA, dirty state, changed and untracked counts, additions and deletions, and remote URL. Diff bodies, patch previews, and mutable repo actions stay out of scope.
- **D-04:** Missing git, non-repo roots, validation mismatch, or timeouts must degrade to explicit field-level `Unknown` or `Unsupported` states plus diagnostics instead of failing scans or flattening the repo to clean.

### GitHub provider depth and failure semantics
- **D-05:** GitHub collection runs only when a project already has a validated git snapshot, a remote URL, and `gh` is available; renderer routes never invoke `gh` directly.
- **D-06:** V1 GitHub snapshot captures the linked pull request plus check summary and review or merge status when available. Comment timelines, full conversation replay, and write actions remain out of scope.
- **D-07:** GitHub results should be captured as cached read-only project snapshot data during shared-core scan or refresh, with conservative timeout behavior instead of per-page live polling.
- **D-08:** Missing `gh`, missing auth, no matching PR, API errors, or timeouts must surface as explicit `Unknown` or `Unsupported` GitHub context with diagnostics rather than blocking source, project, or session rendering.

### Export archive packaging and privacy defaults
- **D-09:** Export defaults to harness-neutral metadata, normalized entities, and diagnostics. Raw artifacts remain opt-in instead of included by default.
- **D-10:** Raw artifact export is allowed only for artifacts already indexed and readable through the shared safe-filesystem allowlist. Adapters without safe raw support still export normalized-only archives.
- **D-11:** Every raw-inclusive export must warn that transcripts, sidecars, repo paths, and command output may contain sensitive data, and the manifest should record whether raw data was included.
- **D-12:** Archive format remains read-only and harness-neutral: manifest plus normalized payloads plus optional raw-artifact bundle, with no executable scripts, mutable source configuration, or live repo bindings.

### Archive import behavior and source modeling
- **D-13:** Imported archives should register as persistent read-only data sources, not temporary in-memory previews, so they reuse the same source list, runtime, and triage seams as local sources.
- **D-14:** Imported archives should be modeled explicitly with metadata such as `sourceKind: imported-archive`, `addedBy: import`, and read-only operational states instead of being hidden inside generic local-root records.
- **D-15:** Imported archives may render sessions, projects, diagnostics, and optional raw artifacts, but they never run validate, scan, watch, git, or GitHub operations against the host filesystem or network-derived repo state.
- **D-16:** Imported sessions must not depend on original local source roots in the UI; preserve only archive-contained metadata and sanitized or archive-relative paths, while a dedicated read-only `archive-reader` adapter handles imported archives through the normal registry and runtime flow.

### the agent's Discretion
- Exact file and module layout for shared `git`, `github`, and `export` services under `src/main/core/**`, as long as providers stay shared-core, cache-backed, and read-only.
- Exact DTO field names and route presentation for project and session Git/GitHub summaries, as long as explicit `Unknown` and `Unsupported` states remain visible across Projects and Run Audit.
- Exact archive file extension, manifest schema versioning, and import dialog UX, as long as imported archives remain persistent read-only sources with privacy warnings preserved.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level product brief, ownership boundaries, read-only V1 rule, and workflow requirements.
- `.planning/ROADMAP.md` - Phase 7 goal, success criteria, and the four planned work slices (`07-01` through `07-04`).
- `.planning/REQUIREMENTS.md` - Locked Phase 7 requirement set covering `GIT-01` through `GIT-06`.
- `.planning/PROJECT.md` - Core value, harness-neutral ownership zones, privacy rules, and the standing rule that git and GitHub remain shared-core concerns.
- `.planning/STATE.md` - Current project position, pending Phase 7 concerns, and the carry-forward warning that repo truth must stay root-confidence-gated.

### Prior phase decisions that carry forward
- `.planning/phases/06-harness-neutral-triage-ui/06-CONTEXT.md` - Locks the requirement that Projects and Run Audit keep explicit `Unknown` and `Unsupported` placeholders until Phase 7 providers land.
- `.planning/phases/05-shared-shell-verification-and-run-audit/05-CONTEXT.md` - Locks the shared truth-state and capability-gap semantics that Phase 7 repo context must enrich without flattening.
- `.planning/phases/04-gemini-cli-adapter-end-to-end/04-CONTEXT.md` - Locks Gemini `.project_root` as evidence-only input and keeps shared repo context above adapter-private parsing.

### Spec and safety rules for git, GitHub, export, and import
- `.spec/spec-from-5.5-revision-1.md` - Defines project-root confidence levels, `HarnessSource` source kinds, shared Git/GitHub ownership, harness-neutral IPC names, and archive import/export deliverables.
- `.spec/additional-instructions.md` - Reinforces that only fixed read-only `git` and optional `gh` commands are allowed and that export/import stay shared-core concerns.
- `.planning/research/SUMMARY.md` - Phase 7 rationale and the recommendation to define safe `gh` timeout and failure semantics explicitly.
- `.planning/research/FEATURES.md` - Calls out root-confidence-driven git gating, read-only git and `gh` boundaries, and portable export/import support.

### Existing code and tests to extend
- `src/main/app/triage-view-model-service.ts` - Current project rollup seam that still hardcodes Phase 7 `Unknown` placeholders for branch, HEAD, dirty state, counts, and pull request state.
- `src/main/app/run-audit-view-model-service.ts` - Current Run Audit `Git / GitHub` placeholder section and the right seam for project-level snapshot display.
- `src/main/app/data-sources-view-model-service.ts` - Existing source lifecycle, status, and mutation flow that imported archives should reuse as persistent read-only sources.
- `src/main/app/workbench-runtime.ts` - Composition root for registry, cache, scanner, and raw-artifact index wiring where shared providers and archive flows will plug in.
- `src/main/ipc/view-models.ts` - Typed IPC/view-model contract that will need harness-neutral git, GitHub, export, and import additions.
- `src/main/ipc/handlers.ts` - Main-process IPC registration seam for any new read-only archive or repo-context bridge methods.
- `src/preload/types.ts` - Narrow preload bridge contract that must stay explicit and typed when new Phase 7 operations are added.
- `src/main/core/cache/file-backed-cache-store.ts` - Persisted normalized and derived cache contract that Phase 7 snapshots and archive payloads should build on rather than bypass.
- `src/main/core/ingestion/scanner.ts` - Shared scan-time derivation pipeline where git and GitHub snapshot attachment should live.
- `src/main/core/registry/source-registry.ts` - Source persistence seam that will need explicit imported-archive and read-only metadata support.
- `src/main/core/registry/source-registry-store.ts` - File-backed schema for persisted sources that will need to store archive-specific metadata cleanly.
- `src/main/core/registry/register-bundled-adapters.ts` - Bundled adapter registration seam where a dedicated `archive-reader` adapter can be added without touching shared core elsewhere.
- `src/main/core/security/safe-filesystem.ts` - Existing allowlist boundary that Phase 7 raw-export and imported-archive reads must continue to honor.
- `src/renderer/routes/ProjectsRoute.tsx` - Current project row UI that still renders Phase 7 placeholders for branch, HEAD, and dirty state.
- `src/renderer/routes/DataSourcesRoute.tsx` - Existing Data Sources UX that imported archives should reuse rather than bypass with a bespoke archive-only surface.
- `tests/renderer/projects-route.test.tsx` - Current proof that Projects shows explicit Phase 7 placeholders and should be updated without losing truth-state coverage.
- `tests/renderer/data-sources-route.test.tsx` - Existing renderer sketch for an `archive-reader` source and read-only source states.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/main/app/triage-view-model-service.ts`: already groups sessions into project rollups and is the first place branch, HEAD, dirty state, and pull request snapshots can replace the current `Unknown` placeholders.
- `src/main/app/run-audit-view-model-service.ts`: already owns the product-facing `Git / GitHub` audit section and can swap its Phase 6 placeholders for shared project snapshot fields.
- `src/main/app/data-sources-view-model-service.ts`: already models add, update, enable, validate, and scan flows, making it the natural seam for imported archive registration and read-only source-state presentation.
- `src/main/core/cache/file-backed-cache-store.ts`: already persists normalized plus derived session data, which gives Phase 7 a stable place to cache git and GitHub snapshots without inventing a separate renderer cache.
- `src/main/core/security/safe-filesystem.ts`: already enforces allowlisted file access and indexed-artifact reads, which aligns directly with raw-export gating and imported-archive safety.
- `tests/renderer/data-sources-route.test.tsx`: already sketches an `archive-reader` adapter and a disabled imported source, which is strong evidence that a dedicated archive adapter fits the current UI/test shape.

### Established Patterns
- Shared-core services derive and cache truth in main-process code; renderer routes consume typed DTOs only.
- Explicit `Unknown` and `Unsupported` states are already product rules and must survive any git or GitHub enrichment end-to-end.
- Source lifecycle is stateful and persisted through the source registry; new source kinds should extend that contract instead of bypassing it.
- Read-only filesystem access is already allowlist-driven, so Phase 7 should attach repo and archive behavior through validated roots and indexed artifacts instead of ad hoc path access.

### Integration Points
- Add shared git and GitHub snapshot modules under `src/main/core/**` and attach their results during `Scanner.scanSource()` so Projects and Run Audit stay cache-backed.
- Extend `src/main/core/registry/source-registry.ts` and `src/main/core/registry/source-registry-store.ts` with explicit imported-archive metadata and read-only source semantics.
- Add harness-neutral IPC and preload methods for archive creation and opening while keeping repo-context collection main-owned and non-interactive.
- Update `src/renderer/routes/ProjectsRoute.tsx`, `src/renderer/routes/DataSourcesRoute.tsx`, and related tests to surface real snapshots and imported archives without adding provider-specific branches.

</code_context>

<specifics>
## Specific Ideas

- Treat `observed` project roots as candidates for validation only; the shared git provider should publish data only after confirming the repo top level itself.
- Keep GitHub scope to pull request summary, check summary, and review or merge status so Phase 7 strengthens audit trust without drifting into review workflow tooling.
- Default archive exports to normalized-only bundles, with an explicit opt-in warning when transcripts, sidecars, paths, or command output would be copied.
- Use a dedicated bundled `archive-reader` adapter plus explicit imported-source metadata instead of special-casing archives in renderer code.

</specifics>

<deferred>
## Deferred Ideas

- Rich GitHub comment timelines, reviewer conversation replay, and any PR write actions remain future work beyond Phase 7's read-only snapshot scope.
- Diff-body export, transcript redaction profiles, and deeper privacy tooling belong in a later privacy-focused slice once the basic archive flow exists.
- Rebinding imported archives back to live local repositories or converting them into writable sources stays out of scope for V1.

</deferred>

---

*Phase: 07-git-github-export-and-import*
*Context gathered: 2026-05-24*
