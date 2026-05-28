---
quick_id: 20260528-overview-activity-heatmap
slug: overview-activity-heatmap
status: complete
completed_at: "2026-05-28T11:45:00Z"
---

# Overview Activity Heatmap Summary

Added a lazy-loading Overview activity heatmap for the fixed last 30 days. The main Overview metrics still load through the existing dashboard stats request, while the heatmap uses a separate IPC/preload bridge request and shows a local loading state inside its own card.

## Implementation

- Added a store-backed heatmap query over current source session rollups, returning exactly 30 daily buckets with session and attention counts.
- Added a dedicated `dashboard:getOverviewActivityHeatmap` IPC request and preload/renderer bridge method.
- Added a lazy renderer heatmap card using `@uiw/react-heat-map`, fuchsia theme intensity, accessible day labels, and degraded coverage visibility.
- Kept the orchestrator as coordinator/reviewer; Stage 1 data pipeline and Stage 2 UI were each implemented by fresh GPT-5.4 high subagents.

## Verification

- `npx vitest run tests/main/ipc/triage-view-model-service.test.ts tests/main/ipc/ipc-handlers.test.ts tests/main/core/sqlite-workbench-entity-store.test.ts tests/main/ipc/data-sources-ipc.test.ts` - passed, 4 files and 34 tests.
- `npm run test -- --project renderer tests/renderer/overview-route.test.tsx` - passed, 1 file and 2 tests.
- `npm run lint` - passed.
- `npm run typecheck` - failed on pre-existing `react-syntax-highlighter` type/import issues in `src/renderer/features/sessions/components/run-audit-sections.tsx`.

## Notes

- `getDashboardStats` still retains its existing `activity` field for compatibility; the new heatmap is fetched separately for lazy loading.
- `package.json` and `package-lock.json` already had unrelated local edits before this task; this task added `@uiw/react-heat-map`.
