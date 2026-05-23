# Phase 5: Shared Shell, Verification, and Run Audit - Pattern Map

**Mapped:** 2026-05-24
**Scope:** Shared-core shell parsing, verification derivation, run-audit classification, cache persistence, and headless truth-rule coverage.

## Existing Patterns To Preserve

| New Area | Closest Existing Analog | Pattern To Reuse |
|----------|-------------------------|------------------|
| Shared post-normalization derivation | `src/main/core/ingestion/scanner.ts` | Derive shared-core facts only after `validateNormalizedResult(normalized)` succeeds, while adapter context and `safeFilesystem` are still live, then persist one cache record per discovered source. |
| Strict cache schema growth | `src/main/core/cache/file-backed-cache-store.ts` | Extend the cache record Zod schema with a sibling derived payload instead of stuffing verification/audit conclusions into adapter-normalized entities. |
| Harness-neutral relation fields | `src/main/core/model/entities.ts` plus adapter `normalize.ts` files | Add optional shared link fields only on shared entities and backfill them in adapters when the source evidence actually knows them. |
| Scan-time output-artifact loading | `src/main/adapters/gemini-cli/index.ts` | Use `loadOutputArtifact()` during scan while the binding map is live; do not move sidecar coupling into renderer code or post-cache heuristics first. |
| Sanitized renderer boundary | `src/main/app/session-view-model-service.ts` and `tests/main/ipc/session-view-model-service.test.ts` | Internal audit and verification data may exist in cache records, but current IPC/session preview surfaces stay free of run-audit conclusion fields until Phase 6. |
| Truth-rule regression tests | `tests/adapters/fake-test/fake-adapter.truth-rules.test.ts`, `tests/adapters/gemini-cli/gemini-adapter.truth-rules.test.ts`, `tests/boundaries/shared-naming.test.ts` | Keep adapters evidence-only and fail fast if verification/audit conclusion fields leak back into normalized entities. |

## Planned File Roles

| Plan | Files / Modules | Role |
|------|-----------------|------|
| `05-01` | `src/main/core/shell/**`, `src/main/core/model/entities.ts`, `src/main/core/cache/file-backed-cache-store.ts`, `src/main/core/ingestion/scanner.ts`, adapter `normalize.ts` files | Add harness-neutral shell evidence links, scan-time shell parsing, and persisted parsed shell summaries. |
| `05-02` | `src/main/core/verification/**`, `src/main/core/cache/file-backed-cache-store.ts`, `src/main/core/ingestion/scanner.ts` | Derive verification truth from parsed shell commands with explicit capability-gap semantics. |
| `05-03` | `src/main/core/audit/**`, `src/main/core/cache/file-backed-cache-store.ts`, `src/main/core/ingestion/scanner.ts`, `tests/main/ipc/session-view-model-service.test.ts` | Derive run-audit status plus attention reasons while keeping current IPC/view models sanitized. |
| `05-04` | fake/Gemini fixtures plus `tests/main/core/**`, `tests/adapters/**`, `tests/boundaries/**` | Lock the truth table with focused fixtures, regression coverage, and boundary assertions. |

## Key Code Excerpts

### Scanner already owns the safe point between normalization and cache writes

```typescript
const normalized = await adapter.normalize(...);
const validation = validateNormalizedResult(normalized);
...
cacheRecord = {
  cacheKey,
  adapterId: normalized.adapterId,
  sourceId: normalized.sourceId,
  artifactFingerprint,
  createdAt: now,
  updatedAt: now,
  normalized
};

await this.#cacheStore.writeRecord(cacheRecord);
```

Use this seam for Phase 5 derivation rather than pushing logic into adapters or renderer consumers.

### Gemini output artifacts are only reliably readable while adapter bindings are live

```typescript
const binding = outputArtifactBindings.get(artifact.id);
const rawText = await safeFilesystem.readIndexedTextArtifact(
  binding.rawArtifactId,
  binding.path
);
```

Phase 5 shell parsing should therefore happen during `scanSource()`, not after cached records are reloaded in a later process.

### Session IPC tests already define the public boundary to preserve

```typescript
const forbiddenKeys = new Set([
  "rawEvents",
  "artifactPath",
  "verificationStatus",
  "runAuditStatus",
  "attentionReasons"
]);
```

Internal derived audit data is fine; current renderer-facing session summaries and previews must still omit those fields.

## Implementation Notes

- Keep new logic under `src/main/core/shell/**`, `src/main/core/verification/**`, and `src/main/core/audit/**`; adapters keep emitting evidence only.
- Prefer a sibling `derived` cache payload keyed by session ID over adding verification or audit fields to `AdapterNormalizationResult`.
- When relationship data is knowable from adapter raw evidence, backfill shared link fields such as `toolCallId`, `artifactIds`, and `rawToolStatus` instead of inventing Gemini-shaped heuristics in shared core.
- Phase 5 stays headless. Phase 6 owns user-facing run-audit pages, richer session detail, and public presentation of these derived results.
