# Phase 7: Git, GitHub, Export, and Import - Research

**Researched:** 2026-05-24 [VERIFIED: codebase grep]
**Domain:** Shared main-process git and GitHub snapshot collection plus harness-neutral archive export/import over the existing triage, cache, registry, and IPC seams. [VERIFIED: codebase grep]
**Confidence:** HIGH [VERIFIED: codebase grep]

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied from `.planning/phases/07-git-github-export-and-import/07-CONTEXT.md`. [VERIFIED: codebase grep]

### Locked Decisions
- **D-01:** Shared git inspection may use only validated repository roots. `observed` roots may be tried as validation candidates, but snapshots are published only after git confirms the repo top level; `inferred` and `unknown` roots never run git commands.
- **D-02:** Git snapshot data should be project-scoped shared state reused across Projects and Run Audit surfaces, not recomputed per renderer route or per session page load.
- **D-03:** Phase 7 git scope is limited to fixed read-only fields: branch, HEAD SHA, dirty state, changed and untracked counts, additions and deletions, and remote URL. Diff bodies, patch previews, and mutable repo actions stay out of scope.
- **D-04:** Missing git, non-repo roots, validation mismatch, or timeouts must degrade to explicit field-level `Unknown` or `Unsupported` states plus diagnostics instead of failing scans or flattening the repo to clean.

- **D-05:** GitHub collection runs only when a project already has a validated git snapshot, a remote URL, and `gh` is available; renderer routes never invoke `gh` directly.
- **D-06:** V1 GitHub snapshot captures the linked pull request plus check summary and review or merge status when available. Comment timelines, full conversation replay, and write actions remain out of scope.
- **D-07:** GitHub results should be captured as cached read-only project snapshot data during shared-core scan or refresh, with conservative timeout behavior instead of per-page live polling.
- **D-08:** Missing `gh`, missing auth, no matching PR, API errors, or timeouts must surface as explicit `Unknown` or `Unsupported` GitHub context with diagnostics rather than blocking source, project, or session rendering.

- **D-09:** Export defaults to harness-neutral metadata, normalized entities, and diagnostics. Raw artifacts remain opt-in instead of included by default.
- **D-10:** Raw artifact export is allowed only for artifacts already indexed and readable through the shared safe-filesystem allowlist. Adapters without safe raw support still export normalized-only archives.
- **D-11:** Every raw-inclusive export must warn that transcripts, sidecars, repo paths, and command output may contain sensitive data, and the manifest should record whether raw data was included.
- **D-12:** Archive format remains read-only and harness-neutral: manifest plus normalized payloads plus optional raw-artifact bundle, with no executable scripts, mutable source configuration, or live repo bindings.

- **D-13:** Imported archives should register as persistent read-only data sources, not temporary in-memory previews, so they reuse the same source list, runtime, and triage seams as local sources.
- **D-14:** Imported archives should be modeled explicitly with metadata such as `sourceKind: imported-archive`, `addedBy: import`, and read-only operational states instead of being hidden inside generic local-root records.
- **D-15:** Imported archives may render sessions, projects, diagnostics, and optional raw artifacts, but they never run validate, scan, watch, git, or GitHub operations against the host filesystem or network-derived repo state.
- **D-16:** Imported sessions must not depend on original local source roots in the UI; preserve only archive-contained metadata and sanitized or archive-relative paths, while a dedicated read-only `archive-reader` adapter handles imported archives through the normal registry and runtime flow.

### the agent's Discretion
- Exact module layout for shared `git`, `github`, and `archive` services under `src/main/core/**`, as long as providers stay shared-core, cache-backed, and read-only.
- Exact DTO field names and route presentation for project and session Git/GitHub summaries, as long as explicit `Unknown` and `Unsupported` states remain visible across Projects and Run Audit.
- Exact archive file extension, manifest schema versioning, and import dialog UX, as long as imported archives remain persistent read-only sources with privacy warnings preserved.

