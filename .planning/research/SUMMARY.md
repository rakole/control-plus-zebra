# Project Research Summary

**Project:** Agent Workbench
**Domain:** Local-first coding-agent harness observability and audit
**Researched:** 2026-05-23
**Confidence:** HIGH for architecture direction, MEDIUM for final phase sizing until requirements are approved

## Executive Summary

Agent Workbench should be built as a harness-neutral Electron desktop app whose first job is to make local coding-agent runs trustworthy. The important research conclusion is not "use Electron + React" by itself; it is that the implementation must prove adapter neutrality before the UI becomes deep. Gemini CLI is valuable as the first real parser, but the app succeeds only if the shared core sees normalized evidence and capabilities, not Gemini-specific records.

The recommended approach is to start with the adapter contract, normalized model, capability schema, fake adapter, and boundary tests. Then add Gemini fixtures and parser coverage, shared ingestion/cache, shell parsing, verification, and run audit. UI should consume IPC view models after those contracts exist, because the UI must surface unknown/unsupported states honestly rather than flattening missing evidence into zeroes.

The biggest risks are first-adapter lock-in, unsafe Electron IPC/filesystem exposure, treating tool status as verification truth, and hiding parser uncertainty. Each risk has a direct mitigation: import-boundary tests, narrow preload APIs, shared shell/verification engines, capability-gated rendering, and visible diagnostics.

## Key Findings

### Recommended Stack

Use Electron 42.2.0, Electron Forge 7.11.2, Vite 8.0.14, React 19.2.6, TypeScript 6.0.3, and Zod 4.4.3. Electron Forge's Vite + TypeScript template is the safest starting point, but the implementation should review generated structure rather than blindly accepting scaffolded boundaries. File-backed cache is recommended first; SQLite can come later if session volume demands it.

**Core technologies:**
- Electron: desktop shell, main process, safe filesystem access, packaging - keep current for security.
- Electron Forge + Vite: official Electron packaging plus fast React/TypeScript renderer builds.
- React: dashboard/detail renderer UI.
- TypeScript: shared adapter/model/IPC contracts.
- Zod: runtime validation of raw-to-normalized output, config, and IPC payloads.
- Vitest: contract, parser, boundary, and audit tests.
- Playwright: Electron smoke tests, with experimental support caveat.

### Expected Features

**Must have (table stakes):**
- Harness/data source settings - users must configure and validate source roots.
- Projects and Sessions dashboards - users need top-level triage.
- Session Detail timeline - replay messages, lifecycle, tools, files, shell commands, artifacts, and unknown events.
- Run Audit - classify claim vs evidence.
- Verification classification - no verification is not clean; failed shell commands fail verification.
- Capability-aware rendering - unsupported evidence must be visible.
- Diagnostics - parser uncertainty is a product feature, not a debug afterthought.
- Contract and boundary tests - protect adapter neutrality.

**Should have (competitive):**
- Fake adapter proof in first milestone.
- Source/project-root confidence badges.
- Cross-harness attention queue.
- Export/import with privacy warnings.
- Read-only git and optional GitHub context.

**Defer (v2+):**
- Session launching.
- Approve/reject workflows.
- Arbitrary terminal control.
- PR creation.
- Real second non-Gemini adapter beyond the fake/stub proof.
- SQLite/native storage if file-backed cache is enough for V1.

### Architecture Approach

Use a main-process-owned ingestion and audit pipeline with a narrow preload bridge and renderer-only view models. Adapters discover and normalize raw harness artifacts; shared core validates, merges, parses shell evidence, classifies verification, classifies run audit, attaches read-only git/GitHub context, and emits capability-gated view models to React.

**Major components:**
1. Adapter contract and registry - descriptor, capabilities, source validation, artifact discovery, parsing, normalization, watch plans.
2. Source registry and scanner/indexer - safe root handling, artifact identity, cache invalidation.
3. Normalized model and store - Projects, Sessions, Events, Messages, ToolCalls, FileMutations, ShellCommandEvidence, OutputArtifacts, Diagnostics.
4. Shared shell/verification/audit engines - consistent trust classification across harnesses.
5. IPC/view-model layer - sanitized renderer data with capability gaps preserved.
6. React renderer - dashboards and detail pages without adapter-private imports.

### Critical Pitfalls

1. **First-adapter trap** - prevent with fake adapter, neutral names, registry boundaries, and import tests.
2. **Tool success treated as command success** - prevent with shared shell exit-code parsing and shell-failure fixtures.
3. **Missing evidence rendered as zero** - prevent with mandatory capability gates and unknown/unsupported UI states.
4. **Unsafe Electron boundary** - prevent with context isolation, sandboxing, CSP, typed preload, and no broad IPC.
5. **Parser fragility** - prevent with corrupt, partial, duplicate, cancellation, missing-sidecar, and active-session fixtures.
6. **Cross-harness cache collisions** - prevent with `adapterId` and `sourceId` in every identity and cache key.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Architecture Contracts and Fixture Proof
**Rationale:** Everything depends on getting the harness boundary right before implementation momentum locks in Gemini assumptions.
**Delivers:** Normalized model, capability schema, adapter contract, fake adapter, contract-test skeleton, import-boundary tests.
**Addresses:** Adapter neutrality, capability truth, diagnostics.
**Avoids:** First-adapter trap.

### Phase 2: Secure Electron App Shell
**Rationale:** The UI/runtime shell should enforce security boundaries before any data loading.
**Delivers:** Electron Forge + Vite + React + TypeScript scaffold, strict preload IPC, CSP/security defaults, page shell.
**Uses:** Electron, Forge, Vite, React, TypeScript, Zod.
**Implements:** Main/preload/renderer boundary.

