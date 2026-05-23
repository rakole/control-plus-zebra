# Phase 3: Source Registry, Scanner, Cache, and Data Sources UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 3-Source Registry, Scanner, Cache, and Data Sources UI
**Areas discussed:** Data Sources screen shape, Source validation and scan timing, Cache and stale-data truth, Path selection and source persistence, Watcher behavior boundary

---

## Auto-Mode Note

The user explicitly approved auto mode for this discussion phase: generate the required questions and options, do not ask interactively, choose the recommended answer as the user's answer, and complete the process without interruption.

---

## Data Sources Screen Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Split list/detail management | Recommended. Gives users a scan-friendly source list plus a focused detail panel for add/edit/validate/rescan without overbuilding dashboards. | yes |
| Dense settings table | Efficient for many sources, but too cramped for diagnostics and source-specific capability truth in the first implementation. | |
| Guided add-source flow | Friendly for first setup, but less useful for repeated source management and scan/cache inspection. | |

**User's choice:** Split list/detail management (auto-selected recommended default)
**Notes:** Phase 2 already has a persistent app shell and route patterns. Phase 3 should activate a Data Sources/Harnesses management surface without absorbing later Overview or full Diagnostics scope.

---

## Source Validation and Scan Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Validate first, then explicit scan/rescan | Recommended. Keeps source correctness and ingestion separate, exposes validation diagnostics clearly, and avoids surprising scans when editing paths. | yes |
| Validate and immediately scan | Faster first-run experience, but couples path editing to potentially noisy scanner/cache work too early. | |
| Save first and validate later | Simplest persistence path, but risks configured sources looking valid when they are unsupported, missing, or unsafe. | |

**User's choice:** Validate first, then explicit scan/rescan (auto-selected recommended default)
**Notes:** Validation failures should preserve attempted source entries with diagnostics instead of hiding missing evidence or flattening it into an empty source.

---

## Cache and Stale-Data Truth

| Option | Description | Selected |
|--------|-------------|----------|
| Show concise operational status and diagnostics | Recommended. Makes never-scanned, scanning, failed, stale, cached, unsupported, unknown, and diagnostics-bearing states visible without building a full diagnostics console. | yes |
| Keep cache status mostly internal | Smaller UI, but conflicts with the product's core value of truthful evidence classification. | |
| Build a deep cache inspector now | Useful later, but too much UI depth for a source/scanner/cache foundation phase. | |

**User's choice:** Show concise operational status and diagnostics (auto-selected recommended default)
**Notes:** Cache/index metadata should be adapter/source-aware and preserve diagnostic hash and artifact/version inputs so stale or unsupported evidence cannot masquerade as clean data.

---

## Path Selection and Source Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Typed path entry with validation and file-backed persistence | Recommended. Smallest useful read-only UX, aligns with existing IPC security constraints, and proves source registry behavior before native picker complexity. | yes |
| Fixture/default source only | Keeps implementation tiny, but does not satisfy the user-configurable source root goal. | |
| Native picker IPC plus persistence | Better desktop polish, but expands Electron surface area before the registry and scanner contracts are proven. | |

**User's choice:** Typed path entry with validation and file-backed persistence (auto-selected recommended default)
**Notes:** The fake adapter should remain a proof source, but registry, IPC, and UI naming must stay harness-neutral and ready for Gemini CLI roots in Phase 4.

---

## Watcher Behavior Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Expose source enabled state and watch-plan support, keep live watching internal | Recommended. Satisfies source management and adapter capability truth while preserving shared watcher orchestration as an internal safety boundary. | yes |
| Expose full watching controls now | More transparent, but risks adding live-control UX before shared watcher lifecycle is implemented and tested. | |
| Defer all watcher state | Avoids UI complexity, but hides a Phase 3 success criterion: shared watcher orchestration consumes adapter watch plans. | |

**User's choice:** Expose source enabled state and watch-plan support, keep live watching internal (auto-selected recommended default)
**Notes:** Adapters must not create watchers directly. Unsupported or unknown watch support should render as unsupported or unknown, not as zero activity.

---

## the agent's Discretion

- Exact module boundaries for source registry, scanner, artifact index, cache, and Data Sources view models.
- Exact local file format for persisted sources and normalized cache, subject to deterministic adapter/source-aware keys and V1 packaging simplicity.
- Exact scan-status naming, as long as unsupported, unknown, stale, failed, and diagnostics-bearing states stay distinct from empty or successful states.
- Exact Data Sources visual density and component naming, as long as the page remains a work-focused desktop management surface.

## Deferred Ideas

- Native macOS directory/file picker UX after typed-path registry behavior is proven.
- Deep cache inspector and full Diagnostics page after scanner/cache contracts stabilize.
- Full live watcher controls and real-time scan UX after shared watcher orchestration is implemented and verified.
