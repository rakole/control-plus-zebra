# Spec Drift Recovery Plan

This plan is for bringing Agent Workbench back toward the original `.spec` contract without using GSD for the planning work. It intentionally ignores the concurrent shadcn-native branch except where UI contract work needs capability-aware renderer behavior later.

Source of truth:

- `.spec/spec-from-5.5-revision-1.md`
- `.spec/additional-instructions.md`

Current drift summary:

- The shared core model is narrower than the spec: current `Project`, `Session`, `SessionEvent`, `SessionMessage`, `ToolCall`, `ShellCommandEvidence`, and `OutputArtifact` are still closer to the early Phase 1 proof than the intended V1 contract in `.spec`.
- The capability model is flat, while the spec requires structured `discovery`, `replay`, `tools`, `usage`, `live`, `audit`, and `export` groups with explicit unsupported/unknown semantics.
- The adapter contract is missing or weakening key seams: `getDefaultSourceRoots`, required watch planning, richer `AdapterContext`, artifact references by spec shape, and public artifact loading by reference.
- Shell, verification, run audit, git, GitHub, and cache-derived truth exist, but are not yet first-class durable shared contract objects.
- Public IPC/preload APIs are route/view-model-oriented and omit spec seams such as `harnesses:*`, `sessions:getTimeline`, `events:get`, `toolCalls:get`, `shellCommands:get`, and `outputArtifacts:*`.
- At least one truth bug remains: `rawToolStatus === "succeeded"` can still become a passed shell command without exit-code evidence in `src/main/core/shell/shell-command-parser.ts`.
- `archive-reader` is registered as a bundled adapter but behaves like an import implementation detail, creating adapter-identity drift and contract-test ambiguity.

Use this document as six fresh-context waves. Each wave should end with tests updated to lock the recovered contract before moving to the next wave. Do not accept compatibility aliases as the final state unless the wave explicitly names a short-lived migration shim and a removal test.

## Wave 1 - Truth Rules And Contract Guardrails

Goal: stop any current behavior that can falsely report unsupported or unevidenced data as passed, clean, zero, or adapter-owned.

Why first:

- The product wedge is truthful audit, and this wave prevents later model/API work from baking in incorrect conclusions.
- This wave is small enough to execute first and gives later waves a safer red/green harness.

Primary code areas:

- `src/main/core/shell/shell-command-parser.ts`
- `src/main/core/shell/exit-code-parser.ts`
- `src/main/core/shell/types.ts`
- `src/main/core/verification/verification-classifier.ts`
- `src/main/core/verification/types.ts`
- `src/main/core/audit/run-audit-engine.ts`
- `src/main/core/audit/types.ts`
- `src/main/core/git/git-snapshot-provider.ts`
- `src/main/core/github/github-snapshot-provider.ts`
- `src/main/core/ingestion/scanner.ts`
- `tests/main/core/shell-command-parser.test.ts`
- `tests/main/core/verification-classifier.test.ts`
- `tests/main/core/run-audit-engine.test.ts`
- `tests/main/core/scanner-cache.test.ts`
- `tests/adapters/*/*.truth-rules.test.ts`

Work to do:

- Change `determineCommandResult` so raw tool success never implies shell pass by itself. A command may be `passed` only when explicit `exitCode === 0`, a parsed `Exit Code: 0`, or another intentionally modeled shell-result evidence source exists. If output is present but no exit code or strong result evidence exists, return `unknown`.
- Add regression tests for `rawToolStatus: "succeeded"` with no exit-code evidence. Expected shell result: `unknown`; expected verification result for a verification-intent command without usable outcome: `unknown`, not `passed`.
- Expand shell parsing to extract common test summary and failure details in the direction of the spec's `ParsedFailure[]` / failing-test expectations. Keep the first slice intentionally modest: command result, exit-code source, output source, and failure marker details must be deterministic and tested.
- Separate adapter capability from shared git/GitHub provider availability. Adapter capabilities should describe project-root evidence and harness evidence, not whether shared read-only git commands can run.
- Pass project git snapshot evidence into run audit. If the agent claimed completion and shared git evidence shows dirty or untracked state, emit `dirty-after-claim` / generated-untracked evidence instead of relying only on adapter-level `gitContextCapture`.
- Ensure `no verification` remains `not-run` or `unknown`, never `clean`.
- Add tests proving shell unsupported, shell unknown, output missing, parser warning, and git unavailable render as explicit truth states.