### Phase 3: Shared Source Registry, Scanner, and Cache
**Rationale:** All adapters need the same safe source and artifact pipeline.
**Delivers:** Source root config, validation flow, artifact index, file-backed normalized cache, watcher orchestration.
**Addresses:** Source safety, cache collisions, incremental parse groundwork.

### Phase 4: Gemini CLI Adapter
**Rationale:** Gemini is the first real harness and fixture source, but should plug into the same contract as fake adapter.
**Delivers:** Gemini root discovery, `.project_root`, `logs.json`, `chats/*.jsonl`, sidecar parsing, mapping, fixtures, diagnostics.
**Addresses:** Real parser hazards.

### Phase 5: Shared Shell, Verification, and Run Audit
**Rationale:** This is the product wedge and must be shared-core, not adapter-owned.
**Delivers:** Shell parser, exit-code parser, command intent classifier, verification engine, run audit engine, status classifier.
**Avoids:** Tool-status shortcut and false clean states.

### Phase 6: Harness-Neutral UI
**Rationale:** UI should come after view models can carry capabilities and audit evidence.
**Delivers:** Overview, Projects, Sessions, Session Detail, Run Audit, Harnesses/Data Sources, Diagnostics.
**Addresses:** Capability-gated rendering and evidence drill-down.

### Phase 7: Git/GitHub Context and Export/Import
**Rationale:** Git state strengthens audit conclusions, while export/import supports local sharing and reproducibility.
**Delivers:** Read-only git provider, optional read-only gh provider, archive exporter/importer, privacy warnings.
**Addresses:** Dirty-after-claim evidence and portable review.

### Phase 8: Hardening, Packaging, and Readiness
**Rationale:** V1 needs reliability and trust more than extra features.
**Delivers:** Full contract suite, golden fixtures, corrupt/partial tests, boundary enforcement, packaging smoke tests, performance guardrails.
**Addresses:** "Looks done but isn't" risks.

### Phase Ordering Rationale

- Contracts and fake adapter come first because every later phase can otherwise encode Gemini assumptions accidentally.
- Secure Electron shell comes before data access because unsafe IPC is expensive to unwind.
- Shared ingestion/cache comes before Gemini parser so adapter output has a stable target.
- Gemini adapter comes before UI depth because real fixtures reveal diagnostics and evidence shapes.
- Shell/verification/audit comes before final UI polish because the audit model is the product's core value.
- Git/GitHub and export/import come after the core session model works.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Electron Forge scaffold details, CSP in dev/prod, preload typing, and Electron packaging defaults.
- **Phase 3:** File-backed cache shape and whether SQLite should be introduced earlier based on fixture volume.
- **Phase 4:** Real Gemini fixture corpus and edge-case coverage.
- **Phase 5:** Test output parser coverage for common JS/TS tools.
- **Phase 7:** Safe gh command set and timeout/error semantics.

Phases with standard patterns:
- **Phase 1:** Adapter contracts, fixtures, and import-boundary tests are straightforward but must be done carefully.
- **Phase 6:** React pages are standard once view models and capability states are stable.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified current versions with npm and official docs. |
| Features | HIGH | Strongly grounded in supplied master spec and supplemental notes. |
| Architecture | HIGH | Clear ownership boundaries and Electron security guidance align. |
| Pitfalls | HIGH | Major risks are explicit in the spec and common to adapter-based observability systems. |
| Performance/storage | MEDIUM | Needs real fixture sizes before choosing long-term cache backend. |
| Gemini parser edge cases | MEDIUM | Spec lists hazards, but implementation should build a real fixture corpus. |

**Overall confidence:** HIGH for direction, MEDIUM for exact phase sizing and storage choices.

### Gaps to Address

- **Real Gemini fixtures:** Gather representative completed, failed, cancelled, duplicate, missing-sidecar, and active sessions before locking parser behavior.
- **Cache backend:** Start file-backed; revisit SQLite only if indexing/search is painful with realistic data.
- **GitHub provider scope:** Define exact read-only `gh` commands and failure behavior in planning.
- **UI density:** Session detail can become noisy; design should prioritize attention reasons and progressive disclosure.

## Sources

### Primary (HIGH confidence)

- `.spec/spec-from-5.5-revision-1.md` - master product/architecture specification.
- `.spec/additional-instructions.md` - V1 scope control and parser truth rules.
- https://releases.electronjs.org/release/v42.2.0 - Electron current stable release.
- https://www.electronjs.org/docs/latest/tutorial/security - Electron security checklist.
- https://www.electronjs.org/docs/latest/tutorial/context-isolation - preload/context bridge security.
- https://www.electronjs.org/docs/latest/tutorial/ipc - IPC patterns.
- https://www.electronforge.io/templates/vite-+-typescript - Electron Forge Vite TypeScript template.
- https://vite.dev/guide/ - Vite project guidance.
- https://react.dev/versions - React current version docs.
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html - TypeScript 6 behavior and migration.
- https://vitest.dev/guide/ - Vitest testing.
- https://playwright.dev/docs/api/class-electron - Playwright Electron testing caveat.
- https://zod.dev/packages/zod - runtime schema validation library.

### Secondary (MEDIUM confidence)

- npm registry version checks via `npm view` on 2026-05-23 - exact package latest versions.

### Tertiary (LOW confidence)

- None used.

---
*Research completed: 2026-05-23*
*Ready for roadmap: yes*
