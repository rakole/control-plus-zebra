# Architecture Research

**Domain:** Harness-neutral local desktop observability and audit platform
**Researched:** 2026-05-23
**Confidence:** HIGH for architecture boundaries, MEDIUM for storage/indexing details until real fixture volume is measured

## Standard Architecture

### System Overview

```text
Electron Main Process
  Adapter Registry
    - gemini-cli adapter
    - fake-test adapter
    - future adapters
  Source Registry
  Scanner / Indexer
  Watcher Orchestrator
  Normalized Store / Cache
  Shell Parser
  Verification Engine
  Run Audit Engine
  Git Provider
  GitHub Provider
  Export / Import
  IPC Handlers and View Models
  Security: allowlists, redaction, fixed command runner

Preload
  Narrow typed bridge
  One method per allowed IPC operation
  No raw filesystem, shell, or adapter internals exposed

React Renderer
  Overview
  Projects
  Sessions
  Session Detail
  Run Audit
  Harnesses and Data Sources
  Diagnostics

Local Sources
  Gemini CLI root
  Imported archives
  Future harness roots
  Project repos for read-only git/gh context
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Adapter contract | Defines descriptor, capabilities, discovery, parsing, normalization, watch plan, optional artifact loading | TypeScript interfaces plus Zod schemas and contract tests |
| Adapter registry | Registers bundled adapters and exposes descriptors/capabilities | Composition root imports adapter entrypoints only |
| Source registry | Stores configured source roots and validation state | JSON config/store, validated paths, adapter IDs |
| Scanner/indexer | Discovers artifacts and routes changed artifacts to owning adapter | Shared orchestration with adapter discovery functions |
| Normalization validator | Validates adapter output before merge | Zod schemas and diagnostics |
| Session merger | Builds stable Projects/Sessions/Events/ToolCalls/etc. | Deterministic IDs based on adapter/source/native identity |
| Shell parser | Parses command text, cwd, output, exit code, intent, failure summaries | Shared parser over `ShellCommandEvidence` |
| Verification engine | Classifies build/test/typecheck/lint evidence | Shared rule engine, never adapter-owned |
| Run audit engine | Classifies session trust state | Precedence rules: active, cancelled, verification failed, incomplete, needs review, clean, unknown |
| IPC view models | Renderer-facing data shape | Capability-gated DTOs, no adapter-private raw types |
| Renderer pages | Display dashboards/detail views | React pages using view models only |

## Recommended Project Structure

```text
src/
  main/
    core/
      adapter-contract/
      model/
      diagnostics/
      registry/
      ingestion/
      watcher/
      shell/
      verification/
      audit/
      git/
      github/
      cache/
      export/
      ipc/
      security/
    adapters/
      gemini-cli/
        parser/
        mapper/
        fixtures/
        tests/
      fake-test/
        fixtures/
        tests/
    main.ts
  preload/
    api.ts
    global.d.ts
  renderer/
    app/
    pages/
    components/
    view-models/
tests/
  contract/
  boundaries/
  fixtures/
```

### Structure Rationale

- **`src/main/core/`:** The product's trusted shared logic. It must not import adapter internals.
- **`src/main/adapters/<id>/`:** Harness-specific code, fixtures, and contract tests. Adapters may import shared contracts/models/diagnostics only.
- **`src/preload/`:** Typed bridge with narrow methods. It is the seam between powerful main-process capabilities and untrusted-ish renderer code.
- **`src/renderer/`:** UI over IPC view models. No adapter-private imports and no raw filesystem access.
- **`tests/boundaries/`:** Architecture guardrails need tests because import drift is otherwise too easy.

## Architectural Patterns

### Pattern 1: Ports and Adapters

**What:** Shared core defines a `SessionSourceAdapter` port. Each harness adapter implements it.
**When to use:** Every harness-specific behavior: default roots, validation, raw artifact discovery, raw parsing, raw-to-normalized mapping.
**Trade-offs:** More upfront structure, much less future copy-paste.

```typescript
export interface SessionSourceAdapter {
  descriptor: HarnessDescriptor;
  getDefaultSourceRoots(ctx: AdapterContext): Promise<SourceRootHint[]>;
  validateSourceRoot(root: SourceRootConfig, ctx: AdapterContext): Promise<SourceRootValidation>;
  discoverSources(root: SourceRootConfig, ctx: AdapterContext): AsyncIterable<DiscoveredHarnessSource>;
  discoverArtifacts(source: DiscoveredHarnessSource, ctx: AdapterContext): AsyncIterable<RawArtifactRef>;
  parseArtifact(artifact: RawArtifactRef, ctx: AdapterContext): AsyncIterable<RawHarnessEvent>;
  normalize(input: AdapterNormalizationInput, ctx: AdapterContext): Promise<AdapterNormalizationResult>;
}
```

### Pattern 2: Evidence Before Conclusions

**What:** Adapters emit evidence; shared engines produce conclusions.
**When to use:** Tool calls, shell command evidence, file mutations, lifecycle events, output artifacts.
**Trade-offs:** Shared classification must support capability gaps, but audit semantics stay consistent.

```typescript
// Adapter output
type AdapterOutput = ShellCommandEvidence | ToolCall | FileMutation | SessionEvent;