No-debt constraints:

- Do not add adapter-specific shell parsing to `src/main/adapters/**`; adapters emit shell evidence only.
- Do not treat tool-call status as a proxy for process exit status anywhere.
- Do not unblock clean audit classification merely because a capability is missing.
- Do not widen V1 into arbitrary shell execution; only fixed shared read-only git/gh providers remain allowed.

Acceptance checks:

- `npm run test -- --project node tests/main/core/shell-command-parser.test.ts`
- `npm run test -- --project node tests/main/core/verification-classifier.test.ts`
- `npm run test -- --project node tests/main/core/run-audit-engine.test.ts`
- `npm run test -- --project node tests/main/core/scanner-cache.test.ts`
- `npm run test -- --project node tests/adapters`

## Wave 2 - Shared Model, Capabilities, And Adapter Contract Reset

Goal: restore the shared contract surface now that Wave 1 and the shadcn-native renderer migration have landed.

Why second:

- The current model and capability shapes are too small for the intended architecture. PR #10 already replaced the renderer architecture, so Wave 2 must update the new app services, renderer bridge, feature routes, and app composites only as consumers of the shared contract reset.
- Public IPC renaming and output-artifact loading still belong to Wave 4. Wave 2 should not redesign the shadcn-native UI or collapse public API cleanup into this model/adapter-contract slice.

Primary code areas:

- `src/main/core/model/identifiers.ts`
- `src/main/core/model/confidence.ts`
- `src/main/core/model/capabilities.ts`
- `src/main/core/model/entities.ts`
- `src/main/core/model/index.ts`
- `src/main/core/adapter-contract/session-source-adapter.ts`
- `src/main/core/adapter-contract/types.ts`
- `src/main/core/ingestion/normalization-validator.ts`
- `src/main/core/cache/file-backed-cache-store.ts`
- `src/main/app/triage-view-model-service.ts`
- `src/main/app/data-sources-view-model-service.ts`
- `src/main/app/session-detail-view-model-service.ts`
- `src/main/app/run-audit-view-model-service.ts`
- `src/main/ipc/view-models.ts`
- `src/renderer/bridge/**`
- `src/renderer/features/**`
- `src/renderer/components/app/**`
- `src/main/adapters/fake-test/**`
- `src/main/adapters/gemini-cli/**`
- `src/main/core/archive/archive-reader-shared.ts`
- `src/main/adapters/archive-reader/**`
- `tests/contract/run-adapter-contract.ts`
- `tests/fixtures/**`
- `tests/main/ipc/**`
- `tests/preload/**`
- `tests/renderer/**`

Work to do:

- Introduce spec-aligned primitives: `HarnessId`, `SourceId`, `ProjectId`, `SessionId`, `NativeId`, `Confidence`, `RawEventPointer`, `EventOrderKey`, `UsageSummary`, `RawArtifactRef`, `OutputArtifactRef`, and stable diagnostic/source pointer shapes.
- Replace the flat `HarnessCapabilities` map with the grouped spec model: `discovery`, `replay`, `tools`, `usage`, `live`, `audit`, and `export`.
- Preserve the current good behavior of explicit truth labels, but apply it inside the grouped model. Booleans alone are not enough when a source/session capability is unknown; include helpers that convert grouped capability values into `Supported`, `Unsupported`, and `Unknown` view states.
- Add adapter-, source-, and session-level capability snapshots using the grouped model.
- Align `SessionSourceAdapter` with the spec: add `getDefaultSourceRoots(ctx)`, make `getWatchPlan(source, ctx)` a required method that may return an explicit unsupported plan, and make `loadOutputArtifact` accept a stable artifact reference rather than a transient entity object.
- Expand `AdapterContext` to include `appVersion`, `adapterRegistryVersion`, `now`, `platform`, `allowedRoots`, a diagnostic logger, and safe `readFile`, `statFile`, and stream helpers. Keep raw filesystem access out of adapters.
- Move the normalized model toward the spec shapes:
  - `Project`: `displayName`, `primaryRootPath`, `rootConfidence`, `harnessRefs`, `sessionIds`, latest activity/prompt/verification, optional git/GitHub snapshots, diagnostics.
  - `ProjectHarnessRef`: adapter/source/native IDs, native/project root path, root confidence, raw artifact refs.
  - `Session`: title/prompts, duration, `lifecycleStatus`, `attentionReasons`, `capabilities`, `parseConfidence`, relationship ID arrays, `usage`, `verification`, `runAudit`, `rawArtifactRefs`, diagnostics.
  - `SessionEvent`: semantic `kind`, `orderKey`, actor, title/text/severity, raw pointer, diagnostics.
  - `SessionMessage`: role including `unknown`, optional text, `modelName`, `usage`, tool/event IDs, source pointer, confidence.
  - `ToolCall`: `name`, `normalizedKind`, `statusRaw`, `statusNormalized`, previews, output artifact/file/shell links, source pointer.
  - `ShellCommandEvidence`: evidence-only command/cwd/output/raw exit/status/source/confidence.
  - `OutputArtifact`: `nativeRef`, path, `kind`, `contentKind`, preview, loaded state, source pointer.
