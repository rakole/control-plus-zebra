# Phase 4: Gemini CLI Adapter End-to-End - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the first real `gemini-cli` adapter on top of the existing shared source/scanner/cache/runtime pipeline so a user can register a Gemini temp-root such as `~/.gemini/tmp`, discover Gemini project/session artifacts, and see Gemini sessions flow into the same normalized session surfaces as the fake adapter with parser uncertainty preserved as diagnostics.

</domain>

<decisions>
## Implementation Decisions

### Root validation and source modeling
- **D-01:** Configure the Gemini adapter against a temp-root directory such as `~/.gemini/tmp`, not individual chat files or individual tool-output folders.
- **D-02:** Treat each project directory under the configured Gemini temp root as a discovered source when it contains Gemini evidence such as `.project_root`, `logs.json`, `chats/session-*.jsonl`, or `tool-outputs/session-<uuid>/*`.
- **D-03:** Normalize the discovered source `rootPath` to the project directory itself, while using the `.project_root` file contents as project-repo evidence inside normalized project/session metadata.
- **D-04:** Root validation should confirm the configured path is a directory and surface partial-layout problems as diagnostics rather than rejecting the whole root when at least one candidate Gemini project folder is discoverable.

### Artifact discovery and sidecar loading
- **D-05:** Discover `.project_root`, `logs.json`, `chats/session-*.jsonl`, and files under `tool-outputs/session-<uuid>/*` as first-class Gemini artifacts.
- **D-06:** Treat `chats/session-*.jsonl` as the primary chronological session artifact, with `logs.json` acting as auxiliary session/message index data and `.project_root` acting as project-root mapping evidence.
- **D-07:** Keep tool-output bodies out of the normalized cache payload. Normalize output artifact references first, then use `loadOutputArtifact` for on-demand sidecar reads.
- **D-08:** Ignore filesystem noise such as `.DS_Store` during artifact discovery unless it collides with an expected Gemini artifact path; unexpected parseable-but-invalid Gemini artifacts should become diagnostics, not crashes.

### Parser resilience and raw-event strategy
- **D-09:** Parse Gemini artifacts record-by-record with best-effort continuation. One malformed JSON row, partial write, or corrupt sidecar should yield a diagnostic while the rest of the scan continues.
- **D-10:** Preserve Gemini-specific intermediate records such as `$set` patches, duplicate assistant/tool updates, and active-session partials as adapter-private raw events before mapping them to shared normalized entities.
- **D-11:** Use the Gemini session UUID found in filenames and records as the primary join key across chat files, `logs.json`, and tool-output directories. Missing joins become diagnostics instead of invented links or silent drops.

### Normalized mapping and truth semantics
- **D-12:** Map Gemini evidence into shared projects, sessions, lifecycle events, metadata events, messages, tool calls, file mutations, shell command evidence, output artifacts, and diagnostics only. Do not emit verification or run-audit conclusions from the adapter.
- **D-13:** Derive session lifecycle from chronological Gemini evidence when available, but emit diagnostics whenever summary metadata and timeline evidence disagree instead of silently trusting one field.
- **D-14:** When sidecars are missing, JSON-wrapped, plain-text, duplicate, or partially written, preserve whatever tool/file/shell evidence exists and attach diagnostics at artifact/session scope instead of collapsing the whole session to empty or failed.

### Fixture and contract proof style
- **D-15:** Add a compact but representative Gemini fixture pack that covers happy path, active, cancelled, duplicate/intermediate, corrupt/partial, JSON sidecar, plain-text sidecar, missing sidecar, and stray-file cases.
- **D-16:** Reuse the shared adapter contract suite and add Gemini-specific golden/edge-case coverage under `tests/adapters/gemini-cli/**`, with no Gemini branches added to shared core or renderer code.
- **D-17:** Ground the fixture shapes in observed local Gemini artifacts, but check in minimized/anonymized repo fixtures rather than reading a live `~/.gemini/tmp` tree directly in tests.

