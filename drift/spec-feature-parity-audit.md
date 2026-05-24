# Spec Feature Parity Audit

Drift Recovery Wave 6 audit against `.spec/spec-from-5.5-revision-1.md` sections 1-26.

## Met

- Sections 1-4: Product terminology, ownership boundaries, and harness-neutral architecture are implemented through shared core, adapter-private folders, main-owned services, typed preload, and renderer-only DTO consumption.
- Sections 5-6: The public adapter contract and grouped capability model exist, including required watch planning, safe adapter context helpers, and explicit supported/unsupported/unknown UI states.
- Sections 7, 10-14: Normalized projects, sessions, events, messages, tool calls, shell evidence, artifacts, verification, and run audit are shared-core objects. Adapters emit evidence and diagnostics; shared shell/verification/audit logic owns conclusions.
- Sections 15-16, 20-21: Overview, Projects, Sessions, Session Detail, Run Audit, Diagnostics, data-source flows, public IPC/preload, and V1 read-only restrictions are covered by main, preload, renderer, security, and boundary tests. Retired `overview:get`, `sessions:getById`, `sessions:getDetail`, and `dataSources:*` compatibility channels have been removed from the public IPC/preload surface and locked out by boundary tests.
- Section 22: Wave 6 replaces count-heavy adapter checks with scenario manifests and widened goldens. Gemini now has alpha/beta/gamma/delta scenario goldens; fake-test has scenario coverage for shell failure, pending evidence, and corrupt raw data.
- Section 23: The fake-test adapter proves the second-adapter path without Gemini-specific UI branches.

## Partially Met

- Sections 7 and 18: Legacy cache/archive migration still tolerates historical alias inputs so old cache records can load, but normalized fixture and validator tests reject legacy alias output.
- Section 17: Incremental parsing remains explicitly unsupported for bundled adapters; changed-artifact indexing exists, but Gemini append-safe parsing is not claimed.
- Section 19: Git and GitHub are shared read-only providers with visible unavailable/unknown states, but richer PR/review behavior remains limited to optional `gh` evidence.
- Section 22: Fake-test intentionally remains a stub harness. It proves unsupported and corrupt cases, but it is not a real third harness.

## Deferred V2

- Active session detection beyond current mtime/watch seams: process hooks, native APIs, lockfiles, or PID-to-session mapping.
- Cost estimates and provider-specific pricing.
- A real third-party adapter beyond `fake-test` and `gemini-cli`.
- Rich incremental parsing and live replay semantics for Gemini.

## Out Of Scope

- Session launching, approve/reject, terminal control, arbitrary shell execution, PR creation, or branch/worktree cleanup inside Agent Workbench.
- Broad shadcn-native redesign or theme architecture cleanup.
- Turning archive import into a normal bundled harness adapter; Wave 5 keeps archive sources import-only while preserving original harness identity.
