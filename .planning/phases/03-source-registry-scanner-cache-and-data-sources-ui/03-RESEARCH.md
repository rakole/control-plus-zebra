# Phase 3: Source Registry, Scanner, Cache, and Data Sources UI - Research

**Researched:** 2026-05-23 [VERIFIED: codebase]  
**Domain:** Electron main-process source management, shared ingestion/cache, typed IPC, and harness-neutral React settings UI [CITED: .planning/ROADMAP.md]  
**Confidence:** HIGH for ownership boundaries and implementation sequence; MEDIUM for shadcn component/package churn because `slopcheck` was unavailable and no official components are installed yet [VERIFIED: codebase]

## User Constraints

### Locked Decisions

- **D-01:** Use a split list/detail management surface for Harnesses and Data Sources rather than a dense table or a single-use wizard. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-02:** The list should make source state scan-friendly at a glance: adapter/display name, root path, enabled state, validation status, latest scan/cache status, and diagnostic count. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-03:** The detail panel should own add/edit/validate/rescan interactions and show capability-aware messages, while avoiding broader Overview/Diagnostics dashboard scope reserved for later phases. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-04:** Adding or editing a source should validate first, then let the user explicitly scan or rescan after validation succeeds. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-05:** Validation failures should preserve the attempted source entry with visible diagnostics instead of silently dropping it or treating it as an empty source. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-06:** Scanning must route through shared scanner orchestration: adapters validate, discover, parse, and normalize, but they do not own unsafe filesystem traversal, watcher lifecycle, cache writes, or final audit conclusions. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-07:** Phase 3 should expose concise operational truth for source/cache state on the Data Sources screen: never scanned, scanning, scan failed, scanned with diagnostics, cached, stale, unsupported, and unknown where applicable. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-08:** Parser, source, cache, and normalization diagnostics should be visible enough for a user to understand why data is missing or stale, without building the full Diagnostics page early. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-09:** Cache and index metadata should preserve adapter ID, source ID, artifact identity, path or native reference, size, mtime, inode when available, parser version, adapter version, schema version, and diagnostics hash so missing or changed evidence is not flattened into success. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-10:** Start with typed path entry plus validation and file-backed source registry persistence. This is the smallest useful read-only UX and avoids adding native picker complexity before the source contract is stable. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-11:** Source registry state should persist configured roots, display names, adapter IDs, enabled/disabled state, validation result summary, and last scan/cache summary using a local file-backed store. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-12:** The fake adapter should remain usable as the first Phase 3 proof source, but the source registry and IPC/UI naming must stay harness-neutral and ready for Gemini CLI in Phase 4. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-13:** Persist and display source enabled/disabled state and adapter watch-plan support, but keep full live watching controls mostly internal in Phase 3. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-14:** Shared watcher orchestration should consume adapter watch plans and own watcher lifecycle boundaries; adapters must not create watchers directly. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- **D-15:** If watch support is unsupported or unknown for a source or adapter, the UI should say unsupported or unknown instead of implying zero activity or a clean source. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]

### the agent's Discretion

- Exact file/module breakdown for source registry, scanner, artifact index, cache, and Data Sources IPC view models, as long as ownership stays in `src/main/core/**`, main-process composition, preload/IPC, and renderer DTO boundaries. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- Exact visual density and component names for the Data Sources page, as long as it reads like a quiet local desktop settings/workbench surface and does not become a marketing page. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- Exact local file format for source registry and normalized cache, as long as it is deterministic, adapter/source-aware, testable, and avoids native database packaging risk in V1. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- Exact scan-status enum names, as long as unsupported, unknown, stale, failed, and diagnostics-bearing states remain distinct from empty/success states. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]

### Deferred Ideas

- Native macOS directory/file picker UX can be added after typed-path source registry behavior is proven. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- Deep cache inspector and full Diagnostics page belong after the scanner/cache contracts are stable and Phase 6 owns diagnostics UI depth. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- Full live watcher controls and real-time scan UX should wait until watcher orchestration behavior is implemented and tested enough to expose safely. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]

## Project Constraints (from AGENTS.md)

- Agent Workbench is a local-first macOS desktop app for observing, replaying, and auditing local coding-agent sessions across CLI harnesses. [CITED: AGENTS.md]
- V1 is read-only: no session launching, approve/reject, terminal control, PR creation, branch/worktree cleanup, arbitrary shell execution, or source-root mutation. [CITED: AGENTS.md]
- Gemini CLI is the first real adapter, not the architecture; a fake/stub second adapter must prove core and UI are not Gemini-hardcoded. [CITED: AGENTS.md]
- Unsupported evidence must render as unsupported or unknown, never as zero, passed, clean, or hidden. [CITED: AGENTS.md]
- Shared naming must stay harness-neutral with `Harness`, `Session`, `SessionEvent`, `RawHarnessEvent`, `ToolCall`, `OutputArtifact`, and `ShellCommandEvidence`; shared `Gemini*` types are forbidden. [CITED: AGENTS.md]
- Every normalized entity from harness data carries `adapterId` and, where relevant, `sourceId`. [CITED: AGENTS.md]
- Adapters emit evidence and diagnostics, not final verification states, run audit classifications, or attention reasons. [CITED: AGENTS.md]
- `src/main/core/**` owns source registry, ingestion, watcher orchestration, cache, IPC view models, diagnostics, and security; adapters own harness-specific discovery/parsing/mapping; renderer consumes IPC view models only. [CITED: AGENTS.md]
- Renderer has no Node integration, no broad Electron APIs, no arbitrary file reads, and no shell execution; preload exposes one typed method per allowed IPC operation. [CITED: AGENTS.md]
- Project workflow requires GSD entry points before file changes; this artifact is produced under `$gsd-plan-phase --research-phase 3` research-only mode. [CITED: AGENTS.md]

