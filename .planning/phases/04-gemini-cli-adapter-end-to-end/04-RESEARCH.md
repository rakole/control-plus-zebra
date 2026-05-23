# Phase 4: Gemini CLI Adapter End-to-End - Research

**Researched:** 2026-05-23
**Status:** Ready for planning

## Executive Summary

Phase 4 should add the first real `gemini-cli` adapter without changing the shared scanner, cache, IPC, or renderer contracts to think in Gemini-shaped terms. The repo already has the right shared seams: source validation and scan orchestration in `src/main/core/ingestion/scanner.ts`, root-scoped and artifact-scoped reads in `src/main/core/security/safe-filesystem.ts`, normalized relationship validation in `src/main/core/ingestion/normalization-validator.ts`, and a full fake-adapter example split across descriptor, discovery, parse, and normalize modules. The Gemini work should plug into those seams rather than re-architect them.

The highest-value path is to treat the configured Gemini temp root as a directory containing multiple project sources, discover the known Gemini artifact families per project, parse each artifact into adapter-private raw events with diagnostic-tolerant continuation, map those raw events into shared projects/sessions/messages/tools/files/shell evidence/output artifacts, and prove the behavior through a compact but representative fixture pack plus contract and golden tests.

The phase should stay deliberately focused on evidence capture, not audit conclusions. Shared shell parsing, verification classification, run-audit truth rules, Git/GitHub interpretation, and deeper UI surfaces remain later-phase work. Phase 4 succeeds when Gemini fixture data flows through the same shared normalized pipeline as the fake adapter and uncertainty is surfaced as diagnostics instead of crashes or silent drops.

The highest-value implementation order is:

1. Add the `gemini-cli` descriptor, source-root validation, project-source discovery, and raw artifact discovery.
2. Add adapter-private parsers for `logs.json`, chat JSONL, `.project_root`, and sidecar evidence with best-effort continuation.
3. Map Gemini raw events into shared normalized entities and diagnostics without introducing shared `Gemini*` types or adapter-level conclusions.
4. Lock the behavior with edge-case fixtures, contract tests, golden normalization tests, and boundary coverage.

## What Phase 4 Must Prove

### Proof obligations from roadmap and requirements

- A user can configure and validate a Gemini CLI temp-root such as `~/.gemini/tmp` through the existing shared source-registry and scanner flow.
- The adapter can discover project sources under that temp root when a project directory contains evidence such as `.project_root`, `logs.json`, `chats/session-*.jsonl`, or `tool-outputs/session-<uuid>/*`.
- The adapter can discover and classify the expected raw Gemini artifact families: `.project_root`, `logs.json`, `chats/session-*.jsonl`, and tool-output sidecar files.
- The adapter maps Gemini evidence into shared `Project`, `Session`, `SessionEvent`, `SessionMessage`, `ToolCall`, `ShellCommandEvidence`, `OutputArtifact`, `FileMutationEvidence`, and `Diagnostic` objects only.
- Duplicate, partial, corrupt, cancelled, active, missing-sidecar, JSON-sidecar, plain-text-sidecar, and stray-file cases produce stable normalized output or visible diagnostics rather than crashes or silent data loss.
- The adapter passes the shared contract harness and integrates through the existing bundled-adapter registry without introducing shared provider branches or shared `Gemini*` symbols.

### Scope fences

- Do not add adapter-level verification status, run-audit classification, or attention reasons. `ADPT-07` still applies and Phase 5 owns those conclusions.
- Do not broaden Data Sources UX, Sessions UI, or renderer routing just to make Gemini visible. The current descriptor-driven and normalized-data flow is the contract to reuse.
- Do not move scanner, cache, safe-filesystem, or normalization-validator logic into the adapter. Gemini should consume those shared seams, not replace them.
- Do not inline large sidecar bodies into normalized cache records. Use output artifact references plus `loadOutputArtifact` for on-demand reads.
- Do not depend on a live `~/.gemini/tmp` tree in automated tests. Fixtures should be checked in, minimized, and anonymized.

## Recommended Implementation Shape

### 1. Treat the configured temp root as a project-source discovery root

The current scanner validates one configured source root, then calls `discoverSources()` and `discoverArtifacts()` on the adapter. Gemini should preserve that model rather than asking the user to register individual chat files or tool-output directories. A strong fit for the existing flow is:

- `validateSourceRoot()` accepts a directory root and confirms it exists as a directory.
- `discoverSources()` walks the configured temp root and yields one discovered source per project directory with Gemini evidence.
- each discovered source uses the project directory as `rootPath`, while `.project_root` contents become project/repo evidence during normalization.

This matches the Phase 4 context decision and the scanner's existing ability to handle multiple discovered sources from one configured root.

### 2. Mirror the fake-adapter split, but keep Gemini raw events adapter-private

The fake adapter already demonstrates the right ownership boundaries:

- `descriptor.ts` declares ID, display name, versions, default roots, and capabilities.
- `discovery.ts` handles validation, source discovery, and artifact discovery.
- `parse.ts` turns artifact reads into raw adapter events and parse-diagnostic events.
- `normalize.ts` maps raw adapter events into shared normalized entities and diagnostics.

Gemini should reuse this split so adapter-private parsing stays isolated under `src/main/adapters/gemini-cli/**`. The raw event layer should preserve Gemini-specific intermediate states such as metadata patches, duplicate assistant/tool updates, and active-session partial records without forcing those shapes into shared contracts.

### 3. Make chat JSONL the primary chronology and keep auxiliary artifacts additive

Observed repo notes and phase context point to `chats/session-*.jsonl` as the richest chronological source of truth. The recommended hierarchy is:

- chat JSONL drives message/event/tool chronology
- `logs.json` supplies auxiliary indexes, timestamps, or metadata joins when present
- `.project_root` provides project-root mapping evidence
- `tool-outputs/session-<uuid>/*` provide output-artifact content references and sidecar diagnostics

When the sources disagree, preserve chronology where possible and emit diagnostics for contradictions instead of silently trusting one summary field.

### 4. Use diagnostic-tolerant continuation for active and damaged artifacts

The repo's core value and pitfalls research both argue against fail-fast behavior for live session artifacts. Gemini parsing should therefore:

- parse JSONL line-by-line or record-by-record
- keep successfully parsed records even when one row is malformed
- treat corrupt JSON, partial writes, missing joins, unknown sidecar formats, and stray files as diagnostics
- continue normalizing remaining evidence when enough data exists to do so honestly

This aligns with the existing fake adapter pattern where parse failures become raw diagnostic events instead of thrown exceptions, and with the scanner's ability to merge normalized results plus diagnostics.

### 5. Keep sidecar bodies behind indexed artifact reads

The current `SafeFilesystem` API distinguishes ordinary root reads from indexed artifact reads. Gemini should lean into that boundary:

- discover tool-output files as raw artifacts with deterministic IDs and metadata
- normalize them into `OutputArtifact` references attached to sessions, events, or tool calls
- implement `loadOutputArtifact()` for lazy reads of plain-text or JSON-wrapped sidecars

This keeps cache payloads lean, respects the Phase 3 safe-filesystem boundary, and avoids turning the first real adapter into a bulk transcript copier.

## Recommended Plan Split

| Plan | Wave | Why it exists |
|------|------|----------------|
| `04-01` | 1 | Add the `gemini-cli` descriptor, default root hint, temp-root validation, project-source discovery, raw artifact discovery, and bundled-adapter registration. |
| `04-02` | 2 | Build adapter-private parsers for `.project_root`, `logs.json`, chat JSONL, and sidecar evidence with diagnostic-tolerant continuation. |
| `04-03` | 3 | Map Gemini raw events into shared normalized entities, capability snapshots, deterministic IDs, and diagnostics without adapter-level conclusions. |
| `04-04` | 4 | Add Gemini fixture coverage, contract tests, golden normalized snapshots, and edge-case truth tests for duplicate/partial/corrupt/active/missing-sidecar behavior. |

### Dependency rationale

- `04-01` must land first because the scanner and source registry can only exercise Gemini behavior after the adapter is registered and can discover sources/artifacts.
- `04-02` depends on `04-01` because parsing needs stable artifact identities and discovered Gemini file families.
- `04-03` depends on `04-02` because normalization should be driven by the final raw-event shapes, not speculative parser output.
- `04-04` depends on all prior slices because the fixture corpus and truth tests should lock the real discovery, parsing, and normalization behavior rather than a placeholder design.

## Validation Architecture

### Test infrastructure for this phase

