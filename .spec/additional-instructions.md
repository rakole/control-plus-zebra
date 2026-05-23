# Supplemental Implementation Notes

## Architecture Guardrails

- Implement a fake/stub second adapter in the first milestone to prove Gemini is not hardcoded.
- Treat Gemini CLI as the first adapter, not the product architecture.
- Shared core must not import adapter internals.
- Renderer/UI must not import adapter internals.
- No shared type should be named `Gemini*`.
- Every normalized entity should carry `adapterId` and, where relevant, `sourceId`.
- Shell parsing, verification classification, run audit, git, GitHub, cache/indexing, export/import, and UI pages are shared-core concerns.
- Adapters emit evidence, not conclusions. For example, adapters emit `ShellCommandEvidence`; shared core decides whether verification passed or failed.
- Unsupported capability must render as “unsupported/unknown,” never as zero or passed.
- Phase 0 should produce contracts and fixtures before UI implementation starts.

## V1 Scope Control

- V1 is read-only.
- No session launching.
- No approve/reject.
- No terminal control.
- No PR creation.
- No branch/worktree cleanup.
- No arbitrary shell execution.
- Run only fixed read-only `git` / optional `gh` commands from shared providers.

## First Milestone Must Prove

- Gemini adapter can parse uploaded fixtures.
- Fake adapter can parse at least one tiny fixture.
- Both adapters render through the same Projects, Sessions, Session Detail, and Run Audit data flow.
- No UI branch like `if adapterId === "gemini-cli"` except display labels/capability metadata.
- Contract tests fail if core or renderer imports adapter-private files.

## Parser Truth Rules

- `tool.status = "success"` does not mean shell command succeeded.
- Shell exit code parsing is authoritative when present.
- A session with no verification is not clean.
- “Finished” is not the same as “safe.”
- Parser uncertainty must become diagnostics, not hidden assumptions.