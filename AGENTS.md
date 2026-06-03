# Codex instructions

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

### Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.

## Simplicity First

Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

## Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
   Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Agent Workbench Agent Guide

<!-- GSD:project-start source:PROJECT.md -->

## Project

Agent Workbench is a local-first macOS desktop app for observing, replaying, and auditing local coding-agent sessions
across multiple CLI harnesses.

Core value: truthfully classify local coding-agent runs from normalized evidence, not harness-specific assumptions,
especially when an agent claims success but verification, cancellation, dirty git state, or parser diagnostics say
otherwise.

Current V1 scope:

- Gemini CLI is the first real adapter, not the architecture.
- A fake/stub second adapter must prove the core and UI are not Gemini-hardcoded.
- V1 is read-only: no session launching, approve/reject, terminal control, PR creation, branch/worktree cleanup, or
  arbitrary shell execution.
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

- Keep shared naming harness-neutral: use `Harness`, `Session`, `SessionEvent`, `RawHarnessEvent`, `ToolCall`,
  `OutputArtifact`, and `ShellCommandEvidence`; do not introduce shared `Gemini*` types.
- Every normalized entity from harness data carries `adapterId` and, where relevant, `sourceId`.
- Adapters emit evidence and diagnostics, not final verification states, run audit classifications, or attention
  reasons.
- Missing or unsupported capabilities are explicit states, not zero values.
- Prefer small, contract-backed slices. Tests should prove boundaries before UI depth expands.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:.planning/research/ARCHITECTURE.md -->

## Architecture

Ownership boundaries:

- `src/main/core/**` owns normalized models, adapter contract, registry, source registry, ingestion, watcher
  orchestration, cache, shell parsing, verification, run audit, git/GitHub providers, export/import, IPC view models,
  diagnostics, and security.
- `src/main/adapters/<id>/**` owns harness-specific root discovery, raw artifact discovery, raw parsing,
  raw-to-normalized mapping, sidecar handling, dedupe, fixtures, and adapter contract tests.
- `src/renderer/**` consumes IPC view models only and must not import adapter-private files.
- Composition root/adapter registry may import adapter entrypoints; shared core and renderer may not import adapter
  internals.

Security posture:

- Renderer has no Node integration, no broad Electron APIs, no arbitrary file reads, and no shell execution.
- Preload exposes a narrow typed bridge with one method per allowed IPC operation.
- Only fixed read-only git and optional gh commands are allowed in V1.

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project-local skills found yet. Add skills to `.codex/skills/`, `.agents/skills/`, `.cursor/skills/`, or
`.github/skills/` with a `SKILL.md` index file when reusable project knowledge emerges.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and
execution context stay in sync.

Use these entry points:

- `$gsd-plan-phase 1` to plan the first implementation phase.
- `$gsd-discuss-phase 1` to clarify approach before planning.
- `$gsd-execute-phase` for planned phase work.
- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks.
- `$gsd-debug` for investigation and bug fixing.

Runtime note for Codex:

- GSD was originally written around Claude Code `Task(...)` / `Agent(...)` subagent calls. In Codex, invoke subagents
  with the `spawn_agent` tool name instead, and translate Claude-style subagent steps to `spawn_agent(...)` calls
  explicitly when following GSD workflows.
- close each subagent as soon as its work is completed

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` - do not edit manually.
<!-- GSD:profile-end -->