### Deferred Ideas (OUT OF SCOPE)
- Rich GitHub comment timelines, reviewer conversation replay, and any PR write actions remain future work beyond Phase 7's read-only snapshot scope.
- Diff-body export, transcript redaction profiles, and deeper privacy tooling belong in a later privacy-focused slice once the basic archive flow exists.
- Rebinding imported archives back to live local repositories or converting them into writable sources stays out of scope for V1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GIT-01 | Shared git provider can collect branch, HEAD SHA, dirty/clean state, changed files, untracked files, additions/deletions, and remote URL using fixed read-only commands. | Add a shared main-process git snapshot service and attach project-scoped snapshots during scan-time derivation or explicit refresh, never in renderer code. [VERIFIED: codebase grep] |
| GIT-02 | Git provider runs only when project-root confidence is adequate and disables or marks git context unknown when no safe root exists. | Treat adapter-provided project-root evidence as input only; validate candidate roots before any git command and preserve explicit `Unknown` or `Unsupported` DTO states otherwise. [VERIFIED: codebase grep] |
| GIT-03 | Optional GitHub provider can detect `gh` availability and collect PR/check/review context through fixed read-only commands without creating or modifying PRs. | Gate GitHub collection behind validated git snapshot plus remote URL, run only fixed `gh` commands in main, and cache the result as shared project state with timeout and auth diagnostics. [VERIFIED: codebase grep] |
| GIT-04 | Export flow can create a harness-neutral archive containing adapter/source/session metadata, normalized data, diagnostics, and optional raw artifacts. | Build export from cache records, source records, and raw-artifact index entries already owned by shared core; record archive metadata and raw-inclusion mode in a manifest. [VERIFIED: codebase grep] |
| GIT-05 | Import flow can load an archive as a read-only source and render imported sessions without the original local source roots. | Register imports as explicit source-registry records backed by a dedicated `archive-reader` adapter and archive-contained normalized payloads, not by live local roots. [VERIFIED: codebase grep] |
| GIT-06 | Raw artifact export warns that transcripts, sidecars, repo paths, and command output may contain sensitive data. | Make raw export opt-in in IPC and UI, keep it disabled when artifacts are not safely indexed, and persist the warning outcome in archive metadata. [VERIFIED: codebase grep] |

Requirement descriptions copied from `.planning/REQUIREMENTS.md`. [VERIFIED: codebase grep]
</phase_requirements>

## Project Constraints (from AGENTS.md and repo contracts)

- Shared naming must stay harness-neutral; do not add shared `Gemini*` types or shared provider-specific UI branches. [VERIFIED: codebase grep]
- Adapters emit evidence and diagnostics only; shared core owns git, GitHub, export/import, verification, and run-audit conclusions. [VERIFIED: codebase grep]
- Missing or unsupported capability states must remain explicit, never flattened into `Clean`, `Passed`, `0`, or an omitted section. [VERIFIED: codebase grep]
- Renderer code must keep consuming typed IPC view models only; it must not read archives, execute `git` or `gh`, or import adapter-private files. [VERIFIED: codebase grep]
- The safe-filesystem allowlist remains the only approved path for raw artifact reads; export/import should reuse it instead of adding ad hoc file access. [VERIFIED: codebase grep]
- Bundled adapters are currently only `fake-test` and `gemini-cli`, so Phase 7 must add any `archive-reader` adapter explicitly instead of assuming it already exists. [VERIFIED: codebase grep]

## Summary

Phase 7 should not be implemented as a renderer feature pass. The hard seam is in shared main-process ownership: the current code already exposes Phase 6 placeholders for git and GitHub in `triage-view-model-service.ts` and `run-audit-view-model-service.ts`, but there is still no shared provider, no persisted project snapshot model, no archive IPC surface, and no imported-archive source metadata in the runtime. [VERIFIED: codebase grep]

The cleanest implementation path is to extend scan-time shared derivation with project-scoped repository snapshots, then surface those snapshots through typed IPC to `Projects` and `Run Audit`. `Scanner.scanSource()` already owns safe filesystem access, normalization validation, shell-command derivation, verification derivation, run-audit derivation, raw-artifact indexing, and cache writes. That makes it the right place to attach read-only git and GitHub enrichment once a validated project root can be resolved. [VERIFIED: codebase grep]