// Shared core output
type SharedConclusion = ShellCommand | VerificationResult | RunAudit;
```

### Pattern 3: Capability-Gated View Models

**What:** Renderer receives capability metadata and renders unavailable evidence as unsupported/unknown.
**When to use:** Token counts, shell output, file mutations, sidecars, active status, project-root mapping.
**Trade-offs:** UI has more states, but avoids false trust.

### Pattern 4: Safe IPC Facade

**What:** Preload exposes one typed function per allowed IPC operation.
**When to use:** Every renderer-to-main call.
**Trade-offs:** More boilerplate than exposing `ipcRenderer`, but much safer and aligned with Electron guidance.

### Pattern 5: Cache Keys Include Adapter Identity

**What:** Every cache key includes adapter ID, source ID, raw artifact ID/path/native ref, size, mtime, adapter version, and schema version.
**When to use:** Raw artifact index, normalized store, sessions, diagnostics.
**Trade-offs:** Larger keys, but prevents cross-harness collisions.

## Data Flow

### Scan and Audit Flow

```text
User configures source root
  -> Source registry validates via adapter
  -> Scanner asks adapter for sources and artifacts
  -> Raw artifact index detects changed artifacts
  -> Adapter parses raw artifacts into RawHarnessEvent
  -> Adapter normalizes raw events into shared fragments
  -> Shared validator accepts or diagnoses fragments
  -> Merger builds Projects, Sessions, Events, Messages, ToolCalls, FileMutations, ShellCommandEvidence, OutputArtifacts
  -> Shared shell parser creates ShellCommand
  -> Verification engine creates VerificationResult
  -> Run audit engine creates RunAudit
  -> Git/GitHub providers attach read-only context if root confidence allows
  -> IPC view models update renderer
```

### Renderer Request Flow

```text
Renderer page
  -> typed preload API
  -> IPC handler
  -> main-process query service
  -> normalized store/cache
  -> capability-gated view model
  -> renderer component
```

### Key Data Flows

1. **Source onboarding:** User adds or enables a harness source root; adapter validates; shared source registry stores validation and capabilities.
2. **Session ingestion:** Adapter-specific raw artifacts become normalized shared records, then shared engines classify trust state.
3. **Timeline rendering:** Renderer receives ordered `SessionEvent` view models, not raw Gemini records.
4. **Output artifact loading:** Renderer asks for artifact preview/load; main process checks indexed artifact and allowlist before reading.
5. **Git/GitHub context:** Shared providers run fixed read-only commands only when project root confidence is adequate.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k sessions | In-memory plus file-backed normalized cache is enough; prioritize correctness and fixtures. |
| 1k-100k sessions | Add incremental parsing, stronger artifact index, paginated queries, and possibly SQLite-backed normalized store. |
| 100k+ sessions | Consider SQLite FTS or dedicated local index; background worker/utility process for parsing; stricter retention and archive controls. |

### Scaling Priorities

1. **First bottleneck:** Parsing large or actively changing JSONL and sidecar files. Fix with artifact index, incremental parsing, diagnostics, and size-limited previews.
2. **Second bottleneck:** Renderer overfetching timelines. Fix with paginated/event-window APIs and summarized dashboards.
3. **Third bottleneck:** Search/filter over many sessions. Fix with a storage abstraction that can move from JSON files to SQLite.

## Anti-Patterns

### Anti-Pattern 1: First-Adapter Core

**What people do:** Name shared types `GeminiEvent`, expose `gemini:getSessions`, and branch UI by `adapterId`.
**Why it's wrong:** Every future harness requires duplicated ingestion and UI logic.
**Do this instead:** Keep provider details in adapter descriptors, capabilities, and adapter-private parsers.

### Anti-Pattern 2: Renderer as Parser

**What people do:** Load raw files in the renderer to make timeline UI fast.
**Why it's wrong:** Breaks security, duplicates parsing, and leaks filesystem concerns.
**Do this instead:** Main process owns parsing and exposes sanitized view models.

### Anti-Pattern 3: Tool Status as Verification

**What people do:** Treat `tool.status = success` as proof the shell command passed.
**Why it's wrong:** Tool invocation success only means the tool completed; command output may contain `Exit Code: 1`.
**Do this instead:** Parse shell output and exit-code evidence in shared core.

### Anti-Pattern 4: Premature Native Storage

**What people do:** Start with SQLite/native modules before adapter contracts are stable.
**Why it's wrong:** Packaging and native rebuild work can swallow the first milestone.
**Do this instead:** Define storage interfaces and begin with file-backed cache.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Local filesystem | Safe helpers scoped to configured source roots | Adapters never get unrestricted filesystem access. |
| Gemini CLI temp root | `gemini-cli` adapter source root | Default candidate `~/.gemini/tmp`; validate before scanning. |
| git | Shared read-only provider | Fixed commands only, only under validated/inferred project roots. |
| gh | Optional shared read-only provider | Optional PR/check context; no PR creation in V1. |
| Export/import archives | Shared archive exporter/importer | Preserve `adapterId`; warn before raw transcript export. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Renderer to main | Typed IPC via preload | No raw Electron APIs exposed to renderer. |
| Core to adapters | Adapter registry invokes adapter interface | Core imports adapter entrypoints only at composition root. |
| Adapter to filesystem | `AdapterContext` safe helpers | Enforce allowed roots and diagnostics. |
| Adapter output to core | Normalized fragments plus diagnostics | Validated before merge. |
| Core to UI | View models | Capability-gated and sanitized. |

## Sources

- `.spec/spec-from-5.5-revision-1.md` - architecture boundary and data model.
- `.spec/additional-instructions.md` - first-milestone proof and V1 read-only scope.
- https://www.electronjs.org/docs/latest/tutorial/security - Electron security and current-version guidance.
- https://www.electronjs.org/docs/latest/tutorial/context-isolation - safe contextBridge patterns.
- https://www.electronjs.org/docs/latest/tutorial/ipc - IPC communication patterns.
- https://www.electronforge.io/templates/vite-+-typescript - Electron Forge + Vite + TypeScript template.
- https://playwright.dev/docs/api/class-electron - Electron smoke-test support caveat.

---
*Architecture research for: Agent Workbench*
*Researched: 2026-05-23*
