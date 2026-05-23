# Feature Research

**Domain:** Local-first coding-agent session observability and audit
**Researched:** 2026-05-23
**Confidence:** HIGH for spec-derived V1 features, MEDIUM for prioritization until real Gemini fixtures are parsed

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these makes the product feel incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Harness/data source settings | Users must configure where local harness artifacts live | MEDIUM | Must support adapter descriptors, source roots, validation, enable/disable, diagnostics. |
| Projects dashboard | Users need a repo/project-level view before drilling into sessions | MEDIUM | Projects can have multiple harness refs. Root confidence must be visible. |
| Sessions dashboard | Core product object is a session/run | MEDIUM | Include status, harness, project, timestamps, tool/file/command counts, failed command count, capability warnings. |
| Session timeline | Users need replay and evidence inspection | HIGH | Must combine messages, lifecycle events, tool calls, file events, shell commands, output artifacts, and unknown raw events. |
| Tool/file/shell activity views | Audit value depends on seeing what the agent did | HIGH | Tool success is not shell success. File and shell evidence should be separate normalized concepts. |
| Verification classification | Users need to know whether tests/build/typecheck/lint actually passed | HIGH | Shared shell parser owns this. No verification means `not-run`, not passed. |
| Run Audit | Product wedge: claim vs evidence | HIGH | Classify clean/incomplete/cancelled/verification-failed/needs-review/unknown with reasons. |
| Capability-aware rendering | Different harnesses expose different evidence | MEDIUM | Unsupported must show unsupported/unknown, not zero/passed. |
| Parser diagnostics | Local artifacts are partial, corrupt, duplicated, or actively changing | MEDIUM | Diagnostics must be first-class and visible. |
| Export/import | Users need reproducible bug reports and offline review | MEDIUM | V1 can export normalized data and optional raw artifacts with privacy warnings. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not all are required in the first usable slice, but they align strongly with the core value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Harness-neutral adapter contract | Future harnesses do not require rewriting the app | HIGH | Proved by fake adapter in first milestone. |
| Claim-vs-evidence audit | Catches "agent said done" when tests failed or work was cancelled | HIGH | The central trust-building feature. |
| Contract-test harness for adapters | Prevents parser drift and first-adapter lock-in | HIGH | Golden normalization tests should run early and often. |
| Import-boundary enforcement | Architecture remains honest under pressure | MEDIUM | Core/renderer import failures should break CI. |
| Source/project root confidence | Avoids overclaiming git/GitHub context | MEDIUM | Confirmed/observed/inferred/unknown should affect UI badges. |
| Local-only privacy model | Strong user trust for sensitive transcripts and repo data | MEDIUM | No cloud dependency required for V1. |
| Capability coverage warnings | Tells users what cannot be known | MEDIUM | Example: "This harness cannot report shell output." |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Session launching | Feels like a natural next step after observing sessions | Turns observability into orchestration too early and expands safety scope | V1 read-only; revisit after audit model is trusted |
| Approve/reject actions | Users may want workflow control from the audit screen | Requires mutation semantics across harnesses | Show recommendations and evidence only |
| Arbitrary terminal execution | Convenient for quick verification | Violates V1 safety, creates command-injection risk, and duplicates harness behavior | Fixed read-only git/gh commands only |
| Provider-specific UI branches | Faster to ship Gemini detail pages | Locks UI to first adapter and hides capability gaps | Metadata-driven labels and capability gates |
| Treating missing evidence as zero | Makes dashboards simple | Misleads users into trusting incomplete sessions | Render unsupported/unknown explicitly |

## Feature Dependencies

```text
Adapter contract
    -> fake adapter fixture
    -> adapter contract tests
    -> harness registry
    -> shared ingestion
    -> normalized store
    -> shell parser
    -> verification engine
    -> run audit
    -> UI view models
    -> dashboards/detail pages

Gemini adapter
    -> Gemini fixtures
    -> raw artifact discovery
    -> raw event parsing
    -> normalized evidence
    -> shared ingestion and audit

Source registry
    -> path allowlist
    -> watcher plans
    -> scanner/indexer
    -> cache keys

Git provider
    -> project root confidence
    -> project/session context
    -> run audit dirty-state evidence
```