### the agent's Discretion
- Exact module boundaries inside `src/main/adapters/gemini-cli/**`, as long as discovery, parsing, normalization, fixtures, and adapter-private helpers stay isolated from shared core.
- Exact raw Gemini event kind names and diagnostic code strings, as long as they remain adapter-private and descriptive.
- Whether `logs.json` is parsed as one artifact with many auxiliary events or as a smaller metadata-index stream, as long as chat JSONL remains the primary chronological evidence.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and phase contract
- `AGENTS.md` - Repository-level product brief, stack, conventions, architecture boundaries, and workflow constraints.
- `.planning/ROADMAP.md` - Phase 4 goal, success criteria, and the four planned work slices (`04-01` through `04-04`).
- `.planning/REQUIREMENTS.md` - Locked Phase 4 requirement set covering `ADPT-03` through `ADPT-06`.
- `.planning/PROJECT.md` - Core value, harness-neutral adapter boundary, read-only V1 scope, and observed Gemini artifact families.
- `.planning/STATE.md` - Current project focus, carry-forward decisions from Phases 1-3, and the Gemini fixture-corpus concern.

### Prior phase decisions that carry forward
- `.planning/phases/01-architecture-contracts-and-fixture-proof/01-CONTEXT.md` - Locks the adapter lifecycle seams, harness-neutral naming, deterministic IDs, diagnostics-first behavior, and boundary-enforcement expectations.
- `.planning/phases/02-secure-desktop-shell-and-view-model-bridge/02-CONTEXT.md` - Locks typed IPC/view-model boundaries and the rule that renderer surfaces consume normalized shared data only.
- `.planning/phases/03-source-registry-scanner-cache-and-data-sources-ui/03-CONTEXT.md` - Locks the shared source-registry/scanner/cache/watcher/Data Sources flow that the Gemini adapter must plug into without introducing provider-specific UI or registry semantics.

### Gemini adapter architecture and truth rules
- `.spec/spec-from-5.5-revision-1.md` - Defines the `gemini-cli` adapter boundary, observed Gemini artifacts, and the rule that shared core consumes normalized evidence rather than raw Gemini shapes.
- `.spec/additional-instructions.md` - Reinforces evidence-only adapters, shared-core ownership of verification/audit, and the fake-plus-real-adapter proof requirement.
- `.planning/research/PITFALLS.md` - Highlights the first-adapter trap, parser fragility on active/corrupt artifacts, and sidecar-format hazards that Phase 4 must address directly.

### Existing shared seams to extend
- `src/main/core/adapter-contract/session-source-adapter.ts` - Public adapter lifecycle contract that the Gemini adapter must implement.
- `src/main/core/adapter-contract/types.ts` - Shared source/artifact/raw-event/normalization types, `AdapterContext`, and `loadOutputArtifact` seam.
- `src/main/core/ingestion/scanner.ts` - Shared validation, artifact metadata enrichment, normalization validation, cache write, and watch-plan orchestration flow that will execute the Gemini adapter.
- `src/main/core/security/safe-filesystem.ts` - Safe path allowlist and indexed-artifact read rules that Gemini parsing and sidecar loading must honor.
- `src/main/core/registry/register-bundled-adapters.ts` - Composition-root-only adapter registration seam where `gemini-cli` must be added beside `fake-test`.
- `src/main/app/workbench-runtime.ts` - Runtime composition that already wires registry, scanner, cache, and source registry together.
- `src/main/app/session-view-model-service.ts` - Current neutral session-loading path proving new adapter output can flow into Sessions UI through cached normalized records.
- `src/main/ipc/view-models.ts` - Current view-model contract showing that adapter labels and capability badges already surface through metadata rather than provider-specific UI branches.