- Add first-class shared model exports for `ShellCommand`, `VerificationResult`, and `RunAudit` instead of leaving durable truth only as ad hoc derived-cache types. If a transitional `derived` cache remains, version it explicitly and test it as a durable contract.
- Update `fake-test` and `gemini-cli` descriptors, normalizers, fixtures, and golden files to the new contract.
- Update `archive-reader` capability declarations and compile-time contract touchpoints only as needed to keep the grouped capability model consistent. Do not redesign archive import/export identity in this wave; that remains Wave 5.
- Update main-owned view-model services and IPC DTO schemas to consume the new shared model and grouped capability helpers.
- Update the shadcn-native renderer consumers under `src/renderer/bridge/**`, `src/renderer/features/**`, and `src/renderer/components/app/**` only enough to compile and preserve existing behavior with the new DTO/model fields.
- Preserve the PR #10 theme runtime and preload bridge exactly as a separate surface: `theme:getState`, `theme:setPreference`, `theme:stateChanged`, and `window.agentWorkbenchTheme` are not part of the Wave 2 contract reset.

No-debt constraints:

- Do not keep old fields like `content`, `artifactIds`, `artifactKind`, `toolName`, or `lifecycleState` as permanent aliases.
- Do not let adapters produce `verification.state`, `runAudit.classification`, or final `attentionReasons`. Shared core owns conclusions.
- Do not move renderer or app services directly onto adapter-private raw types.
- Do not redesign shadcn primitives, app composites, route layout, theme runtime, or feature folder architecture.
- Do not rename public IPC channels to `harnesses:*`, `sources:*`, `sessions:getTimeline`, `events:get`, `toolCalls:get`, `shellCommands:get`, or `outputArtifacts:*` in this wave.
- Do not implement output artifact preview/load IPC in this wave.

Acceptance checks:

- `npm run typecheck`
- `npm run test -- --project node tests/contract`
- `npm run test -- --project node tests/adapters/fake-test`
- `npm run test -- --project node tests/adapters/gemini-cli`
- `npm run test -- --project node tests/main/core/file-backed-cache-store.test.ts`
- `npm run test -- --project node tests/main/ipc`
- `npm run test -- --project node tests/preload`
- `npm run test:renderer`
- `npm run test:boundaries`

## Wave 3 - Ingestion, Cache, Watch, And Durable Derived Truth

Goal: make ingestion and persistence match the restored contract and prevent cache/watch behavior from becoming a hidden second model.

Why third:

- Once model and adapter contracts are correct, scanner/cache/watch must persist and derive truth from those contracts without losing evidence.

Primary code areas:

- `src/main/core/ingestion/scanner.ts`
- `src/main/core/ingestion/raw-artifact-index.ts`
- `src/main/core/ingestion/session-merger.ts`
- `src/main/core/ingestion/normalization-validator.ts`
- `src/main/core/cache/cache-keys.ts`
- `src/main/core/cache/file-backed-cache-store.ts`
- `src/main/core/watcher/watch-plan.ts`
- `src/main/core/watcher/watch-orchestrator.ts`
- `src/main/core/shell/**`
- `src/main/core/verification/**`
- `src/main/core/audit/**`
- `src/main/core/git/**`
- `src/main/core/github/**`
- `tests/main/core/cache-keys.test.ts`
- `tests/main/core/scanner-cache.test.ts`
- `tests/main/core/watch-orchestrator.test.ts`