### Dependency Notes

- **Adapter contract requires normalized model:** Every adapter-facing test depends on stable shared types.
- **Run Audit requires shell parser and verification engine:** Without parsed command evidence, audit should be unknown or incomplete, not clean.
- **Renderer requires IPC view models:** UI should not consume adapter-private or raw parser objects.
- **Git/GitHub requires project-root confidence:** If a source cannot provide or infer a repo path safely, git features should be disabled or marked unknown.

## MVP Definition

### Launch With (v1)

Minimum viable product needed to validate the concept.

- [ ] Harness-neutral model, capabilities, diagnostics, and adapter contract.
- [ ] Fake adapter fixture proving adapter neutrality.
- [ ] Gemini CLI adapter parsing representative fixtures.
- [ ] Shared ingestion pipeline with safe source roots and normalized cache.
- [ ] Shared shell parser, verification classifier, and run audit engine.
- [ ] Read-only git provider for branch/head/dirty state when project root is known.
- [ ] Harness-neutral Overview, Projects, Sessions, Session Detail, Run Audit, Data Sources, and Diagnostics pages.
- [ ] Import-boundary and adapter contract tests.

### Add After Validation (v1.x)

- [ ] GitHub PR/check context via fixed read-only `gh` commands.
- [ ] Export/import archive flow with optional raw artifacts.
- [ ] Incremental parsing and more robust watcher behavior for active sessions.
- [ ] Better search/filter/sort across projects and sessions.
- [ ] More Gemini edge-case fixtures from real usage.

### Future Consideration (v2+)

- [ ] Real second harness adapter beyond fake/stub.
- [ ] SQLite-backed cache/search if file-backed cache becomes too slow.
- [ ] Third-party adapter plugin model.
- [ ] Lifecycle hooks or process-based active-session detection.
- [ ] Cost estimation after model/provider pricing sources are stable.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Adapter contract and normalized model | HIGH | HIGH | P1 |
| Fake adapter fixture | HIGH | LOW | P1 |
| Gemini adapter fixtures/parser | HIGH | HIGH | P1 |
| Shared shell/verification/audit | HIGH | HIGH | P1 |
| Harness-neutral UI pages | HIGH | HIGH | P1 |
| Git provider | MEDIUM | MEDIUM | P1 |
| GitHub provider | MEDIUM | MEDIUM | P2 |
| Export/import | MEDIUM | MEDIUM | P2 |
| SQLite cache | MEDIUM | MEDIUM | P3 |
| Real second adapter | HIGH | HIGH | P3 for V1, P1 for expansion milestone |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have or future milestone

## Competitor Feature Analysis

No direct competitor analysis was performed in this research pass. The feature set is driven by the supplied product spec, official Electron/React/Vite testing/security documentation, and the observed gap between normal transcript viewers and evidence-based coding-agent run audit.

| Feature | Generic log viewers | Git clients | Our Approach |
|---------|---------------------|-------------|--------------|
| Session replay | Often text-only | Not session-aware | Normalized messages, events, tools, files, shell, and artifacts |
| Verification truth | Usually absent | Shows repo status, not test intent | Shared shell parser and verification classifier |
| Harness support | Usually one format | Not applicable | Adapter contract and capabilities |
| Capability gaps | Usually hidden | Not applicable | Explicit unsupported/unknown rendering |

## Sources

- `.spec/spec-from-5.5-revision-1.md` - master feature and architecture spec.
- `.spec/additional-instructions.md` - V1 scope control and parser truth rules.
- https://www.electronjs.org/docs/latest/tutorial/security - security and read-only boundaries.
- https://www.electronjs.org/docs/latest/tutorial/context-isolation - safe preload/API exposure.
- https://www.electronjs.org/docs/latest/tutorial/ipc - IPC boundary model.
- https://reactrouter.com/start/declarative/routing - React Router page routing model and latest docs version.

---
*Feature research for: Agent Workbench*
*Researched: 2026-05-23*