## Summary

Phase 3 should be planned as a shared-core ingestion foundation with a thin Data Sources UI over typed DTOs, not as a renderer feature or fake-adapter shortcut. [CITED: .planning/ROADMAP.md] The current code already has the adapter contract lifecycle, fake adapter, adapter registry, deterministic ID helpers, Zod IPC DTOs, narrow preload bridge, renderer shell, and boundary tests that Phase 3 should extend. [VERIFIED: codebase]

The biggest implementation gap is that adapters currently use direct Node filesystem calls in the fake adapter, while `DATA-02` requires adapters to receive safe filesystem helpers scoped to configured source roots and indexed artifacts. [VERIFIED: codebase] The planner should schedule the safe-filesystem/context change before scanner/cache work so source validation, artifact discovery, parsing, and output-artifact loading all use the same allowlisted path boundary. [CITED: .planning/REQUIREMENTS.md]

**Primary recommendation:** implement Phase 3 in four slices matching the roadmap: source registry and safe filesystem first, scanner/index/normalization validation second, file-backed cache third, and Data Sources UI/IPC last, with each slice adding contract and boundary tests before UI breadth. [CITED: .planning/ROADMAP.md]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | User can configure, enable, disable, and validate harness source roots through shared source registry behavior. | Use a file-backed `SourceRegistry` under shared core, exposed through typed `sources:*` IPC DTOs and Data Sources UI state. [CITED: .planning/REQUIREMENTS.md] |
| DATA-02 | Adapters receive only safe filesystem helpers scoped to configured source roots and indexed output artifacts. | Extend `AdapterContext` from `{ projectDir, platform }` to include scoped helper methods; refactor fake adapter direct `stat`/`readFile` use. [VERIFIED: codebase] |
| DATA-03 | Shared scanner asks enabled adapters to validate roots, discover sources, discover artifacts, parse changed artifacts, and normalize raw events. | Reuse the existing fake service lifecycle but move orchestration from `session-view-model-service.ts` into `src/main/core/ingestion/scanner.ts`. [VERIFIED: codebase] |
| DATA-04 | Raw artifact indexing tracks adapter/source/artifact/path/native-ref/size/mtime/inode/parser/adapter/schema/diagnostics inputs. | Current `RawArtifactRef` has adapter/source/path/byteLength/mtime but lacks inode/parser version/schema version/diagnostics hash, so add an index entry type. [VERIFIED: codebase] |
| DATA-05 | Global session IDs and cache keys include adapter identity and source identity. | Existing `createSessionId` and other helpers already include `adapterId` and optional `sourceId`; cache key helpers should build on this pattern. [VERIFIED: codebase] |
| DATA-06 | Shared normalization validation rejects or diagnoses malformed adapter output before merge. | Current runtime validation exists for fake fixtures and IPC DTOs, but not for normalized adapter output; add Zod schemas or equivalent validator in shared ingestion. [VERIFIED: codebase] |
| DATA-07 | Shared watcher orchestration consumes adapter watch plans instead of allowing adapters to own watcher lifecycle. | Current `SessionSourceAdapter` has no `getWatchPlan`, while capabilities include `watchPlans`; add a watch-plan contract and shared orchestrator boundary. [VERIFIED: codebase] |
| DATA-08 | File-backed normalized cache supports V1 without requiring native database packaging. | Project research and AGENTS lock file-backed cache first and SQLite later only if realistic volume proves it necessary. [CITED: .planning/research/STACK.md] |
| UI-06 | User can manage harnesses and data sources from a Harnesses and Data Sources settings page. | Build `/data-sources` using the approved split list/detail UI contract and exact state labels. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md] |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Source registry persistence | API / Backend (Electron main shared core) | Database / Storage (file-backed JSON/cache files) | Source state includes paths and validation/cache summaries and must not be owned by renderer or adapters. [CITED: AGENTS.md] |
| Safe filesystem helpers | API / Backend (Electron main shared core) | OS filesystem | Main/core owns allowlisted reads and path checks; adapters consume helper methods only. [CITED: .planning/REQUIREMENTS.md] |
| Adapter validation/discovery/parsing/mapping | API / Backend (adapter behind shared contract) | API / Backend (scanner orchestrator) | Adapters know harness-specific layouts, while scanner owns lifecycle, safe context, index, and cache writes. [CITED: .spec/spec-from-5.5-revision-1.md] |
| Raw artifact index | API / Backend (shared ingestion) | Database / Storage (file-backed cache) | Index identity and staleness decisions are cross-adapter and must include adapter/source/schema inputs. [CITED: .spec/spec-from-5.5-revision-1.md] |
| Normalization validation | API / Backend (shared ingestion) | Adapter output boundary | Adapter output must be validated before merging into the normalized store. [CITED: .planning/REQUIREMENTS.md] |
| File-backed normalized cache | API / Backend (shared cache service) | Database / Storage (local userData/test tmpdir) | V1 avoids native database packaging and stores deterministic adapter/source-aware records locally. [CITED: .planning/research/STACK.md] |
| Watcher orchestration boundary | API / Backend (shared watcher service) | OS filesystem watcher | Adapters may declare plans/capability truth but must not create watcher lifecycles directly. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md] |
| Data Sources UI | Browser / Client (React renderer) | Preload typed bridge | Renderer renders view models and cannot read paths, inspect files, or import main/adapter internals. [CITED: AGENTS.md] |