Work to do:

- Align raw artifact references with the spec: optional `path`, optional `nativeRef`, `artifactKind`, `sizeBytes`, `mtime`, `inode`, and `parseStrategy`.
- Include adapter ID, source ID, artifact ID/path/native ref, mtime, size, adapter version, parser version, and normalization schema version in cache/index keys.
- Track raw artifact index entries for all artifact kinds, not just the subset needed for immediate session rendering.
- Add changed-artifact parsing. Full reparse may remain the fallback, but the index must know what changed and why. If an adapter lacks incremental parsing, mark that via `capabilities.live.incrementalParsing = false` and reparse with an explicit reason.
- Add parse offset or continuation metadata only where an adapter opts in. Do not fake incremental support for Gemini until fixtures prove append-safe parsing.
- Persist shell commands, verification results, run audits, git snapshots, GitHub snapshots, diagnostics, raw artifact index, and capability snapshots as first-class cache contract sections.
- Ensure session merging uses relationship IDs and raw pointers from the shared model, not implicit ordinal-only assumptions.
- Make watch planning required at the adapter contract level and persisted in source registry state. Unsupported watch plans should be explicit, not absent.
- Add a routed watch/poll event seam that can mark source cache stale and trigger UI updates without executing arbitrary code.

No-debt constraints:

- Do not keep `derived?: ...` as an unversioned optional bag.
- Do not compute public truth from stale cache records without surfacing stale/unknown.
- Do not allow cache collisions across adapters or imported archives.
- Do not parse files outside configured source roots or indexed artifact refs.

Acceptance checks:

- `npm run test -- --project node tests/main/core/cache-keys.test.ts`
- `npm run test -- --project node tests/main/core/scanner-cache.test.ts`
- `npm run test -- --project node tests/main/core/watch-orchestrator.test.ts`
- `npm run test -- --project node tests/main/core/file-backed-cache-store.test.ts`
- `npm run test:boundaries`

## Wave 4 - Public IPC, Preload, Output Artifacts, And Capability-Gated UI

Goal: restore the public app contract and make renderer behavior consume shared truth without collapsing missing data into zeros.

Why fourth:

- After model/cache truth is stable, IPC and UI can expose the intended seams instead of wrapping legacy route-specific DTO gaps.

Primary code areas:

- `src/main/ipc/channels.ts`
- `src/main/ipc/handlers.ts`
- `src/main/ipc/view-models.ts`
- `src/preload/index.ts`
- `src/preload/types.ts`
- `src/main/app/*view-model-service.ts`
- `src/main/app/workbench-runtime.ts`
- `src/renderer/routes/**`
- `src/renderer/components/**`
- `src/renderer/data-sources-bridge.ts`
- `tests/main/ipc/**`
- `tests/preload/preload-api-surface.test.ts`
- `tests/renderer/**`

Work to do:

- Align public channels and preload methods with the spec:
  - `harnesses:list`
  - `harnesses:getCapabilities`
  - `sources:list`, `sources:add`, `sources:update`, `sources:disable`, `sources:validate`, `sources:rescan`
  - `scanner:getStatus`, `scanner:rescanAll`, `scanner:rescanSource`
  - `projects:list`, `projects:get`
  - `sessions:list`, `sessions:get`, `sessions:getTimeline`
  - `events:get`, `toolCalls:get`, `shellCommands:get`
  - `outputArtifacts:getPreview`, `outputArtifacts:load`
  - `audit:getRunAudit`
  - `dashboard:getStats`
  - `git:getSnapshot`, `github:getSnapshot`
  - `export:createArchive`, `import:openArchive`
  - `diagnostics:list`
