# Agent Workbench Agent Guide

<!-- GSD:project-start source:PROJECT.md -->
## Project

Agent Workbench is a local-first macOS desktop app for observing, replaying, and auditing local coding-agent sessions across multiple CLI harnesses.

Core value: truthfully classify local coding-agent runs from normalized evidence, not harness-specific assumptions, especially when an agent claims success but verification, cancellation, dirty git state, or parser diagnostics say otherwise.

Current V1 scope:
- Gemini CLI is the first real adapter, not the architecture.
- A fake/stub second adapter must prove the core and UI are not Gemini-hardcoded.
- V1 is read-only: no session launching, approve/reject, terminal control, PR creation, branch/worktree cleanup, or arbitrary shell execution.
- Unsupported evidence must render as unsupported/unknown, never as zero, passed, or clean.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:.planning/research/STACK.md -->
## Technology Stack

Recommended stack from research:
- Electron 42.2.0 for the desktop shell.
- Electron Forge 7.11.2 with Vite 8.0.14 and TypeScript 6.0.3 for scaffolding/build.
- React 19.2.6 for renderer UI.
- Zod 4.4.3 for runtime validation of adapter output, IPC payloads, config, and fixtures.
- Vitest 4.1.7 for unit, contract, parser, boundary, and audit tests.
- Playwright 1.60.0 for Electron smoke tests, with experimental Electron support caveat.
- File-backed cache first; revisit SQLite only if realistic fixture volume proves it necessary.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- Keep shared naming harness-neutral: use `Harness`, `Session`, `SessionEvent`, `RawHarnessEvent`, `ToolCall`, `OutputArtifact`, and `ShellCommandEvidence`; do not introduce shared `Gemini*` types.
- Every normalized entity from harness data carries `adapterId` and, where relevant, `sourceId`.
- Adapters emit evidence and diagnostics, not final verification states, run audit classifications, or attention reasons.
- Missing or unsupported capabilities are explicit states, not zero values.
- Prefer small, contract-backed slices. Tests should prove boundaries before UI depth expands.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:.planning/research/ARCHITECTURE.md -->
## Architecture

Ownership boundaries:
- `src/main/core/**` owns normalized models, adapter contract, registry, source registry, ingestion, watcher orchestration, cache, shell parsing, verification, run audit, git/GitHub providers, export/import, IPC view models, diagnostics, and security.
- `src/main/adapters/<id>/**` owns harness-specific root discovery, raw artifact discovery, raw parsing, raw-to-normalized mapping, sidecar handling, dedupe, fixtures, and adapter contract tests.
- `src/renderer/**` consumes IPC view models only and must not import adapter-private files.
- Composition root/adapter registry may import adapter entrypoints; shared core and renderer may not import adapter internals.

Security posture:
- Renderer has no Node integration, no broad Electron APIs, no arbitrary file reads, and no shell execution.
- Preload exposes a narrow typed bridge with one method per allowed IPC operation.
- Only fixed read-only git and optional gh commands are allowed in V1.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project-local skills found yet. Add skills to `.codex/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file when reusable project knowledge emerges.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `$gsd-plan-phase 1` to plan the first implementation phase.
- `$gsd-discuss-phase 1` to clarify approach before planning.
- `$gsd-execute-phase` for planned phase work.
- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks.
- `$gsd-debug` for investigation and bug fixing.

Runtime note for Codex:
- GSD was originally written around Claude Code `Task(...)` / `Agent(...)` subagent calls. In Codex, invoke subagents with the `spawn_agent` tool name instead, and translate Claude-style subagent steps to `spawn_agent(...)` calls explicitly when following GSD workflows.
- close each subagent as soon as its work is completed

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` - do not edit manually.
<!-- GSD:profile-end -->
