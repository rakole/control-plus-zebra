# Roadmap: Agent Workbench

## Overview

Agent Workbench starts by proving the harness-neutral contract with a fake adapter, then turns that proof into a secure Electron desktop app, shared ingestion pipeline, Gemini CLI adapter, audit engine, user-facing triage UI, read-only git/GitHub/export support, and final V1 hardening. The order is deliberate: contracts and evidence truth come before UI depth so Gemini remains the first adapter, not the architecture.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Architecture Contracts and Fixture Proof** - Prove harness neutrality with shared contracts, fake adapter, and boundary tests.
- [x] **Phase 2: Secure Desktop Shell and View-Model Bridge** - Create the Electron/Vite/React shell with safe IPC and local-only security defaults.
- [x] **Phase 3: Source Registry, Scanner, Cache, and Data Sources UI** - Let users configure sources and run shared ingestion through a safe cache pipeline.
- [x] **Phase 4: Gemini CLI Adapter End-to-End** - Parse Gemini fixtures into the same normalized flow as the fake adapter.
- [x] **Phase 5: Shared Shell, Verification, and Run Audit** - Turn evidence into trustworthy command, verification, and audit classifications.
- [x] **Phase 6: Harness-Neutral Triage UI** - Deliver the user-facing dashboards, detail views, diagnostics, and capability-gated states.
- [ ] **Phase 7: Git, GitHub, Export, and Import** - Add read-only repo/PR context plus portable archive workflows.
- [ ] **Phase 8: Hardening, Packaging, and Readiness** - Verify the full desktop app, packaging path, and safety gates for V1.

## Phase Details

### Phase 1: Architecture Contracts and Fixture Proof
**Goal:** A developer can run tests that prove a fake harness adapter normalizes a fixture through shared harness-neutral contracts without any Gemini-specific shared core or renderer coupling.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** [ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, ADPT-01, ADPT-02, ADPT-07, TEST-01, TEST-02, TEST-03]
**Success Criteria** (what must be TRUE):
  1. Developer can register a fake adapter descriptor and normalize one fixture into shared project, session, event, message, tool, shell evidence, and diagnostic objects.
  2. Shared model exposes harness-neutral IDs, capabilities, diagnostics, and normalized entity types without shared `Gemini*` names.
  3. Adapter contract tests and golden normalization tests pass for the fake adapter.
  4. Import-boundary tests fail if shared core or renderer imports adapter-private files.
  5. Adapter code has no path to emit final verification states, run audit classifications, or attention reasons.
**Plans:** 4 plans

Plans:
**Wave 1**
- [x] 01-01: Define normalized model, capabilities, diagnostics, IDs, and confidence contracts.
**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02: Implement adapter contract, registry, and fake adapter fixture.
**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-03: Add contract and golden normalization tests for adapter outputs.
- [x] 01-04: Add import-boundary enforcement for core, renderer, and adapters.

Cross-cutting constraints:
- Shared surfaces stay harness-neutral: no shared `Gemini*` types, imports, or behavior branches leak outside adapter-private code.
- Adapters emit evidence and diagnostics only; verification and run-audit conclusions remain shared-core responsibilities.

### Phase 2: Secure Desktop Shell and View-Model Bridge
**Goal:** User can open a local Electron desktop app shell that communicates through a narrow typed preload bridge and cannot access unsafe Electron, filesystem, or shell APIs from the renderer.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** [DESK-01, DESK-02, DESK-03, DESK-04, DESK-05, DESK-06]
**Success Criteria** (what must be TRUE):
  1. User can launch the macOS Electron/Vite/React/TypeScript app shell.
  2. Renderer runs with Node.js integration disabled, context isolation enabled, sandboxing enabled, and local packaged content only.
  3. Preload exposes one typed method per allowed IPC operation and never exposes `ipcRenderer`.
  4. IPC handlers validate payloads and return sanitized view models rather than raw files or adapter-private objects.
  5. Tests or smoke checks prove renderer code cannot read arbitrary files, run shell commands, or import main adapter internals.
**Plans:** 4 plans

Plans:
- [x] 02-01: Scaffold Electron Forge + Vite + React + TypeScript without weakening security defaults.
- [x] 02-02: Implement typed preload API and IPC handler conventions.
- [x] 02-03: Add local-only CSP, renderer restrictions, and forbidden API checks.
- [x] 02-04: Render first app shell route from sanitized fake-adapter view-model data.

### Phase 3: Source Registry, Scanner, Cache, and Data Sources UI
**Goal:** User can configure a harness source root, validate it, scan it through the shared ingestion pipeline, and see source/cache diagnostics without adapters owning unsafe filesystem or watcher behavior.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, UI-06]
**Success Criteria** (what must be TRUE):
  1. User can add, enable, disable, and validate a harness source root from Harnesses and Data Sources settings.
  2. Shared scanner routes source validation, source discovery, artifact discovery, parsing, and normalization through registered adapters.
  3. Raw artifact index and cache keys include adapter ID, source ID, artifact identity, version, schema, and diagnostic inputs.
  4. Malformed normalized fragments are rejected or diagnosed before they reach the store.
  5. Shared watcher orchestration consumes adapter watch plans and adapters cannot create their own watchers.
