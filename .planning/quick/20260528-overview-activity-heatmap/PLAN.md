---
quick_id: 20260528-overview-activity-heatmap
slug: overview-activity-heatmap
status: in-progress
created_at: "2026-05-28T00:00:00Z"
---

# Overview Activity Heatmap

Add a lazy-loading, fixed last-30-days activity heatmap to the Overview page using a dedicated data request and the app's fuchsia theme.

## Scope

- Stage 1: Add the data pipeline for a dedicated Overview heatmap request.
- Stage 2: Add the renderer heatmap UI with isolated loading state.
- Keep the orchestrator as coordinator/reviewer only; each stage is implemented by a fresh GPT-5.4 high subagent.
- Keep the range fixed to the last 30 days with no month, year, or range controls.
- Keep the Overview summary loading independently from the heatmap.

## Verification

- Focused main IPC/view-model tests for the heatmap request.
- Focused renderer Overview tests proving lazy heatmap loading.
- Typecheck and lint if touched shared types or renderer components require them.