## Standard Stack

### Core

| Library / Runtime | Current Version | Purpose | Planner Guidance |
|-------------------|-----------------|---------|------------------|
| Electron | 42.2.0 | Desktop shell, main process, preload bridge, local packaged renderer. [VERIFIED: npm registry] | Keep security defaults: no Node integration, context isolation, sandboxing, restrictive CSP, and no broad Electron API exposure. [CITED: https://www.electronjs.org/docs/latest/tutorial/security] |
| Electron Forge + Vite plugin | 7.11.2 | Development, packaging, and Vite integration. [VERIFIED: npm registry] | Existing app already uses Forge/Vite config; do not re-scaffold Phase 3. [VERIFIED: codebase] |
| Vite | 8.0.14 | Renderer build tooling. [VERIFIED: npm registry] | Existing Vite renderer target is `chrome148` and alias `@` points to `src/renderer`; preserve it when adding UI files. [VERIFIED: codebase] |
| React / React DOM | 19.2.6 | Renderer UI. [VERIFIED: npm registry] | Use existing route/state patterns in `SessionsRoute.tsx` for loading, empty, error, reload, and split list/detail behavior. [VERIFIED: codebase] |
| React Router | 7.15.1 | Hash-based client routing. [VERIFIED: npm registry] | Add `/data-sources` beside `/sessions` and preserve `/sessions`; Phase 3 may default to `/data-sources` per UI spec. [VERIFIED: codebase] |
| TypeScript | 6.0.3 | Shared contracts across main/preload/renderer/tests. [VERIFIED: npm registry] | Keep `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and NodeNext ESM settings. [VERIFIED: codebase] |
| Zod | 4.4.3 | Runtime validation for IPC DTOs, fixtures, and new registry/cache/normalized-output schemas. [VERIFIED: npm registry] | Use `.strict()` DTO schemas like current IPC view models; do not rely on TypeScript-only validation for adapter output. [VERIFIED: codebase] |

### Supporting

| Library / Runtime | Current Version | Purpose | Planner Guidance |
|-------------------|-----------------|---------|------------------|
| Vitest | 4.1.7 | Node and renderer tests. [VERIFIED: npm registry] | Existing `vitest.config.ts` has `node` and `renderer` projects; add tests in matching folders instead of introducing another runner. [VERIFIED: codebase] |
| @testing-library/react | 16.3.2 | Renderer component/route tests. [VERIFIED: npm registry] | Extend current renderer route test style for Data Sources interactions and unknown/unsupported labels. [VERIFIED: codebase] |
| lucide-react | 1.16.0 | Icons in renderer navigation/actions. [VERIFIED: npm registry] | Use lucide icons for Data Sources nav/action buttons per UI design guidance. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md] |
| shadcn CLI package | 4.8.0 | Official component generation after config validation. [VERIFIED: npm registry] | Current `npm exec shadcn -- info` succeeds, but UI-SPEC records an earlier invalid-config warning; plan an explicit validation gate before adding components. [VERIFIED: codebase] |
| Tailwind CSS / @tailwindcss/vite | 4.3.0 | Current dirty checkout has Tailwind/shadcn styling imports and Vite plugin wiring. [VERIFIED: codebase] | Do not revert existing dirty style/config changes; validate them before deciding whether to add official components. [VERIFIED: codebase] |
| Node `fs/promises`, `path`, `crypto` | Node 26.0.0 runtime available locally; Electron bundles Node 24.15.0. [VERIFIED: codebase] | Use built-in filesystem/path/hash APIs inside shared core; do not add a native database or shell dependency for Phase 3. [CITED: https://nodejs.org/api/fs.html] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File-backed JSON/cache files | SQLite/native module | SQLite improves query scale later but conflicts with the locked V1 file-backed-first decision and native packaging avoidance. [CITED: .planning/research/STACK.md] |
| Typed path entry | Native macOS directory picker | Native picker is explicitly deferred until source registry behavior is proven. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md] |
| Existing CSS classes or official shadcn components | Third-party blocks/registries | Third-party registries are not approved for Phase 3. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md] |
| Built-in shared scanner | Adapter-owned scanner/cache/watcher | Adapter ownership violates DATA-02/DATA-03/DATA-07 and recreates first-adapter lock-in. [CITED: .planning/REQUIREMENTS.md] |

**Installation:** No blanket package install is recommended for Phase 3 planning. [VERIFIED: codebase] If implementation chooses official shadcn components, use the local package command after validation: [VERIFIED: codebase]

```bash
npm exec shadcn -- info
npm exec shadcn -- add button badge input label select switch separator scroll-area tooltip skeleton alert --dry-run
```

## Package Legitimacy Audit

Phase 3 does not need a new runtime library for source registry, scanner, cache, or IPC because existing Node/Electron/TypeScript/Zod/Vitest primitives cover the required work. [VERIFIED: codebase] Official shadcn component generation may introduce a `radix-ui` dependency because dry-run generated `select.tsx` imports `radix-ui`, and `radix-ui` is not currently installed. [VERIFIED: codebase]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| Existing dependencies in `package.json` | npm | Varies by package; npm metadata checked for current versions and repository URLs. [VERIFIED: npm registry] | Not fetched in this research pass. [ASSUMED] | Electron/React/Vite/Zod/Vitest/shadcn/lucide repositories returned by npm metadata. [VERIFIED: npm registry] | unavailable | Approved as existing project state; do not add unrelated packages. [VERIFIED: codebase] |
| `radix-ui` | npm | Created 2022-08-01; modified 2025-12-17. [VERIFIED: npm registry] | Not fetched in this research pass. [ASSUMED] | `github.com/radix-ui/primitives`. [VERIFIED: npm registry] | unavailable | Flagged: planner should add `checkpoint:human-verify` before any install or use CSS fallback. [ASSUMED] |

**Packages removed due to slopcheck [SLOP] verdict:** none; `slopcheck` command was not available after best-effort install. [VERIFIED: codebase]  
**Packages flagged as suspicious [SUS]:** none by slopcheck because slopcheck did not run; `radix-ui` is human-verification gated solely due unavailable slopcheck and potential new install. [VERIFIED: codebase]

## Architecture Patterns

### System Architecture Diagram

```text
Data Sources Route
  -> window.agentWorkbench.* source methods
  -> preload one-method-per-operation bridge
  -> IPC handlers with Zod request/response DTOs
  -> DataSourcesViewModelService
  -> SourceRegistry + AdapterRegistry
  -> SourceValidator builds safe AdapterContext
  -> Scanner orchestrator
      -> adapter.validateSourceRoot
      -> adapter.discoverSources
      -> adapter.discoverArtifacts
      -> RawArtifactIndex changed/unchanged decision
      -> adapter.parseArtifact
      -> adapter.normalize
      -> NormalizationValidator
      -> SessionMerger / normalized graph
      -> FileBackedCache
  -> source/cache/diagnostic DTOs
  -> split list/detail UI labels
```

The diagram follows the locked ownership split: renderer uses typed IPC, shared core owns registry/scanner/cache/watcher/security, and adapters provide harness evidence only. [CITED: AGENTS.md]

### Recommended Project Structure

```text
src/main/core/
  registry/
    source-registry.ts
    source-registry-store.ts
  security/
    safe-filesystem.ts
    path-allowlist.ts
  ingestion/
    scanner.ts
    raw-artifact-index.ts
    normalization-validator.ts
    session-merger.ts
  cache/
    cache-keys.ts
    file-backed-cache-store.ts
  watcher/
    watch-plan.ts
    watch-orchestrator.ts
src/main/app/
  data-sources-view-model-service.ts
src/main/ipc/
  channels.ts
  view-models.ts
  handlers.ts
src/preload/
  index.ts
  types.ts
src/renderer/routes/
  DataSourcesRoute.tsx
src/renderer/components/
  DataSourceList.tsx
  DataSourceDetail.tsx
  SourceStatusBadge.tsx
tests/main/core/
  source-registry.test.ts
  safe-filesystem.test.ts
  scanner.test.ts
  raw-artifact-index.test.ts
  file-backed-cache-store.test.ts
tests/main/ipc/
  data-sources-ipc.test.ts
tests/renderer/
  data-sources-route.test.tsx
```

This structure keeps shared implementation under `src/main/core/**`, keeps route DTO assembly in `src/main/app/**`, and keeps renderer imports away from main internals. [CITED: AGENTS.md]

### Pattern 1: Source Registry as File-Backed State, Not Adapter State

**What:** store configured source records with `sourceId`, `adapterId`, `displayName`, `rootPath`, `enabled`, validation summary, scan/cache summary, diagnostics, and timestamps. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]  
**When to use:** every add/edit/enable/disable/validate/list operation. [CITED: .planning/REQUIREMENTS.md]  
**Planning detail:** persist runtime files under an injected app-data directory; in Electron runtime, `app.getPath('userData')` is the standard place for app configuration files and subdirectories. [CITED: https://www.electronjs.org/docs/latest/api/app]

### Pattern 2: Safe Filesystem Context Before Adapter Calls

**What:** scanner creates an `AdapterContext` with scoped helpers such as `statAllowedPath`, `readAllowedTextFile`, `listAllowedDirectory`, and `resolveAllowedArtifact`, and adapters do not import `node:fs` directly for source-root reads. [CITED: .planning/REQUIREMENTS.md]  
**Current gap:** `fake-test/discovery.ts` imports `stat` and `fake-test/parse.ts` imports `readFile`, so DATA-02 requires contract and fake-adapter refactoring. [VERIFIED: codebase]  
**Implementation rule:** path checks should canonicalize real paths and compare against configured roots; Node `fs.realpath` resolves symlinks and `path.relative/resolve` provide path comparison primitives. [CITED: https://nodejs.org/api/fs.html]

### Pattern 3: Shared Scanner Pipeline

**What:** move the current fake fixture lifecycle from `session-view-model-service.ts` into `src/main/core/ingestion/scanner.ts`. [VERIFIED: codebase]  
**When to use:** explicit `Validate Source`, `Scan Source`, and `Rescan Source` IPC operations. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]  
**Decision point:** validation must not scan, and editing adapter/path must reset or stale the validation/scan state until explicit validation succeeds again. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]

### Pattern 4: Raw Artifact Index Before Parsing

**What:** store one index record per artifact with adapter/source identity, artifact identity, path/native ref, size, mtime, inode when available, parser version, adapter version, schema version, and diagnostics hash. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]  
**When to use:** before deciding whether to parse or mark cache stale. [CITED: .spec/spec-from-5.5-revision-1.md]  
**Current gap:** `RawArtifactRef` has `byteLength` and `mtimeMs` but not inode, parser version, schema version, or diagnostics hash. [VERIFIED: codebase]

### Pattern 5: Runtime Normalization Validation

**What:** validate `AdapterNormalizationResult` fragments before merging/cache writes and convert malformed fragments into diagnostics where possible. [CITED: .planning/REQUIREMENTS.md]  
**When to use:** after every adapter `normalize` call. [CITED: .spec/spec-from-5.5-revision-1.md]  
**Library:** use Zod because current IPC schemas and fake fixture parsing already use Zod strict parsing. [VERIFIED: codebase]

### Pattern 6: File-Backed Cache With Adapter/Source-Aware Keys

**What:** cache key should include `adapterId`, `sourceId`, raw artifact identity, path/native ref, mtime, size, adapter version, parser version, normalization schema version, and diagnostics hash. [CITED: .spec/spec-from-5.5-revision-1.md]  
**When to use:** normalized sessions, raw artifact index, source scan summaries, diagnostics, and cache stale detection. [CITED: .planning/REQUIREMENTS.md]  
**Existing helper:** build on `createSessionId`, `createRawArtifactId`, and related stable ID helpers that already include `adapterId` and optional `sourceId`. [VERIFIED: codebase]

### Pattern 7: Watcher Orchestration Boundary

**What:** add a watch-plan contract and shared orchestrator, but keep UI controls read-only/metadata-level in Phase 3. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]  
**When to use:** expose watch support as `Watch Supported`, `Watch Unsupported`, or `Watch Unknown`; do not auto-start broad live watching from the renderer. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]  
**Implementation note:** Node exposes filesystem watch APIs, but Phase 3 planning should prefer a minimal orchestrator interface unless a specific slice requires live event handling. [CITED: https://nodejs.org/api/fs.html]

### Pattern 8: IPC/Preload DTO Expansion

**What:** extend `IPC_CHANNELS`, `ALLOWED_IPC_CHANNELS`, `view-models.ts`, `handlers.ts`, `preload/index.ts`, and `preload/types.ts` with one method per source operation. [VERIFIED: codebase]  
**When to use:** `harnesses:list`, `sources:list`, `sources:add`, `sources:update`, `sources:setEnabled`, `sources:validate`, and `sources:scan` or equivalent harness-neutral names. [CITED: .spec/spec-from-5.5-revision-1.md]  
**Security rule:** Electron docs show `ipcRenderer.invoke` paired with `ipcMain.handle`, and current tests forbid exposing generic invoke/send/on helpers. [CITED: https://www.electronjs.org/docs/latest/tutorial/ipc]

### Pattern 9: Data Sources UI Integration

**What:** add `/data-sources` route, activate Data Sources navigation, keep Overview/Projects/Diagnostics disabled, and preserve Sessions route. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]  
**When to use:** after source DTOs exist, so renderer remains view-model-driven and path validation stays in main. [CITED: AGENTS.md]  
**UI labels:** use exact labels from UI-SPEC for validation, scan/cache, watch support, capability truth, CTAs, empty/error copy, and disabled nav tooltip. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Adapter registry | A new per-feature adapter list | Existing `AdapterRegistry` and `registerBundledAdapters` | Current registry already lists descriptors and enforces unique adapter IDs. [VERIFIED: codebase] |
| Stable IDs | Ad hoc string concatenation | `createSourceId`, `createSessionId`, `createRawArtifactId`, cache-key helper built on same parts | Existing helpers hash `kind`, `adapterId`, optional `sourceId`, and native ID. [VERIFIED: codebase] |
| Runtime DTO validation | TypeScript-only request/response types | Zod `.strict()` schemas in `src/main/ipc/view-models.ts` | Current IPC handlers parse requests and responses through Zod schemas. [VERIFIED: codebase] |
| IPC bridge | Generic `invoke(channel, payload)` bridge | One named preload method per allowed operation | Current preload API tests enforce exact method names and forbid generic IPC exposure. [VERIFIED: codebase] |
| Source path security | Renderer path probing or adapter `fs` imports | Main-process safe filesystem helpers scoped to configured roots | Renderer must not read files and adapters must not own unsafe traversal. [CITED: AGENTS.md] |
| Cache backend | Native SQLite in V1 | File-backed cache abstraction | File-backed cache first is locked; SQLite is deferred until volume proves need. [CITED: AGENTS.md] |
| Data Sources components | Third-party UI block or marketing layout | Approved split list/detail surface using existing CSS or official shadcn components after validation | UI-SPEC forbids third-party registries and broader Phase 6 dashboard scope. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md] |
| Watch lifecycle | Adapter-created watchers | Shared watcher orchestrator consuming adapter watch plans | DATA-07 requires shared watcher orchestration. [CITED: .planning/REQUIREMENTS.md] |

**Key insight:** Phase 3 succeeds by centralizing unsafe filesystem, cache, watcher, and truth-state decisions in shared core; custom per-adapter shortcuts are the main long-term risk. [CITED: .planning/research/PITFALLS.md]

## Common Pitfalls

### First-Adapter Lock-In

**What goes wrong:** source registry, IPC names, cache keys, or UI behavior become fake-test/Gemini-shaped. [CITED: .planning/research/PITFALLS.md]  
**Why it happens:** the fake adapter is currently the only working data source and `session-view-model-service.ts` hardcodes its fixture path. [VERIFIED: codebase]  
**How to avoid:** create harness-neutral `sources:*`/`harnesses:*` DTOs, route all adapters through registry/scanner, and keep provider-specific text to descriptor labels/capability gates. [CITED: AGENTS.md]  
**Warning signs:** shared `Gemini*` symbols, `adapterId === "gemini-cli"` branches, or source UI logic that assumes fake fixture files. [VERIFIED: codebase]

### Unsafe Filesystem Boundaries

**What goes wrong:** renderer or adapter code reads arbitrary paths or follows traversal/symlink escapes. [CITED: .planning/REQUIREMENTS.md]  
**Why it happens:** current fake adapter uses direct `stat` and `readFile`, and typed path entry makes path validation tempting in the renderer. [VERIFIED: codebase]  
**How to avoid:** build safe filesystem helpers in main/core and make renderer validate only form emptiness while main validates existence/scope. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]  
**Warning signs:** `fs` imports under `src/renderer/**`, adapter-owned watcher creation, or IPC methods named like generic file read. [VERIFIED: codebase]

### Cache Key Identity Collisions

**What goes wrong:** same native session ID or artifact path from different adapters/sources merges or overwrites cache entries. [CITED: .planning/research/PITFALLS.md]  
**Why it happens:** cache keys omit `adapterId`, `sourceId`, schema version, parser version, or diagnostics hash. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]  
**How to avoid:** define cache keys centrally and test same native session ID across two sources/adapters. [CITED: .planning/REQUIREMENTS.md]  
**Warning signs:** helper functions accepting only `nativeSessionId` or artifact path. [VERIFIED: codebase]

### Stale/Unsupported Truth Flattening

**What goes wrong:** unknown/stale/unsupported/diagnostics-bearing source states render as cached, clean, zero, or hidden. [CITED: AGENTS.md]  
**Why it happens:** metrics prefer numbers and current session summary counts are numeric evidence counts. [VERIFIED: codebase]  
**How to avoid:** Data Sources DTOs must carry enum labels for validation, scan/cache, watch, diagnostics, and capability truth instead of deriving labels from counts. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]  
**Warning signs:** `diagnostics.length || 0` used as a proxy for healthy state or disabled source shown as clean. [CITED: .planning/research/PITFALLS.md]

### Renderer/Main/Adapters Import Leaks

**What goes wrong:** renderer imports main/adapters or shared core imports adapter-private modules outside bundled registry. [VERIFIED: codebase]  
**Why it happens:** Data Sources UI needs adapter labels and capabilities, so direct descriptor imports can look convenient. [VERIFIED: codebase]  
**How to avoid:** extend `tests/boundaries/import-boundaries.test.ts`, `shared-naming.test.ts`, and `renderer-boundary-source.test.ts` as new files are added. [VERIFIED: codebase]  
**Warning signs:** renderer import path includes `../main`, `src/main`, or `adapters`. [VERIFIED: codebase]

### Watcher Ownership Drift

**What goes wrong:** adapters create watchers or renderer exposes live watch controls before orchestrator safety is proven. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]  
**Why it happens:** adapters know artifact layouts and UI-SPEC asks to show watch support. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]  
**How to avoid:** add a watch-plan data contract and render support truth, but keep lifecycle in shared main/core. [CITED: .planning/REQUIREMENTS.md]  
**Warning signs:** `fs.watch` or chokidar usage under `src/main/adapters/**`, or UI controls for start/stop live watching. [CITED: .planning/REQUIREMENTS.md]

### Shadcn Config Repair Risk

**What goes wrong:** implementation reinitializes shadcn, changes preset/style unexpectedly, installs unvetted packages, or reverts current dirty config repair. [VERIFIED: codebase]  
**Why it happens:** UI-SPEC records `invalid-info-command`, but current `npm exec shadcn -- info` succeeds and reports no installed components. [VERIFIED: codebase]  
**How to avoid:** first task should run `npm exec shadcn -- info`; if it succeeds, use dry-run for approved components or keep existing CSS fallback; if it fails, repair minimally without changing route behavior. [VERIFIED: codebase]  
**Warning signs:** `shadcn init` rerun, preset churn, third-party registry additions, or `radix-ui` install without human verification while slopcheck is unavailable. [VERIFIED: codebase]

## Code Examples

### Existing Adapter Lifecycle to Extract Into Scanner

`src/main/app/session-view-model-service.ts` currently validates the fake root, discovers source, discovers artifacts, parses raw events, and normalizes them in one service. [VERIFIED: codebase]

```typescript
const validation = await adapter.validateSourceRoot({ rootPath: fakeFixturePath }, context);
const [source] = await collectAsync(adapter.discoverSources({ rootPath: fakeFixturePath }, context));
const artifacts = await collectAsync(adapter.discoverArtifacts(source, context));
const rawEvents = await collectRawEvents(adapter.parseArtifact, artifacts, context);
return adapter.normalize({ source, artifacts, rawEvents }, context);
```

Planner action: move this sequence into a shared scanner and inject source registry records instead of the hardcoded fake fixture path. [VERIFIED: codebase]

### Existing Stable ID Pattern

`src/main/core/model/identifiers.ts` builds stable IDs from `kind`, `adapterId`, optional `sourceId`, and `nativeId`. [VERIFIED: codebase]

```typescript
export function createSessionId(parts: StableIdentityParts): SessionId {
  return buildStableId("session", parts);
}
```

Planner action: implement `createCacheKey` with the same adapter/source discipline plus artifact and version inputs. [CITED: .spec/spec-from-5.5-revision-1.md]

### Existing IPC Handler Pattern

`src/main/ipc/handlers.ts` validates requests, catches implementation failures, and returns sanitized errors. [VERIFIED: codebase]

```typescript
const request = getSessionByIdRequestSchema.safeParse(payload);
if (!request.success) {
  return buildInvalidRequestError();
}
```

Planner action: source handlers should follow the same shape and must not leak raw paths, stack traces, raw events, or adapter-private object names. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]

### Existing Preload Bridge Pattern

`src/preload/index.ts` exposes named methods on `window.agentWorkbench`, and tests reject generic helper names. [VERIFIED: codebase]

```typescript
const agentWorkbench: AgentWorkbenchBridge = Object.freeze({
  listSessions(request: ListSessionsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listSessions, request);
  }
});
```

Planner action: add `listDataSources`, `addDataSource`, `updateDataSource`, `validateDataSource`, `scanDataSource`, and `setDataSourceEnabled` as named methods. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]

### Safe Filesystem Helper Sketch

The source registry must validate paths in main/core and adapters should receive scoped helpers instead of unrestricted filesystem APIs. [CITED: .planning/REQUIREMENTS.md]

```typescript
export interface SafeFilesystem {
  statAllowed(path: string): Promise<AllowedFileStat>;
  readTextAllowed(path: string, options?: { maxBytes?: number }): Promise<string>;
  listAllowed(path: string): AsyncIterable<AllowedDirectoryEntry>;
}
```

Planner action: tests should prove `../` traversal, symlink escape, disabled source, and unindexed output-artifact reads fail with diagnostics. [CITED: .planning/REQUIREMENTS.md]

## Verification Strategy

### Commands Already Run During Research

| Command | Result | Notes |
|---------|--------|-------|
| `npm run typecheck` | PASS | TypeScript strict compile completed with exit code 0. [VERIFIED: codebase] |
| `npm run test:boundaries` | PASS | 2 files and 9 boundary tests passed. [VERIFIED: codebase] |
| `npm run test -- tests/main/ipc/ipc-handlers.test.ts tests/preload/preload-api-surface.test.ts tests/renderer/renderer-boundary-source.test.ts` | PASS | 3 files and 8 targeted IPC/preload/renderer boundary tests passed. [VERIFIED: codebase] |
| `npm test` | PASS | 15 files and 43 tests passed. [VERIFIED: codebase] |
| `npm exec shadcn -- info` | PASS | Current dirty checkout has valid shadcn config and no installed components. [VERIFIED: codebase] |
| `npm exec shadcn -- add button badge input label select switch separator scroll-area tooltip skeleton alert --dry-run` | PASS | Dry-run would create 11 official component files and wrote no files. [VERIFIED: codebase] |

### Planner Test Map

| Requirement | Required Tests / Checks |
|-------------|-------------------------|
| DATA-01 | Unit tests for registry create/update/enable/disable/persist/reload/validation failure preserved. [CITED: .planning/REQUIREMENTS.md] |
| DATA-02 | Safe filesystem tests for root scoping, traversal rejection, symlink escape rejection, disabled source rejection, and indexed artifact allowlist. [CITED: .planning/REQUIREMENTS.md] |
| DATA-03 | Scanner tests using fake adapter to assert validate -> discover source -> discover artifact -> parse changed artifacts -> normalize order. [VERIFIED: codebase] |
| DATA-04 | Raw artifact index tests for size/mtime/inode/version/diagnostics hash stale detection. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md] |
| DATA-05 | Collision tests where two sources/adapters share native session/artifact IDs but produce distinct global IDs/cache keys. [CITED: .planning/research/PITFALLS.md] |
| DATA-06 | Normalization validator tests for malformed missing adapter/source/session links and diagnostics instead of store merge. [CITED: .planning/REQUIREMENTS.md] |
| DATA-07 | Watch-plan contract tests proving adapters return plan metadata and shared orchestrator owns watcher creation. [CITED: .planning/REQUIREMENTS.md] |
| DATA-08 | File-backed cache tests for deterministic writes, reload, stale marking, and no SQLite/native dependency. [CITED: .planning/research/STACK.md] |
| UI-06 | Renderer tests for `/data-sources`, split list/detail, typed path only, explicit unsupported/unknown/stale/failed labels, no forbidden mutation labels, and no adapter-specific branches. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md] |

### Phase Gate Commands

```bash
npm run typecheck
npm run test:boundaries
npm test
npm run test:renderer
npm exec shadcn -- info
```

The planner should add narrower per-plan commands, but the phase gate should require full typecheck, full Vitest suite, boundary tests, renderer tests, and shadcn config validation. [VERIFIED: codebase]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript/Vite/Vitest/npm scripts | yes | v26.0.0 | Electron runtime bundles Node 24.15.0 for app execution. [VERIFIED: codebase] |
| npm | package metadata, scripts, local shadcn CLI | yes | 11.12.1 | none needed. [VERIFIED: codebase] |
| shadcn CLI | Optional official component generation | yes | 4.8.0 from `package.json` | Use existing CSS classes if component add is deferred. [VERIFIED: codebase] |
| Context7 CLI `ctx7` | Optional docs lookup fallback | no | unavailable | Official docs and npm metadata were used directly. [VERIFIED: codebase] |
| slopcheck | Package legitimacy gate | no | unavailable | Gate any new package install behind human verification. [VERIFIED: codebase] |

**Missing dependencies with no fallback:** none for source registry/scanner/cache using existing dependencies. [VERIFIED: codebase]  
**Missing dependencies with fallback:** `slopcheck` is missing; fallback is human verification before any new install, especially potential `radix-ui`. [VERIFIED: codebase]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Local desktop V1 has no auth/session login surface. [CITED: .planning/PROJECT.md] |
| V3 Session Management | no | Product sessions are observed harness records, not authenticated web sessions. [CITED: .planning/PROJECT.md] |
| V4 Access Control | yes | Enforce source-root allowlists and indexed-artifact access in main/core. [CITED: .planning/REQUIREMENTS.md] |
| V5 Input Validation | yes | Use Zod for IPC payloads, source registry records, cache files, and normalized adapter output. [VERIFIED: codebase] |
| V6 Cryptography | limited | Use Node `crypto` hashing for deterministic IDs/cache keys; do not hand-roll security cryptography. [VERIFIED: codebase] |
| V10 Malicious Code | yes | Keep renderer without Node/fs/shell access and avoid unvetted package installs. [CITED: https://www.electronjs.org/docs/latest/tutorial/security] |
| V12 Files and Resources | yes | Typed path entries, safe filesystem helpers, and no renderer filesystem APIs are central Phase 3 controls. [CITED: .planning/REQUIREMENTS.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer path probing or arbitrary file read | Information Disclosure | Renderer sends typed source requests only; main validates and reads through safe helpers. [CITED: AGENTS.md] |
| Path traversal or symlink escape from source root | Tampering / Information Disclosure | Canonicalize paths with realpath and verify resolved path remains within configured root. [CITED: https://nodejs.org/api/fs.html] |
| Broad IPC exposing file/shell APIs | Elevation of Privilege | One preload method per operation; no generic `ipcRenderer` exposure. [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation] |
| Adapter emitting conclusions | Spoofing / Tampering | Adapter contract stays evidence-only and shared core derives conclusions later. [CITED: AGENTS.md] |
| Cache poisoning by malformed adapter output | Tampering | Normalize through shared validator before cache/store writes. [CITED: .planning/REQUIREMENTS.md] |

## Resolved Planner Decisions

1. **Shadcn component path:** Resolved. Phase 3 implementation should use the existing CSS fallback unless `npm exec shadcn -- info` succeeds and official shadcn components can be generated without new unverified dependency installs. Any new dependency such as `radix-ui` requires a blocking human verification checkpoint because `slopcheck` is unavailable. Do not rerun `shadcn init`, add third-party registries, or install packages without the checkpoint. [VERIFIED: codebase]
2. **Watcher depth:** Resolved. Phase 3 implements only the minimal shared watch-plan/support-truth contract and shared orchestrator boundary needed for DATA-07. It must not add live watcher controls, broad auto-start behavior, renderer start/stop controls, or adapter-owned watcher lifecycle. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
3. **Cache location naming:** Resolved. Phase 3 uses injected app-data paths with deterministic filenames: `sources.json` for source registry persistence, `raw-artifact-index.json` for artifact index metadata, and `normalized-cache.json` for normalized cache data. Electron runtime can supply `app.getPath("userData")` later; tests must use injected temporary directories. [CITED: https://www.electronjs.org/docs/latest/api/app]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `radix-ui` package downloads were not fetched and slopcheck was unavailable, so any new install must be human-verified. [ASSUMED] | Package Legitimacy Audit | Planner might install a package without the intended legitimacy checkpoint. |

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` - project scope, stack, architecture boundaries, security posture, workflow rules. [CITED: AGENTS.md]
- `.planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md` - locked Phase 3 decisions, discretion, deferred scope. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md]
- `.planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md` - approved UI contract and state vocabulary. [CITED: .planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-UI-SPEC.md]
- `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` - Phase 3 goal, slices, requirements DATA-01 through DATA-08 and UI-06. [CITED: .planning/ROADMAP.md]
- `.spec/spec-from-5.5-revision-1.md` and `.spec/additional-instructions.md` - source/scanner/cache/watch architecture and guardrails. [CITED: .spec/spec-from-5.5-revision-1.md]
- Current source files under `src/main/**`, `src/preload/**`, `src/renderer/**`, and tests under `tests/**`. [VERIFIED: codebase]
- Electron security, context isolation, IPC, releases, and app path docs. [CITED: https://www.electronjs.org/docs/latest/tutorial/security]
- shadcn Vite/component docs and local `npm exec shadcn` output. [CITED: https://ui.shadcn.com/docs/installation/vite]

### Secondary (MEDIUM confidence)

- npm registry metadata for package versions, modified timestamps, repository URLs, and postinstall script checks. [VERIFIED: npm registry]
- Node.js `fs` and `path` docs for filesystem/path primitives. [CITED: https://nodejs.org/api/fs.html]
- Vitest and Playwright docs for current testing capabilities and Electron smoke-test caveat. [CITED: https://vitest.dev/guide/]

### Tertiary (LOW confidence)

- `radix-ui` install legitimacy without slopcheck; package exists and source repo metadata was verified, but slopcheck was unavailable. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for existing dependencies and versions because package.json and npm metadata were checked; MEDIUM for any new shadcn/Radix install because slopcheck was unavailable. [VERIFIED: codebase]
- Architecture: HIGH because AGENTS, ROADMAP, REQUIREMENTS, CONTEXT, SPEC, and current code all agree on ownership boundaries. [CITED: AGENTS.md]
- Pitfalls: HIGH because pitfalls are explicitly documented and current code reveals the relevant integration gaps. [VERIFIED: codebase]

**Research date:** 2026-05-23 [VERIFIED: codebase]  
**Valid until:** 2026-06-22 for stable architecture guidance; re-check npm/shadcn/Electron metadata before package or component installation. [ASSUMED]