### Existing adapter/test pattern to mirror
- `src/main/adapters/fake-test/descriptor.ts` - Descriptor and capability declaration shape to mirror for the first real adapter.
- `src/main/adapters/fake-test/discovery.ts` - Current source/artifact discovery split and source-ID creation pattern.
- `src/main/adapters/fake-test/parse.ts` - Parse-to-raw-event pattern that turns bad artifacts into diagnostics instead of throws.
- `src/main/adapters/fake-test/normalize.ts` - Raw-event-to-shared-entity mapping style and diagnostic attachment pattern.
- `tests/contract/run-adapter-contract.ts` - Reusable contract harness every adapter must satisfy.
- `tests/boundaries/shared-naming.test.ts` - Guardrail that blocks shared Gemini-shaped types or provider-ID branches outside adapter-private code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/main/core/adapter-contract/session-source-adapter.ts` and `src/main/core/adapter-contract/types.ts`: the lifecycle contract, shared IDs, artifact refs, and optional `loadOutputArtifact` seam already exist and should be reused rather than reshaped for Gemini.
- `src/main/core/ingestion/scanner.ts`: the shared scanner already validates roots, passes `safeFilesystem`, enriches artifact metadata, validates normalized output, writes cache records, and plans watches, so the Gemini adapter can stay focused on harness-specific discovery/parsing/mapping.
- `src/main/core/security/safe-filesystem.ts`: safe directory listing, file reads, and indexed artifact reads already provide the right read-only boundary for Gemini chat and sidecar parsing.
- `src/main/adapters/fake-test/**`: current descriptor/discovery/parse/normalize split is the clearest in-repo example for how the Gemini adapter should stay adapter-private while still passing the shared contract.
- `tests/contract/run-adapter-contract.ts`: the shared contract suite already asserts capability coverage, relationship integrity, and forbidden conclusion fields.

### Established Patterns
- Adapter-private code lives entirely under `src/main/adapters/<id>/**`, while shared core stays limited to contracts, scanner/cache/security/runtime, and neutral view models.
- The scanner creates `safeFilesystem` contexts from configured roots and discovered artifact paths, so Gemini parsing should avoid direct `fs` calls where adapter context already provides the safe seam.
- Session and Data Sources UI flows are already descriptor-driven and capability-aware, meaning Phase 4 should add no new renderer/provider branching to surface Gemini sessions or Gemini roots.
- Normalized cache records are keyed by `adapterId`, `sourceId`, adapter/parser version, schema version, diagnostics hash, and artifact fingerprints, so Gemini IDs and artifact refs must stay deterministic and adapter/source-aware.

### Integration Points
- Add `src/main/adapters/gemini-cli/**` and register the adapter through `src/main/core/registry/register-bundled-adapters.ts` only.
- Extend Data Sources behavior through the existing descriptor/default-root path so `Gemini CLI` appears naturally in adapter metadata and source configuration without changing the renderer contract.
- Feed normalized Gemini sessions into the existing cache/session view-model pipeline so Sessions UI can render them alongside fake-test sessions without new special cases.
- Add Gemini-specific contract/golden/edge-case coverage under `tests/adapters/gemini-cli/**` while keeping shared boundary tests unchanged except for new adapter-private path coverage.

</code_context>

<specifics>
## Specific Ideas

- A read-only local sample under `~/.gemini/tmp/blueprint` confirms the expected project-folder layout: `.project_root`, `logs.json`, `chats/session-2026-05-23T09-11-4cabc6be.jsonl`, and `tool-outputs/session-4cabc6be-ea53-4cff-90c5-c729d7a5ab8c/*`.
- The same sample shows `logs.json` behaving like a session/message index keyed by `sessionId` and `messageId`, while the chat JSONL stream contains the richer chronological transcript, `$set` metadata patches, assistant/tool records, and tool-call status/result payloads.
- Observed tool-output files are plain-text sidecars whose filenames encode tool name and call ID; the adapter should therefore support both plain-text and JSON-wrapped sidecars without assuming one universal format.
- The observed `tool-outputs/` directory also contains stray `.DS_Store` noise, so discovery should deliberately ignore OS artifacts rather than treating them as parser failures.

</specifics>

<deferred>
## Deferred Ideas

- Shared shell parsing, verification classification, and run-audit truth rules remain Phase 5 work even though Phase 4 must preserve raw shell/tool evidence faithfully.
- Git, GitHub, export/import, and privacy/redaction behavior remain later phases; Gemini adapter work should not broaden into repo-context or archive features.
- Broader Gemini root autodetection heuristics beyond the known temp-root default can wait unless the existing `defaultRoots` path proves insufficient during planning.

</deferred>

---

*Phase: 04-gemini-cli-adapter-end-to-end*
*Context gathered: 2026-05-23*
