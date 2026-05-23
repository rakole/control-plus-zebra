# Requirements: Agent Workbench

**Defined:** 2026-05-23
**Core Value:** Agent Workbench must truthfully classify local coding-agent runs from normalized evidence, not harness-specific assumptions, especially when an agent claims success but verification, cancellation, dirty git state, or parser diagnostics say otherwise.

## User Stories

- As a developer, I want to inspect local coding-agent sessions across harnesses so I can understand what happened without reading raw log files.
- As a developer, I want run audit to compare agent claims against verification evidence so I can decide whether a run is safe to trust.
- As a developer, I want unsupported or missing evidence to be shown explicitly so I do not mistake parser limitations for clean results.
- As a future adapter author, I want one clear adapter contract so adding another harness does not require rewriting Gemini, shared audit logic, or UI pages.

## Acceptance Criteria

- V1 is read-only and does not launch sessions, approve/reject work, control terminals, create PRs, clean branches/worktrees, or run arbitrary shell commands.
- Gemini CLI and a fake/stub adapter both flow through the same normalized core, Projects, Sessions, Session Detail, and Run Audit paths.
- Shared core and renderer do not import adapter-private files.
- Shell exit-code evidence overrides raw tool status when determining command and verification outcomes.
- Missing or unsupported capabilities render as unsupported/unknown, never as zero, passed, or clean.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Architecture and Contracts

- [ ] **ARCH-01**: Developer can add a future harness by creating a new adapter folder, implementing the shared adapter contract, adding fixtures and contract tests, and registering the adapter descriptor.
- [ ] **ARCH-02**: Shared core exposes harness-neutral identity types for harnesses, sources, projects, sessions, native IDs, and confidence values.
- [ ] **ARCH-03**: Every normalized entity that originated from harness data carries `adapterId` and, where relevant, `sourceId`.
- [ ] **ARCH-04**: Shared core uses `SessionEvent`, `RawHarnessEvent`, `SessionMessage`, `ToolCall`, `OutputArtifact`, `ShellCommandEvidence`, and other harness-neutral names instead of shared `Gemini*` types.
- [ ] **ARCH-05**: Adapter capabilities are represented in a mandatory schema covering discovery, replay, tools, usage, live status, audit, and export support.
- [ ] **ARCH-06**: Capability data can be represented at adapter, source, and session-observed levels.
- [ ] **ARCH-07**: Import-boundary enforcement prevents `core/**` and `renderer/**` from importing adapter-private files.

### Adapter System

- [ ] **ADPT-01**: The adapter registry can list registered harness descriptors with IDs, display names, versions, supported platforms, default root hints, and capabilities.
- [ ] **ADPT-02**: A fake/stub adapter can parse at least one fixture and produce normalized projects, sessions, events, messages, tool calls, shell evidence, diagnostics, and capabilities.
- [ ] **ADPT-03**: The `gemini-cli` adapter can discover and validate a Gemini CLI source root such as `~/.gemini/tmp`.
- [ ] **ADPT-04**: The `gemini-cli` adapter can discover `.project_root`, `logs.json`, `chats/session-*.jsonl`, and `tool-outputs/session-<uuid>/*` artifacts.
- [ ] **ADPT-05**: The `gemini-cli` adapter maps Gemini project folders, project-root files, chat metadata, user messages, assistant messages, lifecycle records, metadata patches, tool calls, file mutations, shell command evidence, and sidecars into shared normalized fragments.
- [ ] **ADPT-06**: The `gemini-cli` adapter handles duplicate/intermediate records, partial or corrupt raw data, cancellation events, missing sidecars, JSON sidecars, plain-text sidecars, and actively changing artifacts by emitting diagnostics instead of crashing.
- [ ] **ADPT-07**: Adapter code cannot produce final verification states, run audit classifications, or attention reasons.

### Source, Ingestion, and Cache

- [ ] **DATA-01**: User can configure, enable, disable, and validate harness source roots through shared source registry behavior.
- [ ] **DATA-02**: Adapters receive only safe filesystem helpers scoped to configured source roots and indexed output artifacts.
- [ ] **DATA-03**: Shared scanner asks enabled adapters to validate roots, discover sources, discover artifacts, parse changed artifacts, and normalize raw events.
- [ ] **DATA-04**: Raw artifact indexing tracks adapter ID, source ID, artifact identity, path or native ref, size, mtime, inode when available, parser version, adapter version, schema version, and diagnostics hash.
- [ ] **DATA-05**: Global session IDs and cache keys include adapter identity and source identity to prevent cross-harness collisions.
- [ ] **DATA-06**: Shared normalization validation rejects or diagnoses malformed adapter output before it is merged into the normalized store.
- [ ] **DATA-07**: Shared watcher orchestration consumes adapter watch plans instead of allowing adapters to own watcher lifecycle.
- [ ] **DATA-08**: File-backed normalized cache supports V1 without requiring native database packaging.

### Shell, Verification, and Run Audit