Archive work should follow the same pattern: keep archive creation and import entirely in main, reuse existing cache/registry/index stores, and model imported archives as first-class read-only sources instead of a parallel viewer path. The current `DataSourcesViewModelService` and renderer tests already assume this direction by treating an `archive-reader` source as a normal source row with read-only semantics. [VERIFIED: codebase grep]

**Primary recommendation:** Plan Phase 7 as four tight slices matching the roadmap: `07-01` adds shared git snapshots and root-confidence gating; `07-02` adds optional shared GitHub snapshots and timeout/failure semantics; `07-03` adds archive export over normalized/cache/indexed data with raw opt-in warnings; `07-04` adds import as a persistent read-only source via an `archive-reader` adapter plus registry/runtime/UI support. [VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Project-root confidence evaluation and git root validation | API / Backend | Database / Storage | Adapters provide root evidence only; shared core must validate candidate roots before any git command and persist the resulting trust state. [VERIFIED: codebase grep] |
| Project-scoped git snapshot derivation | API / Backend | Database / Storage | Git snapshot truth should be derived once in main and cached for reuse across Projects and Run Audit, not recomputed in renderer routes. [VERIFIED: codebase grep] |
| Optional GitHub snapshot derivation and failure semantics | API / Backend | Database / Storage | `gh` detection, auth handling, PR lookup, and timeout behavior are shared-provider concerns and must never leak into renderer logic. [VERIFIED: codebase grep] |
| Archive manifest assembly and raw-artifact inclusion checks | API / Backend | Database / Storage | Export depends on normalized cache records, source metadata, diagnostics, and indexed artifact safety checks already owned by shared core. [VERIFIED: codebase grep] |
| Imported archive registration and persistence | API / Backend | Database / Storage | Imported archives should be stored as normal source-registry entries with explicit metadata and read-only operational rules. [VERIFIED: codebase grep] |
| Project and Run Audit presentation of repo truth | Browser / Client | API / Backend | Renderer owns layout, selection, and helper copy, but it should only render typed repo snapshot DTOs and field-level truth states. [VERIFIED: codebase grep] |
| Data Sources import UX and read-only source presentation | Browser / Client | API / Backend | Renderer can trigger import and render source metadata, but main must own file selection, archive parsing, registration, and safety decisions. [VERIFIED: codebase grep] |

## Standard Stack

### Core

| Tooling | Purpose | Why It Fits |
|---------|---------|-------------|
| Existing Electron main/preload/renderer split | Keeps file access, command execution, and archive handling in main. | Phase 2 already established the narrow preload boundary and current IPC handler pattern. [VERIFIED: codebase grep] |
| Existing Zod IPC/view-model schemas | Validates new git, GitHub, export, and import DTOs at the main boundary. | `src/main/ipc/view-models.ts` already centralizes strict request and response shapes. [VERIFIED: codebase grep] |
| Existing file-backed cache and source registry | Persist git/GitHub snapshots and imported-source metadata without introducing a new storage system. | `FileBackedCacheStore` and `FileBackedSourceRegistryStore` already back normalized, derived, and source state on disk. [VERIFIED: codebase grep] |
| Existing safe-filesystem and raw-artifact index | Safely gates raw-artifact export and archive-reader artifact access. | Current ingestion already tracks indexed artifacts and enforces allowlisted reads. [VERIFIED: codebase grep] |

### Supporting

| Tooling | Purpose | When to Use |
|---------|---------|-------------|
| Existing Vitest node tests | Provider, registry, export/import, and IPC contract coverage. | Use for git/GitHub services, archive manifest logic, registry persistence, and IPC handlers. [VERIFIED: codebase grep] |
| Existing jsdom renderer tests | Projects/Data Sources/Run Audit truth-state UI coverage. | Extend tests to prove real snapshot states replace placeholders without collapsing unknown/unsupported fields. [VERIFIED: codebase grep] |

**Installation:**

```bash
# No new phase-specific runtime package install is required for the primary path.
# Reuse the existing Electron, Zod, and Vitest stack already present in the repo.
```

No new package is required for the primary recommendation because the repo already has the runtime, persistence, validation, and test primitives Phase 7 needs. [VERIFIED: codebase grep]

## Architecture Patterns

### System Architecture Diagram

```text
Projects / Run Audit / Data Sources routes
        |
        v
window.agentWorkbench.<typed methods>
        |
        v
IPC handlers + Zod schemas
        |
        v
Main app services
  - triage view models
  - run audit view models
  - data source view models
  - archive import/export coordinators
        |
        v
Shared core services
  - scanner
  - git snapshot provider
  - GitHub snapshot provider
  - archive serializer / archive reader
  - source registry
  - cache store
  - raw artifact index
  - safe filesystem
```

The current app already routes all meaningful truth through main-owned services. Phase 7 should deepen that architecture, not punch through it. [VERIFIED: codebase grep]

### Recommended Project Structure

```text
src/
├── main/
│   ├── app/
│   │   ├── triage-view-model-service.ts
│   │   ├── run-audit-view-model-service.ts
│   │   ├── data-sources-view-model-service.ts
│   │   ├── archive-export-service.ts
│   │   └── archive-import-service.ts
│   ├── core/
│   │   ├── git/
│   │   │   ├── git-snapshot-provider.ts
│   │   │   └── root-confidence.ts
│   │   ├── github/
│   │   │   └── github-snapshot-provider.ts
│   │   ├── archive/
│   │   │   ├── archive-manifest.ts
│   │   │   ├── archive-exporter.ts
│   │   │   └── archive-importer.ts
│   │   └── registry/
│   │       ├── source-registry.ts
│   │       └── register-bundled-adapters.ts
│   └── ipc/
│       ├── channels.ts
│       ├── handlers.ts
│       └── view-models.ts
└── main/adapters/
    └── archive-reader/
        ├── descriptor.ts
        ├── discovery.ts
        └── normalize.ts
```

Exact filenames are discretionary, but Phase 7 needs explicit shared-core modules rather than burying git, GitHub, or archive logic inside renderer helpers or adapter-private code. [VERIFIED: codebase grep]

### Pattern 1: Project Snapshot Derivation in Shared Core

**What:** Extend the shared derivation pipeline to compute project-scoped git and GitHub snapshots once, then cache them for view-model reuse. [VERIFIED: codebase grep]

**Why here:** `Scanner.scanSource()` already owns validated source state, artifact safety, normalization, shell derivation, and cache writes. Adding repo-context enrichment here preserves one truth pipeline instead of inventing a second one in the UI. [VERIFIED: codebase grep]

**Recommended shape:** add a project-level derived snapshot section keyed by `projectId` or by stable project identity. Do not attach repo truth to session-only DTOs and then try to reverse-aggregate it in the renderer. [VERIFIED: codebase grep]

### Pattern 2: Root Confidence as Explicit Provider Input

**What:** Treat project roots as a typed confidence problem rather than a loose `rootPath` string. [VERIFIED: codebase grep]

**Current evidence:** the spec distinguishes `confirmed`, `observed`, `inferred`, and `unknown`, while the current normalized `Project` model only exposes `rootPath` plus free-form metadata. Gemini discovery already emits `sourceKind` metadata and `.project_root` artifacts, but shared-core root-confidence resolution is not implemented yet. [VERIFIED: codebase grep]

**Recommendation:** store root-confidence inputs in project metadata or add a dedicated project snapshot structure in derived cache. Phase 7 does not need to rewrite every normalized entity if a derived project snapshot can carry:
- candidate root path
- confidence label
- validation outcome
- validated repo top level
- reason when git collection is skipped

### Pattern 3: Imported Archives as Source Records, Not Special Tabs

**What:** Import should create a persistent source-registry record backed by a dedicated adapter. [VERIFIED: codebase grep]

**Why:** the current registry, data-source view model service, and renderer tests already express the product as a list of sources with validation/scan/cache/watch state. Reusing that seam keeps archive imports visible, persistent, and compatible with the rest of the app. [VERIFIED: codebase grep]

**Recommendation:** extend `SourceRecord` persistence with explicit metadata such as:
- `sourceKind: "local-root" | "imported-archive"`
- `addedBy: "user" | "import"`
- archive file path or display label
- read-only flags or operation overrides
- archive summary counts and manifest version

Then teach `DataSourcesViewModelService` to expose imported-source labels and to disable validate/scan/watch actions truthfully. [VERIFIED: codebase grep]

### Pattern 4: Archive Export Reads Only Indexed Raw Artifacts

**What:** Raw-artifact export must use the existing raw-artifact index and safe-filesystem rules rather than reading arbitrary files from session metadata. [VERIFIED: codebase grep]

**Why:** `safe-filesystem.ts` already enforces allowed roots and indexed artifacts, and `Scanner.scanSource()` already records indexed artifact paths. Reusing that boundary prevents export from turning into a general local file copier. [VERIFIED: codebase grep]

**Recommendation:** export should:
1. load the selected source/project/session scope from registry/cache
2. gather normalized records and diagnostics
3. optionally include only raw artifacts present in the raw-artifact index and readable through safe filesystem
4. record in the manifest whether raw artifacts were included and what warning gate was accepted

## Don't Hand-Roll

- Do not parse git or GitHub truth from session shell text. Phase 6 explicitly treated those as placeholders, and the spec keeps repo context shared-core-owned. [VERIFIED: codebase grep]
- Do not add renderer-side archive parsing or direct file reads. `DataSourcesRoute.tsx` should trigger typed bridge methods only. [VERIFIED: codebase grep]
- Do not special-case imported archives as an in-memory preview mode. The product already has a source registry; use it. [VERIFIED: codebase grep]
- Do not infer missing repo context as `Clean`, `0`, or no section. The current truth-state vocabulary forbids that collapse. [VERIFIED: codebase grep]
- Do not hide unsupported import/export actions silently. Disable them with explicit reasons so Phase 7 preserves the honesty standard from earlier phases. [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Putting Git Truth in the Renderer

**What goes wrong:** `ProjectsRoute.tsx` and `Run Audit` get ad hoc repo logic or helper fetches, which duplicates truth rules and breaks the preload boundary. [VERIFIED: codebase grep]

**How to avoid:** keep git and GitHub collection in shared core or main-owned services only; renderer consumes DTOs like it already does for verification and audit truth. [VERIFIED: codebase grep]

### Pitfall 2: Treating `rootPath` as Automatically Safe

**What goes wrong:** current normalized projects may have a `rootPath`, but the Phase 7 contract requires root-confidence gating and repo-top-level validation before git commands run. [VERIFIED: codebase grep]

**How to avoid:** make a provider step that confirms repo validity and top-level identity before publishing any snapshot. `observed` can be tried as a candidate, but `inferred` and `unknown` should stop before command execution. [VERIFIED: codebase grep]

### Pitfall 3: Adding Archive Import Without Registry Metadata

**What goes wrong:** imports become invisible, non-persistent, or impossible to distinguish from local roots, which breaks read-only rules and future UX. [VERIFIED: codebase grep]

**How to avoid:** persist imported archives as explicit source records with kind and origin metadata, and register an `archive-reader` adapter in the bundled registry. [VERIFIED: codebase grep]

### Pitfall 4: Exporting Raw Files by Path Alone

**What goes wrong:** archive export bypasses the indexed-artifact allowlist and can copy unrelated local files. [VERIFIED: codebase grep]

**How to avoid:** only export raw artifacts that are already indexed for the selected scope and still pass safe-filesystem checks. [VERIFIED: codebase grep]

### Pitfall 5: Modeling GitHub Failures as Fatal

**What goes wrong:** missing `gh`, missing auth, no PR, or timeouts break the whole route or scan. [VERIFIED: codebase grep]

**How to avoid:** keep GitHub optional and field-scoped. `Unsupported`, `Unknown`, and `No Matching PR` should all be first-class outcomes. [VERIFIED: codebase grep]

## Code Examples

### Example 1: Project Snapshot DTO Direction

```ts
type RepoFieldState =
  | { status: "value"; displayValue: string; rawValue?: string }
  | { status: "unknown"; displayValue: "Unknown"; reason: string }
  | { status: "unsupported"; displayValue: "Unsupported"; reason: string };

interface ProjectRepoSnapshotViewModel {
  rootConfidence: "confirmed" | "observed" | "inferred" | "unknown";
  validatedRepoRoot: RepoFieldState;
  branch: RepoFieldState;
  head: RepoFieldState;
  remoteUrl: RepoFieldState;
  pullRequest: RepoFieldState;
  dirtyState:
    | { label: "Clean" | "Dirty"; tone: "neutral" | "warning" }
    | { label: "Unknown" | "Unsupported"; tone: "neutral"; reason: string };
}
```

This keeps the Phase 6 truth-state pattern intact while allowing Phase 7 to become concrete. [VERIFIED: codebase grep]

### Example 2: Imported Source Persistence Shape

```ts
interface ImportedArchiveMetadata {
  sourceKind: "imported-archive";
  addedBy: "import";
  archivePath: string;
  manifestVersion: number;
  readOnly: true;
}
```

The current `SourceRecord` schema will need to grow to carry this kind of source-specific metadata cleanly. [VERIFIED: codebase grep]

### Example 3: Export Gate Flow

```text
selected scope
  -> load latest cache record(s)
  -> load source record(s)
  -> gather diagnostics
  -> if raw opt-in:
       confirm indexed artifacts exist
       confirm safe-filesystem reads are allowed
       emit privacy warning acceptance in manifest
  -> write archive
```

This matches the current ownership boundaries without inventing a general shell or filesystem escape hatch. [VERIFIED: codebase grep]

## Assumptions Log

- The current file-backed cache and source registry are sufficient for Phase 7 persistence; no storage migration is required for the first slice. [VERIFIED: codebase grep]
- Adding project-level derived snapshot data to cache is acceptable even though current derived data is session-only; this is the least invasive way to keep snapshots cache-backed and shared. [INFERRED from codebase]
- Imported archives can be represented as a dedicated adapter because the adapter registry is already the sanctioned way to add new source families. [VERIFIED: codebase grep]

## Open Questions

- Should project root confidence live in normalized project metadata, a new shared-core derived project snapshot type, or both? Current code does not yet define a canonical shared structure. [VERIFIED: codebase grep]
- Should archive export/import operate at source scope only in V1, or also support project/session-scoped subsets backed by the same manifest format? `07-UI-SPEC.md` allows project and session entry points, but the persistence model can still stay source-oriented internally. [VERIFIED: codebase grep]
- Should imported archives expose archived raw artifacts immediately through the existing artifact-preview seam, or should Phase 7 limit imports to normalized data plus metadata and defer archived raw browsing? The context allows optional raw artifacts but does not require a Phase 7 browsing surface. [VERIFIED: codebase grep]

## Environment Availability

- Phase 7 planning inputs exist: `07-CONTEXT.md`, `07-DISCUSSION-LOG.md`, and approved `07-UI-SPEC.md`. [VERIFIED: codebase grep]
- There is no existing `07-RESEARCH.md` yet, so this artifact is the first research pass for the phase. [VERIFIED: codebase grep]
- There is no shipped `archive-reader` adapter in `src/main/adapters/**` or `register-bundled-adapters.ts` yet. [VERIFIED: codebase grep]
- Current IPC/view-model channels expose only existing triage and data-source operations; Phase 7 archive/export methods will need new channels, schemas, preload types, and handlers. [VERIFIED: codebase grep]

## Validation Architecture

Recommended verification gates for planning and later implementation:

1. Shared-core unit tests for git root validation, git snapshot parsing, GitHub failure semantics, and archive manifest assembly. [VERIFIED: codebase grep]
2. Source-registry persistence tests proving imported archives round-trip with explicit read-only metadata. [VERIFIED: codebase grep]
3. Scanner or coordinator tests proving git/GitHub enrichment only runs for validated roots and never for inferred/unknown roots. [VERIFIED: codebase grep]
4. IPC handler and preload typing tests for new archive/export methods and repo snapshot DTOs. [VERIFIED: codebase grep]
5. Renderer tests proving:
   - Projects stops showing Phase 6 placeholders when real snapshot data exists.
   - Unknown and unsupported repo fields remain explicit when data is unavailable.
   - Data Sources renders imported archive rows and disables live operations truthfully.
   - Run Audit uses shared snapshot truth rather than shell-text inference. [VERIFIED: codebase grep]

## Security Domain

- Keep all `git` and `gh` commands fixed, read-only, and main-owned. Do not add user-supplied shell fragments or renderer-constructed commands. [VERIFIED: codebase grep]
- Keep raw export limited to indexed artifacts and allowlisted reads through `safe-filesystem.ts`. [VERIFIED: codebase grep]
- Keep import as registration of a read-only source only; imported archives must not trigger validate, scan, watch, git, or GitHub operations on host state. [VERIFIED: codebase grep]
- Preserve sanitized UI copy for failures and diagnostics; no raw archive dumps, token leakage, or unbounded command output should cross IPC. [VERIFIED: codebase grep]

## Sources

- `AGENTS.md` [VERIFIED: codebase grep]
- `.planning/ROADMAP.md` [VERIFIED: codebase grep]
- `.planning/REQUIREMENTS.md` [VERIFIED: codebase grep]
- `.planning/STATE.md` [VERIFIED: codebase grep]
- `.planning/phases/07-git-github-export-and-import/07-CONTEXT.md` [VERIFIED: codebase grep]
- `.planning/phases/07-git-github-export-and-import/07-UI-SPEC.md` [VERIFIED: codebase grep]
- `.planning/research/SUMMARY.md` [VERIFIED: codebase grep]
- `.planning/research/FEATURES.md` [VERIFIED: codebase grep]
- `.spec/spec-from-5.5-revision-1.md` [VERIFIED: codebase grep]
- `.spec/additional-instructions.md` [VERIFIED: codebase grep]
- `src/main/app/triage-view-model-service.ts` [VERIFIED: codebase grep]
- `src/main/app/run-audit-view-model-service.ts` [VERIFIED: codebase grep]
- `src/main/app/data-sources-view-model-service.ts` [VERIFIED: codebase grep]
- `src/main/app/workbench-runtime.ts` [VERIFIED: codebase grep]
- `src/main/core/cache/file-backed-cache-store.ts` [VERIFIED: codebase grep]
- `src/main/core/ingestion/scanner.ts` [VERIFIED: codebase grep]
- `src/main/core/registry/source-registry.ts` [VERIFIED: codebase grep]
- `src/main/core/registry/source-registry-store.ts` [VERIFIED: codebase grep]
- `src/main/core/registry/register-bundled-adapters.ts` [VERIFIED: codebase grep]
- `src/main/core/security/safe-filesystem.ts` [VERIFIED: codebase grep]
- `src/main/adapters/gemini-cli/discovery.ts` [VERIFIED: codebase grep]
- `src/main/core/adapter-contract/types.ts` [VERIFIED: codebase grep]
- `src/main/core/model/entities.ts` [VERIFIED: codebase grep]
- `src/main/ipc/view-models.ts` [VERIFIED: codebase grep]
- `src/main/ipc/handlers.ts` [VERIFIED: codebase grep]
- `src/preload/types.ts` [VERIFIED: codebase grep]
- `src/renderer/routes/ProjectsRoute.tsx` [VERIFIED: codebase grep]
- `src/renderer/routes/DataSourcesRoute.tsx` [VERIFIED: codebase grep]
- `tests/renderer/projects-route.test.tsx` [VERIFIED: codebase grep]
- `tests/renderer/data-sources-route.test.tsx` [VERIFIED: codebase grep]

## Metadata

- Research mode: `gsd-plan-phase --research-phase 7`
- Planner intentionally not run in this turn. [VERIFIED: workflow contract]
- External web verification: not used; this research pass is grounded in local repo contracts and current code only.
