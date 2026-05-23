# Agent Workbench

## What This Is

Agent Workbench is a local-first macOS desktop app for observing, replaying, and auditing coding-agent sessions across multiple CLI harnesses. V1 supports Gemini CLI as the first real session-source adapter, but the product architecture is harness-neutral: the shared core, UI, audit engine, shell parser, git/GitHub providers, cache, export/import, and IPC contracts must not be built around Gemini's file layout.

The product helps a developer answer: what happened in this agent run, what files/tools/commands were involved, did verification actually pass, and does the run need attention before trusting the result?

## Core Value

Agent Workbench must truthfully classify local coding-agent runs from normalized evidence, not harness-specific assumptions, especially when an agent claims success but verification, cancellation, dirty git state, or parser diagnostics say otherwise.

## Requirements

### Validated

(None yet - ship to validate)

### Active

- [ ] Define a harness-neutral architecture where Gemini CLI is only the first adapter, not the product architecture.
- [ ] Provide an adapter contract that future harnesses can implement without editing Gemini adapter code, shared parsing, shared audit logic, cache/indexing, UI pages, or IPC contracts unless a new general capability is needed.
- [ ] Model all shared entities with `adapterId` and, where relevant, `sourceId`.
- [ ] Keep all Gemini-specific parsing and raw-record semantics inside `src/main/adapters/gemini-cli/`.
- [ ] Implement a fake or stub second adapter in the first milestone to prove the shared core and UI are not Gemini-hardcoded.
- [ ] Keep shell parsing, verification classification, run audit, git, GitHub, cache/indexing, export/import, and UI pages as shared-core concerns.
- [ ] Ensure adapters emit evidence, such as `ShellCommandEvidence`, and never final audit or verification conclusions.
- [ ] Render unsupported capabilities as unsupported or unknown, never as zero, passed, or clean.
- [ ] Build a read-only V1: no session launching, approval/rejection, terminal control, PR creation, branch/worktree cleanup, or arbitrary shell execution.
- [ ] Provide harness-neutral UI pages for Overview, Projects, Sessions, Session Detail, Run Audit, Harnesses/Data Sources, and Diagnostics.
- [ ] Add contract and boundary tests that fail if shared core or renderer imports adapter-private files.

### Out of Scope

- Launching or controlling agent sessions - V1 is observability and audit only.
- Approve/reject workflows - V1 should not mutate or govern live agent execution.
- Terminal control or arbitrary shell execution - only fixed read-only git and optional gh commands are allowed through shared providers.
- PR creation or branch/worktree cleanup - GitHub context is read-only in V1.
- Gemini-specific shared types, IPC names, UI branches, or core imports - provider-specific details belong behind adapter metadata and adapter-private code.
- Treating tool-call success as command success - shell exit-code evidence is authoritative when present.
- Reporting sessions with no verification as clean - absence of verification is not success.

## Context

The master spec originally corrected an earlier Gemini-hardcoded architecture. The product should be named and modeled around harness-neutral concepts such as agent sessions, harness source roots, normalized events, output artifacts, tool calls, and capability metadata. Gemini CLI remains important as the first real adapter and fixture source, but it must not leak into shared contracts.

Observed Gemini CLI data includes `.project_root`, `logs.json`, `chats/session-*.jsonl`, `tool-outputs/session-<uuid>/*.txt`, sparse `shell_history`, duplicate records, JSON/plain-text sidecars, shell exit-code parsing hazards, active-file mutation, and cancellation events. These details belong in the `gemini-cli` adapter, while the shared core consumes normalized evidence.

The architecture has three hard ownership zones:

- Shared core owns normalized models, adapter contract, registry, sources, scanning/indexing, watching, shell parsing, verification, run audit, status classification, git/GitHub providers, cache, export/import, IPC view models, security, and cross-adapter search/filter/sort.
- Harness adapters own default root discovery, root validation, artifact discovery, raw log parsing, sidecar parsing, raw-to-normalized mapping, adapter-specific dedupe, active-session evidence, fixtures, and contract tests.
- Renderer owns harness-neutral pages and capability-aware rendering through IPC view models, with no imports from adapter-private files.

The first milestone must prove neutrality before UI-heavy implementation starts: Gemini fixtures and a fake adapter fixture should both flow through the same Projects, Sessions, Session Detail, and Run Audit paths, with no UI conditionals like `if adapterId === "gemini-cli"` except metadata-driven labels or capability gates.

## Constraints

- **Platform**: Standalone macOS desktop app - the spec assumes Electron, Vite, and React.
- **Privacy**: Local-first by default - source roots, transcripts, sidecars, git data, and optional gh context stay local unless exported by the user.
- **Read-only V1**: No live session mutation, terminal control, PR creation, or arbitrary shell execution - this prevents an observability app from becoming an unsafe automation surface too early.
- **Adapter boundary**: `core/**` and `renderer/**` must not import `adapters/**`; the composition root or adapter registry may import adapter entrypoints only.
- **Naming**: No shared type should be named `Gemini*`; shared concepts should use `Harness`, `Session`, `SessionEvent`, `RawHarnessEvent`, `ToolCall`, `OutputArtifact`, and similar neutral terms.
- **Capability truth**: Capabilities are mandatory and can be adapter-level, source-level, or session-observed; unsupported data must render as unsupported or unknown.
- **Verification truth**: Nonzero shell exit codes mean failed commands; nonzero test/build/typecheck/lint commands mean failed verification; no verification is `not-run`, not passed.
- **Security**: Adapters receive safe filesystem helpers scoped to configured roots, not unrestricted filesystem or command execution access.
- **Extensibility**: Adding future harness `xyz` should require a new adapter folder, fixtures, contract tests, and registry descriptor, not changes to Gemini internals or duplicated shared engines.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Product name is Agent Workbench | Clear, harness-neutral, and broad enough for Gemini plus future coding-agent harnesses | - Pending |
| Gemini CLI is the first adapter, not the architecture | Prevents first-adapter trap and keeps future harness support feasible | - Pending |
| Phase 0 starts with contracts and fixtures before UI implementation | Proves neutral architecture before pages accidentally encode Gemini assumptions | - Pending |
| Include a fake/stub second adapter in the first milestone | Gives immediate executable proof that the registry, core, and UI are adapter-neutral | - Pending |
| Adapters emit evidence, not conclusions | Shared shell parsing, verification, and run audit must be consistent across harnesses | - Pending |
| V1 is read-only | Keeps privacy and safety boundaries tight while the audit model matures | - Pending |
| Unsupported capabilities render as unsupported/unknown | Prevents misleading dashboards that confuse missing evidence with zero problems | - Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-23 after initialization*