- If compatibility aliases are needed for a short migration, mark them deprecated in code/tests and add an explicit removal follow-up in the same wave. Do not let `dataSources:*`, `overview:get`, or `sessions:getDetail` remain the only public contract names.
- Add `OutputArtifactViewModelService` or equivalent. It must load only artifacts indexed under allowed source/import roots, enforce size/redaction limits, return preview vs full loaded content separately, and distinguish unsupported, unavailable, missing, and unreadable.
- Replace Gemini's in-memory sidecar map with durable indexed artifact refs so artifact loading works after cache reloads and app restarts.
- Wire session detail to show output artifact preview/load states from the public API.
- Make harness filters real route state, not inert pills. Pass adapter filters through Overview, Projects, Sessions, Diagnostics, and any relevant detail links.
- Convert capability-dependent evidence summary counts from plain numbers to `MetricStateViewModel` or equivalent. Shell commands, file mutations, output artifacts, token counts, verification, git, and GitHub must show `Unsupported` or `Unknown` when the capability or source evidence is absent.
- Map `usage.modelNames` and `usage.tokenCounts` into Overview/Sessions/Session Detail only when supported. Otherwise show capability-gated messaging.
- Keep UI labels harness-neutral: Assistant messages, Session event, Harness metadata, Output artifact, Source root.

No-debt constraints:

- Do not import adapter-private files into renderer, preload, IPC, or app services.
- Do not add `if adapterId === "gemini-cli"` or future adapter identity conditionals for behavior. Display metadata may come from registry descriptors.
- Do not render unsupported evidence as `0`.
- Do not let the renderer read files directly or receive broad filesystem capability.

Acceptance checks:

- `npm run test -- --project node tests/main/ipc`
- `npm run test -- --project node tests/preload`
- `npm run test:renderer`
- `npm run test:boundaries`
- `npm run typecheck`

## Wave 5 - Archive Import/Export, Archive Reader Identity, And Source Semantics

Goal: resolve the import/archive architecture so it supports the spec without pretending an import helper is a normal harness adapter unless it truly is one.

Why fifth:

- Archive work depends on durable cache/model/artifact contracts. It should not be settled before the shared model and output artifact refs are corrected.

Primary code areas:

- `src/main/core/archive/archive-exporter.ts`
- `src/main/core/archive/archive-importer.ts`
- `src/main/core/archive/archive-manifest.ts`
- `src/main/core/archive/archive-reader-shared.ts`
- `src/main/adapters/archive-reader/**`
- `src/main/core/registry/register-bundled-adapters.ts`
- `src/main/core/registry/source-registry.ts`
- `src/main/core/registry/source-registry-store.ts`
- `src/main/app/archive-export-service.ts`
- `src/main/app/archive-import-service.ts`
- `src/main/app/data-sources-view-model-service.ts`
- `tests/main/core/archive-exporter.test.ts`
- `tests/main/core/archive-importer.test.ts`
- `tests/main/core/source-registry.test.ts`
- `tests/adapters/archive-reader/**` if archive-reader remains an adapter

Work to do:

- Decide and implement one identity model:
  - Preferred: imported archives are read-only sources that preserve original `adapterId` on imported sessions/entities and track import provenance separately.
  - Alternative: `archive-reader` becomes a real adapter with contract tests, fixtures, capability declaration, and consistent entity/source rebasing.
- Remove hard-coded `adapterId === "archive-reader"` behavior from `src/main/app/data-sources-view-model-service.ts`. Replace it with descriptor/source metadata such as `configurable: false`, `sourceKind: "imported-archive"`, `readOnly: true`, and explicit import-only operation flags.
- Align validation rules so imported normalized records are either valid original-adapter records with import provenance or valid archive-reader records. Do not mix parent `normalized.adapterId = archive-reader` with entity `adapterId = gemini-cli` unless the schema explicitly models that as import provenance.
- Make export raw artifact selection cover all selected indexed raw artifact kinds, not only output sidecars. Session logs, metadata, message indexes, and project-root maps should be included when raw export is enabled and allowed.
- Preserve privacy warnings for raw transcript/archive export.
- Ensure imported sessions render without original local source roots.
- Ensure imported output artifacts load through the same `outputArtifacts:*` API with import-root allowlist enforcement.

No-debt constraints:

- Do not register a bundled adapter that cannot pass the shared adapter contract suite unless it is removed from normal adapter registration.
- Do not hide import-only behavior behind adapter identity conditionals in shared app services.
- Do not drop original harness identity from exported/imported sessions unless the chosen design explicitly says archive-reader owns the session.

Acceptance checks:

- `npm run test -- --project node tests/main/core/archive-exporter.test.ts`
- `npm run test -- --project node tests/main/core/archive-importer.test.ts`
- `npm run test -- --project node tests/main/core/source-registry.test.ts`
- `npm run test -- --project node tests/main/ipc`
- `npm run test:boundaries`