- [ ] **AUDT-01**: Shared shell parser converts `ShellCommandEvidence` into normalized shell commands with command text, cwd, output source, exit code, intent, failure state, parsed failures, confidence, and diagnostics.
- [ ] **AUDT-02**: Shell exit-code parsing is authoritative when present, even if the raw tool call status is `success`.
- [ ] **AUDT-03**: Shared shell intent classifier identifies test, build, typecheck, lint, install, git, other, and unknown commands.
- [ ] **AUDT-04**: Shared verification classifier marks nonzero test, build, typecheck, or lint commands as failed verification.
- [ ] **AUDT-05**: Shared verification classifier marks sessions with no verification command evidence as `not-run`, not passed.
- [ ] **AUDT-06**: Shared verification classifier marks sessions without required shell capability as unknown or unsupported, not passed.
- [ ] **AUDT-07**: Run Audit classifies sessions as active, cancelled, verification-failed, incomplete, needs-review, clean, or unknown using shared precedence rules.
- [ ] **AUDT-08**: Run Audit reports attention reasons for failed verification, cancellation, no final answer, pending tool calls, dirty repo after claim, missing sidecars, parser warnings, no verification, capability gaps, and unknown evidence.
- [ ] **AUDT-09**: Run Audit can compare final-answer/claimed-complete evidence with file mutations, command evidence, verification results, cancellation state, pending tool calls, and git dirty state.

### Electron App Shell and Security

- [ ] **DESK-01**: App is scaffolded as a macOS Electron desktop app using Vite, React, and TypeScript.
- [ ] **DESK-02**: Renderer has Node.js integration disabled, context isolation enabled, sandboxing enabled, and a restrictive Content Security Policy.
- [ ] **DESK-03**: Preload exposes a narrow typed bridge with one method per allowed IPC operation and never exposes `ipcRenderer` directly.
- [ ] **DESK-04**: IPC handlers validate payloads and return sanitized view models rather than raw filesystem records or adapter-private objects.
- [ ] **DESK-05**: Renderer cannot read arbitrary local files, run shell commands, or import main-process adapter internals.
- [ ] **DESK-06**: The app loads local packaged content and does not execute remote code in V1.

### Harness-Neutral UI

- [ ] **UI-01**: User can view an Overview page with total projects, total sessions, active/recent sessions, failed verification, cancelled sessions, needs-attention sessions, tool activity, activity over time, and harness filters.
- [ ] **UI-02**: User can view a Projects page with project name, repo path, observed harnesses, latest activity, branch, HEAD SHA, dirty state, changed/untracked files, session count, and latest verification state when supported.
- [ ] **UI-03**: User can view a Sessions page with status, harness, project, branch, session ID, native session ID, first prompt, assistant/model, timestamps, token count if supported, tool count, file mutation count, command count, failed command count, and capability warnings.
- [ ] **UI-04**: User can view a Session Detail page with harness badge, project, session IDs, lifecycle status, attention reasons, capability warnings, and a timeline of messages, lifecycle events, tool calls, file events, shell commands, output artifacts, and unknown raw events.
- [ ] **UI-05**: User can view Run Audit evidence grouped by claim vs evidence, verification, files changed, commands, cancellation/incompletion, git/GitHub state, capability gaps, and parser diagnostics.
- [ ] **UI-06**: User can manage harnesses and data sources from a Harnesses and Data Sources settings page.
- [ ] **UI-07**: User can view parser, source, adapter, cache, and capability diagnostics from a Diagnostics page.
- [ ] **UI-08**: UI behavior is driven by adapter metadata and capabilities, with no provider-specific branches except display labels and capability metadata.
- [ ] **UI-09**: Unsupported capability states render as unsupported or unknown instead of zero values.

### Git, GitHub, Export, and Import

- [ ] **GIT-01**: Shared git provider can collect branch, HEAD SHA, dirty/clean state, changed files, untracked files, additions/deletions, and remote URL using fixed read-only commands.
- [ ] **GIT-02**: Git provider runs only when project-root confidence is adequate and disables or marks git context unknown when no safe root exists.
- [ ] **GIT-03**: Optional GitHub provider can detect `gh` availability and collect PR/check/review context through fixed read-only commands without creating or modifying PRs.
- [ ] **GIT-04**: Export flow can create a harness-neutral archive containing adapter/source/session metadata, normalized data, diagnostics, and optional raw artifacts.
- [ ] **GIT-05**: Import flow can load an archive as a read-only source and render imported sessions without the original local source roots.
- [ ] **GIT-06**: Raw artifact export warns that transcripts, sidecars, repo paths, and command output may contain sensitive data.

### Testing and Quality Gates