- **Reusable contract suite:** `tests/contract/run-adapter-contract.ts` should exercise the Gemini adapter the same way it already exercises `fake-test`.
- **Gemini-specific adapter tests:** add coverage under `tests/adapters/gemini-cli/**` for discovery, parsing, normalization, and artifact-loading behavior.
- **Golden normalized snapshots:** add checked-in Gemini normalized outputs under `tests/fixtures/gemini-cli/**`, mirroring the fake-adapter pattern.
- **Boundary guardrails:** keep `tests/boundaries/import-boundaries.test.ts` and `tests/boundaries/shared-naming.test.ts` green so Gemini stays adapter-private.
- **Core safety checks:** continue running TypeScript, lint, and the existing core scanner/cache/IPC test suite so the first real adapter does not destabilize shared seams.

### What must be validated

- `validateSourceRoot()` accepts a valid Gemini temp root directory and rejects invalid or missing roots with source-scoped diagnostics.
- `discoverSources()` yields stable source IDs for project directories and does not collapse multiple projects into one source.
- `discoverArtifacts()` indexes the expected Gemini artifact families while ignoring noise such as `.DS_Store`.
- parser failures become diagnostics, not uncaught exceptions or silent omissions.
- normalized entities carry the correct `adapterId` and `sourceId`, satisfy relationship validation, and do not contain forbidden conclusion fields.
- sidecar loading works through the indexed artifact seam for plain-text and JSON-wrapped outputs, and missing sidecars surface explicit diagnostics.
- shared core and renderer continue to avoid provider-specific imports or behavior branches after Gemini support lands.

### Fast feedback strategy

- During `04-01`, run targeted discovery/registry tests plus `npm run typecheck`.
- During `04-02`, run focused Gemini parser tests for each artifact family and corruption case before wider suite runs.
- During `04-03`, run normalization tests plus the shared contract suite after each mapping slice.
- During `04-04`, run boundary tests, Gemini golden tests, and the full test suite before closing the phase.

## Security and Truth Guardrails

- All filesystem access should continue flowing through `AdapterContext.safeFilesystem`; Gemini adapter code should not introduce raw unrestricted filesystem reads.
- Project discovery and artifact loading must remain rooted in configured Gemini source paths or indexed artifact refs only.
- Parser uncertainty must become `Diagnostic` evidence. Do not silently coerce corrupt, duplicate, or contradictory Gemini records into clean success states.
- Shared core remains the only place allowed to infer verification status, run-audit classification, or attention reasons from shell/tool/file evidence.
- Renderer-facing behavior should stay descriptor-driven and normalized-data-driven. Adding Gemini must not require special renderer branches beyond display metadata already supported by shared view models.

## Risks to Watch During Execution

### Risk 1: Gemini raw shapes leak into shared contracts

The first real adapter creates pressure to add Gemini-shaped shared types or provider-specific branches. That would directly violate the repo's architecture and boundary tests. Keep all Gemini-specific raw payloads, patch semantics, and diagnostic codes inside `src/main/adapters/gemini-cli/**`.

### Risk 2: project-root discovery fights the current configured-source model

The scanner currently starts from one configured root and can yield multiple discovered sources. If Gemini work accidentally treats each chat file or sidecar directory as a configured source, Data Sources semantics and cache/source identity will drift. Preserve the temp-root-to-project-source discovery chain.

### Risk 3: sidecar loading bypasses the artifact allowlist

It will be tempting to read tool-output files directly from normalization code. That would weaken the safe-filesystem contract added in Phase 3. Keep sidecar loading behind indexed artifact refs and `loadOutputArtifact()`.

### Risk 4: parser resilience stops at the first malformed row

Happy-path fixtures can hide fragility until active or partially written sessions appear. Build the corrupt/partial/duplicate fixtures early enough that parse/normalize code is forced to keep going with diagnostics rather than aborting.

### Risk 5: shared tests stay fake-adapter-only

The repo currently has one bundled adapter and one golden fixture family. If Gemini lands without matching contract and golden coverage, the first real adapter can silently erode shared guarantees. Treat fixture and contract proof as part of the feature, not cleanup.

## Planning Assumptions

- The current scanner, cache, and normalization-validator seams are sufficient for the first real adapter and do not require a new shared contract before Phase 4 planning starts.
- A compact checked-in Gemini fixture corpus can be derived from observed local artifact shapes without storing sensitive live session data.
- `Gemini CLI` should appear through descriptor metadata and existing source-registry/session flows rather than through new provider-specific UI routes.
- Shared shell parsing, verification classification, and run-audit truth remain intentionally deferred to Phase 5 even though Gemini must preserve shell/tool/file evidence faithfully in Phase 4.

---
*Research completed: 2026-05-23*
*Ready for planning: yes*