**Plans:** 11 plans

Plans:
**Wave 1**
- [x] 03-01: Implement persisted source registry records and source validation state.
**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-02: Implement safe filesystem helpers, indexed output-artifact allowlisting, and fake adapter refactor.
**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-03: Implement scanner, raw artifact index, normalization validation, and session merge path.
- [x] 03-04: Implement watcher plan contract and shared orchestrator boundary.
**Wave 4** *(blocked on Wave 3 scanner completion)*
- [x] 03-05: Implement file-backed normalized cache keys and store foundation.
**Wave 5** *(blocked on Wave 4 cache foundation completion)*
- [x] 03-06: Integrate scanner cache writes with source scan/cache summaries.
**Wave 6** *(blocked on Wave 5 cache summary integration)*
- [x] 03-07: Route existing session view models through the source/scanner/cache path.
- [x] 03-08: Add Data Sources view-model and DTO service layer.
**Wave 7** *(blocked on Wave 6 Data Sources service completion)*
- [x] 03-09: Wire Data Sources IPC, preload, and Electron main integration.
**Wave 8** *(blocked on Wave 7 IPC/preload completion)*
- [x] 03-10: Build Harnesses and Data Sources renderer route around shared source state.
**Wave 9** *(blocked on Wave 8 renderer completion)*
- [x] 03-11: Extend Data Sources renderer, preload, and IPC guardrails.

### Phase 4: Gemini CLI Adapter End-to-End
**Goal:** User can point Agent Workbench at Gemini CLI fixture data and see parsed Gemini sessions flow through the same normalized pipeline as the fake adapter, with parser uncertainty surfaced as diagnostics.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** [ADPT-03, ADPT-04, ADPT-05, ADPT-06]
**Success Criteria** (what must be TRUE):
  1. `gemini-cli` adapter can discover and validate a Gemini source root such as `~/.gemini/tmp`.
  2. Adapter discovers `.project_root`, `logs.json`, `chats/session-*.jsonl`, and `tool-outputs/session-<uuid>/*` artifacts.
  3. Gemini raw records map into shared sessions, messages, lifecycle events, metadata events, tool calls, file mutations, shell command evidence, output artifacts, and diagnostics.
  4. Duplicate, partial, corrupt, cancelled, active, JSON sidecar, plain-text sidecar, and missing-sidecar fixtures produce stable normalized output or visible diagnostics.
  5. Core and renderer continue using shared normalized objects with no Gemini adapter internals imported.
**Plans:** 4 plans

Plans:
- [x] 04-01: Implement Gemini source discovery, root validation, and raw artifact discovery.
- [x] 04-02: Implement Gemini log/chat/project-root/sidecar parsers.
- [x] 04-03: Map Gemini raw events to normalized fragments and diagnostics.
- [x] 04-04: Add Gemini edge-case fixtures and contract coverage.

### Phase 5: Shared Shell, Verification, and Run Audit
**Goal:** User can trust Run Audit because shell exit-code evidence, verification commands, cancellation, final-answer claims, file mutations, pending tools, capability gaps, and git dirty state are classified by shared core rules.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** [AUDT-01, AUDT-02, AUDT-03, AUDT-04, AUDT-05, AUDT-06, AUDT-07, AUDT-08, AUDT-09, TEST-04, TEST-05, TEST-06]
**Success Criteria** (what must be TRUE):
  1. Shell evidence becomes normalized commands with intent, output source, exit code, failure state, parsed failures, confidence, and diagnostics.
  2. Tool status success cannot override nonzero shell exit-code evidence.
  3. Verification classifies failed test/build/typecheck/lint commands as failed and no-verification sessions as `not-run`.
  4. Missing shell capability produces unknown or unsupported verification, never passed.
  5. Run Audit covers active, cancelled, verification-failed, incomplete, needs-review, clean, and unknown classifications with attention reasons.
**Plans:** 4 plans

Plans:
**Wave 1**
- [x] 05-01: Implement shell command parser, exit-code parser, and command intent classifier.
**Wave 2** *(blocked on Wave 1 completion)*
- [x] 05-02: Implement verification classifier and no-verification/capability-gap semantics.
**Wave 3** *(blocked on Wave 2 completion)*
- [x] 05-03: Implement run audit engine, attention reasons, and status precedence.
**Wave 4** *(blocked on Wave 3 completion)*
- [x] 05-04: Add shell, verification, and audit fixtures/tests for truth-rule edge cases.

Cross-cutting constraints:
- Shared shell, verification, and run-audit conclusions stay in `src/main/core/**`; adapters remain evidence-only and current IPC/session preview outputs stay sanitized until Phase 6.
- Missing or unsupported capability states remain explicit and must never flatten into `passed` or `clean`; `clean` is gated behind explicit supported git context.
- Prefer scan-time shared derivation plus persisted derived summaries over adapter-specific heuristics or caching full stdout/stderr bodies.