- [ ] **TEST-01**: Adapter contract tests verify descriptor, capabilities, source discovery, raw artifact discovery, normalization, diagnostics, and unsupported capability behavior for every adapter.
- [ ] **TEST-02**: Golden normalization tests compare raw fixture input to normalized JSON output for fake and Gemini adapters.
- [ ] **TEST-03**: Import-boundary tests fail if shared core imports `adapters/**`, renderer imports `adapters/**`, Gemini imports fake/future adapters, or fake/future adapters import Gemini.
- [ ] **TEST-04**: Shell parser tests prove nonzero exit-code evidence fails commands even when raw tool status is `success`.
- [ ] **TEST-05**: Verification tests prove no-verification sessions are `not-run` and missing shell capability is unknown/unsupported.
- [ ] **TEST-06**: Run audit tests cover clean, incomplete, cancelled, verification-failed, needs-review, active, and unknown classifications.
- [ ] **TEST-07**: UI tests prove capability gates render unsupported/unknown states and do not show missing evidence as zero.
- [ ] **TEST-08**: Electron smoke tests verify the app shell loads, preload bridge works, and renderer cannot access forbidden APIs.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Automation and Control

- **CTRL-01**: User can launch or resume agent sessions from Agent Workbench.
- **CTRL-02**: User can approve or reject agent work from Agent Workbench.
- **CTRL-03**: User can run controlled verification commands from Agent Workbench.
- **CTRL-04**: User can create PRs or clean branches/worktrees from Agent Workbench.

### Extensibility

- **EXT-01**: Third-party adapter plugins can be installed outside bundled adapters.
- **EXT-02**: Organization policy can provide default source-root hints.
- **EXT-03**: A real second non-Gemini harness adapter ships after the fake/stub proof.

### Scale and Intelligence

- **SCALE-01**: SQLite-backed cache or search index supports large session archives.
- **SCALE-02**: Lifecycle hooks, process detection, lockfiles, or native harness APIs improve active-session detection.
- **SCALE-03**: Cost estimates are shown when model/provider pricing sources are stable.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Session launching | V1 is read-only observability; launching expands safety and harness-control scope. |
| Approve/reject workflow | Requires mutation semantics across harnesses and is not needed to validate audit value. |
| Terminal control or arbitrary shell execution | Creates command-injection and data-loss risk; V1 only permits fixed read-only git/gh provider commands. |
| PR creation | GitHub integration is optional read-only context in V1. |
| Branch/worktree cleanup | Mutates user repositories and is explicitly outside V1. |
| Provider-specific shared types or UI behavior | Violates harness-neutral architecture and future adapter goals. |
| Native database dependency as a Phase 0 requirement | File-backed cache is enough to prove architecture before taking on native packaging risk. |
| Treating missing evidence as safe | Missing shell, verification, sidecar, or lifecycle evidence must produce unsupported/unknown states. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | TBD | Pending |
| ARCH-02 | TBD | Pending |
| ARCH-03 | TBD | Pending |
| ARCH-04 | TBD | Pending |
| ARCH-05 | TBD | Pending |
| ARCH-06 | TBD | Pending |
| ARCH-07 | TBD | Pending |
| ADPT-01 | TBD | Pending |
| ADPT-02 | TBD | Pending |
| ADPT-03 | TBD | Pending |
| ADPT-04 | TBD | Pending |
| ADPT-05 | TBD | Pending |
| ADPT-06 | TBD | Pending |
| ADPT-07 | TBD | Pending |
| DATA-01 | TBD | Pending |
| DATA-02 | TBD | Pending |
| DATA-03 | TBD | Pending |
| DATA-04 | TBD | Pending |
| DATA-05 | TBD | Pending |
| DATA-06 | TBD | Pending |
| DATA-07 | TBD | Pending |
| DATA-08 | TBD | Pending |
| AUDT-01 | TBD | Pending |
| AUDT-02 | TBD | Pending |
| AUDT-03 | TBD | Pending |
| AUDT-04 | TBD | Pending |
| AUDT-05 | TBD | Pending |
| AUDT-06 | TBD | Pending |
| AUDT-07 | TBD | Pending |
| AUDT-08 | TBD | Pending |
| AUDT-09 | TBD | Pending |
| DESK-01 | TBD | Pending |
| DESK-02 | TBD | Pending |
| DESK-03 | TBD | Pending |
| DESK-04 | TBD | Pending |
| DESK-05 | TBD | Pending |
| DESK-06 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |
| UI-06 | TBD | Pending |
| UI-07 | TBD | Pending |
| UI-08 | TBD | Pending |
| UI-09 | TBD | Pending |
| GIT-01 | TBD | Pending |
| GIT-02 | TBD | Pending |
| GIT-03 | TBD | Pending |
| GIT-04 | TBD | Pending |
| GIT-05 | TBD | Pending |
| GIT-06 | TBD | Pending |
| TEST-01 | TBD | Pending |
| TEST-02 | TBD | Pending |
| TEST-03 | TBD | Pending |
| TEST-04 | TBD | Pending |
| TEST-05 | TBD | Pending |
| TEST-06 | TBD | Pending |
| TEST-07 | TBD | Pending |
| TEST-08 | TBD | Pending |

**Coverage:**
- v1 requirements: 60 total
- Mapped to phases: 0
- Unmapped: 60 pending roadmap mapping

---
*Requirements defined: 2026-05-23*
*Last updated: 2026-05-23 after initial definition*