## Wave 6 - Adapter Hardening, Scenario Fixtures, Boundaries, And Feature Parity Audit

Goal: close the loop with spec-grade contract tests, feature parity checks, and removal of transitional shims.

Why last:

- This wave proves the repaired architecture is durable and prevents the next implementation pass from drifting again.

Primary code areas:

- `tests/contract/run-adapter-contract.ts`
- `tests/contract/adapter-contract.test.ts`
- `tests/adapters/fake-test/**`
- `tests/adapters/gemini-cli/**`
- `tests/adapters/archive-reader/**` if applicable
- `tests/fixtures/**`
- `tests/boundaries/import-boundaries.test.ts`
- `tests/boundaries/shared-naming.test.ts`
- `tests/renderer/renderer-boundary-source.test.ts`
- `src/main/adapters/fake-test/fixtures/**`
- `src/main/adapters/gemini-cli/fixtures/**`
- `docs/**` only if docs are now inaccurate after contract recovery

Work to do:

- Replace count/minimum-heavy adapter contract tests with capability-scenario manifests. Each adapter must declare which scenarios it supports and tests must assert unsupported scenarios remain unsupported/unknown, not fabricated.
- Add required scenario fixture categories from the spec:
  - basic session
  - multi-message session
  - assistant final answer
  - tool call
  - file read/search
  - file mutation
  - shell command
  - shell command failure
  - cancellation/lifecycle event
  - sidecar/output artifact
  - duplicate/intermediate raw records where applicable
  - partial/corrupt raw data
  - active/changing artifact when supported
  - unsupported capability cases
- Update golden normalization files so they include spec-shaped entities, raw pointers, diagnostics, usage/model evidence, output artifact content kinds, and no adapter-private raw payloads except opaque source pointers.
- Add contract coverage for Gemini `tokens` and `model` mapping into `SessionMessage` / `UsageSummary` and capability-gated UI.
- Add a fake/stub second adapter proof that still renders through the same Projects, Sessions, Session Detail, and Run Audit flow without Gemini changes.
- Expand boundary tests to cover `src/main/app`, `src/main/ipc`, and `src/preload` as shared-main surfaces. The only shared-main place allowed to import adapter entrypoints should be the composition root/adapter registry registration.
- Expand shared-naming tests to block shared `Gemini*` types outside adapter-private code.
- Block adapter-ID behavior conditionals in shared core/app/renderer except display metadata and test fixtures.
- Run a final feature parity audit against `.spec` sections 1-26 and produce a short checklist in this file or a follow-up drift audit doc before implementation is called complete.

No-debt constraints:

- Do not leave transitional aliases from Waves 2-4 without removal tests.
- Do not add a real third harness in this wave unless the fake adapter proof is already passing and the third harness is explicitly approved.
- Do not weaken contract tests to match current implementation. Tests should encode the spec-recovered architecture.

Acceptance checks:

- `npm run test`
- `npm run test:boundaries`
- `npm run test:renderer`
- `npm run typecheck`
- `npm run lint`

## Out Of Scope For These Six Waves

- A real third-party harness adapter beyond `fake-test` and Gemini CLI. The spec's future `xyz` acceptance criteria should be proven by the fake/stub adapter and contract suite first.
- Cost estimates. Keep `usage.costEstimates` explicitly unsupported or unknown until stable pricing data and provider mapping are deliberately designed.
- V2 active-session mechanisms such as process hooks, native harness APIs, lockfiles, PID-to-session mapping, or lifecycle hooks beyond the existing watcher/polling contract.
- Arbitrary shell execution, session launching, approve/reject, terminal control, PR creation, or branch/worktree cleanup inside Agent Workbench. V1 remains read-only.
- Shadcn-native architecture cleanup. That is intentionally happening on a separate branch and should not be mixed into this drift-recovery plan.

## Execution Notes For Future Fresh-Context Waves

- Start each wave by rereading `.spec/spec-from-5.5-revision-1.md`, `.spec/additional-instructions.md`, and this plan.
- Do not ask whether unsupported data should show as zero; the answer is no.
- Update tests before or alongside implementation, not afterward as a rubber stamp.
- Prefer deleting legacy compatibility shapes once consumers are moved.
- Keep every wave mergeable independently, but do not call the drift recovered until Wave 6 passes the full verification set.