### Phase 6: Harness-Neutral Triage UI
**Goal:** User can triage agent runs through harness-neutral Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics pages that preserve capability gaps instead of hiding missing evidence.
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** [UI-01, UI-02, UI-03, UI-04, UI-05, UI-07, UI-08, UI-09, TEST-07]
**Success Criteria** (what must be TRUE):
  1. Overview, Projects, and Sessions pages show harness filters, status, activity, verification, and capability warning summaries.
  2. Session Detail shows harness badge, lifecycle status, attention reasons, capability warnings, and a mixed timeline of normalized evidence.
  3. Run Audit groups claim-vs-evidence, verification, file, command, cancellation, git/GitHub, capability, and parser diagnostic evidence.
  4. Diagnostics page surfaces parser, source, adapter, cache, and capability diagnostics.
  5. UI tests prove unsupported capabilities render unsupported/unknown and no behavior branches depend on provider IDs except display metadata.
**Plans:** 5 plans

Plans:
- [x] 06-01: Build dashboard view models and Overview/Projects/Sessions pages.
- [x] 06-02: Build Session Detail timeline and evidence cards.
- [x] 06-03: Build Run Audit page with claim-vs-evidence sections.
- [x] 06-04: Build Diagnostics page and capability warning patterns.
- [x] 06-05: Add UI tests for capability gates and adapter-neutral rendering.

### Phase 7: Git, GitHub, Export, and Import
**Goal:** User can enrich audit views with safe read-only repo context, optional read-only GitHub context, and portable archives without mutating local repositories or remote PRs.
**Mode:** mvp
**Depends on:** Phase 6
**Requirements:** [GIT-01, GIT-02, GIT-03, GIT-04, GIT-05, GIT-06]
**Success Criteria** (what must be TRUE):
  1. Shared git provider collects branch, HEAD SHA, dirty state, changed/untracked files, additions/deletions, and remote URL with fixed read-only commands.
  2. Git context is disabled or marked unknown when project-root confidence is insufficient.
  3. Optional GitHub provider detects `gh` and reads PR/check/review context without creating or modifying PRs.
  4. Export creates a harness-neutral archive with metadata, normalized data, diagnostics, and optional raw artifacts.
  5. Import loads an archive as a read-only source and raw export warns about sensitive transcript, path, and command-output data.
**Plans:** 4 plans

Plans:
**Wave 1**
- [x] 07-01: Implement read-only git provider and root-confidence gating.
**Wave 2** *(blocked on Wave 1 completion)*
- [x] 07-02: Implement optional read-only GitHub provider and failure semantics.
- [x] 07-03: Implement harness-neutral export archive with privacy warnings.
**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 07-04: Implement archive import as a read-only source.

Cross-cutting constraints:
- Repo and GitHub truth stay shared-main, project-scoped, and read-only; renderer routes consume typed DTOs only and never execute `git` or `gh` themselves.
- Missing repo and GitHub evidence remains explicit as `Unknown`, `Unsupported`, or `No Matching PR`; no Phase 7 surface may flatten gaps into `Clean`, `Passed`, `0`, or a hidden section.
- Raw export may include only indexed allowlisted artifacts behind an explicit privacy warning, and imported archives remain persistent read-only sources with no live validate, scan, watch, git, or GitHub operations.

### Phase 8: Hardening, Packaging, and Readiness
**Goal:** User can run a packaged V1-ready desktop app whose smoke tests verify app launch, preload behavior, forbidden API boundaries, and end-to-end fixture audit flows.
**Mode:** mvp
**Depends on:** Phase 7
**Requirements:** [TEST-08]
**Success Criteria** (what must be TRUE):
  1. Electron smoke tests launch the app shell and verify the preload bridge works.
  2. Smoke tests prove renderer cannot access forbidden filesystem, shell, Electron, or adapter-private APIs.
  3. End-to-end fixture checks show fake and Gemini sessions through data source, session, detail, and audit flows.
  4. Packaging smoke checks run successfully for the macOS target.
  5. V1 readiness checklist confirms read-only scope, capability truth, parser diagnostics, and boundary tests.
**Plans:** 3 plans

Plans:
- [ ] 08-01: Add Electron app-launch, preload, and forbidden API smoke tests.
- [ ] 08-02: Add end-to-end fixture audit smoke coverage.
- [ ] 08-03: Add packaging/readiness checks and final V1 quality gate.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Architecture Contracts and Fixture Proof | 4/4 | Complete | 2026-05-23 |
| 2. Secure Desktop Shell and View-Model Bridge | 4/4 | Complete | 2026-05-23 |
| 3. Source Registry, Scanner, Cache, and Data Sources UI | 11/11 | Complete | 2026-05-23 |
| 4. Gemini CLI Adapter End-to-End | 4/4 | Complete | 2026-05-23 |
| 5. Shared Shell, Verification, and Run Audit | 4/4 | Complete | 2026-05-24 |
| 6. Harness-Neutral Triage UI | 5/5 | Complete | 2026-05-24 |
| 7. Git, GitHub, Export, and Import | 2/4 | In Progress | - |
| 8. Hardening, Packaging, and Readiness | 0/3 | Not started | - |
