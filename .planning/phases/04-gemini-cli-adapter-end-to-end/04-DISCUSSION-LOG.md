# Phase 4: Gemini CLI Adapter End-to-End - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 04-gemini-cli-adapter-end-to-end
**Areas discussed:** Root validation and source modeling, Artifact discovery and sidecar loading, Parser resilience and raw-event strategy, Normalized mapping and truth semantics, Fixture and contract proof style

---

## Root Validation And Source Modeling

| Option | Description | Selected |
|--------|-------------|----------|
| Configured temp root, discovered project sources | Validate a Gemini temp-root such as `~/.gemini/tmp`, then discover one source per project directory under it. Keeps Data Sources UX stable while matching the observed layout. | ✓ |
| Project folder as configured root | Ask users to configure each project directory directly. Simpler parser logic, but poorer multi-project source UX. | |
| Chat files as sources | Treat each `session-*.jsonl` file as its own source. Avoids project discovery, but breaks the existing source/scanner/cache model. | |

**User's choice:** Configured temp root, discovered project sources
**Notes:** Auto-selected the recommended option per the user's non-interactive instruction. This matches the current scanner/source-registry design and the observed local `~/.gemini/tmp/blueprint` layout.

---

## Artifact Discovery And Sidecar Loading

| Option | Description | Selected |
|--------|-------------|----------|
| Discover all Gemini artifact families and lazy-load sidecars | Index `.project_root`, `logs.json`, chat JSONL, and tool-output files, but keep tool-output bodies behind `loadOutputArtifact` so normalized cache stays lean. | ✓ |
| Chat-only artifact discovery | Normalize only `session-*.jsonl` and ignore logs/sidecars for the first pass. Faster to build, but loses important evidence and diagnostics. | |
| Inline sidecar bodies into normalized results | Read and embed tool-output file contents during normalization. Simpler rendering later, but increases cache size and scan cost. | |

**User's choice:** Discover all Gemini artifact families and lazy-load sidecars
**Notes:** Auto-selected the recommended option. This lines up with the existing `loadOutputArtifact` seam and the local sample's mix of chat, log, and sidecar evidence.

---

## Parser Resilience And Raw-Event Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnostic-tolerant continuation | Parse records incrementally, keep good evidence, and emit diagnostics for corrupt rows, partial writes, or missing joins. | ✓ |
| Fail-fast parsing | Stop the artifact or scan on the first malformed record. Easier to reason about, but unsafe for active or partially written Gemini artifacts. | |
| Silent best-effort drops | Skip malformed records quietly. Produces less noise, but violates the app's truthfulness requirement. | |

**User's choice:** Diagnostic-tolerant continuation
**Notes:** Auto-selected the recommended option. This follows the project rule that parser uncertainty becomes diagnostics instead of hidden assumptions.

---

## Normalized Mapping And Truth Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Evidence-only mapping with lifecycle diagnostics | Emit shared sessions/events/messages/tools/files/shell artifacts and diagnose contradictions, while leaving verification and run-audit conclusions to shared core. | ✓ |
| Adapter-level verification inference | Let the Gemini adapter infer verification or cleanliness from raw status fields. Faster short term, but breaks the shared audit boundary. | |
| Trust summary metadata over chronology | Prefer one raw completion field even when the timeline disagrees. Simpler, but less truthful for cancelled/active/partial sessions. | |

**User's choice:** Evidence-only mapping with lifecycle diagnostics
**Notes:** Auto-selected the recommended option. This preserves the Phase 4 boundary and keeps Phase 5 responsible for verification/audit semantics.

---

## Fixture And Contract Proof Style

| Option | Description | Selected |
|--------|-------------|----------|
| Compact representative fixture pack | Check in minimized Gemini fixtures covering happy path plus active/cancelled/duplicate/corrupt/missing-sidecar variants and prove them through shared contract/golden tests. | ✓ |
| Happy-path-only fixture | Add one clean Gemini fixture first and defer edge cases. Lower initial effort, but weak proof against the known parser hazards. | |
| Large raw corpus copied from live temp root | Mirror a broad live Gemini temp tree directly. Strong grounding, but noisy, privacy-sensitive, and harder to review. | |

**User's choice:** Compact representative fixture pack
**Notes:** Auto-selected the recommended option. It keeps the proof reviewable while still grounding shapes in the observed live Gemini sample.

---

## the agent's Discretion

- Exact file/module breakdown inside `src/main/adapters/gemini-cli/**`.
- Exact raw Gemini event labels and diagnostic code names.
- Exact split between `logs.json` helper events and chat JSONL primary events.

## Deferred Ideas

- Shared shell/verification/run-audit interpretation remains Phase 5 scope.
- Git, GitHub, export/import, and broader privacy/redaction features remain later phases.
- Broader Gemini root autodetection heuristics can wait unless planning shows the default root is insufficient.
