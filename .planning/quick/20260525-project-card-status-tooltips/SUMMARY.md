---
quick_id: 20260525-project-card-status-tooltips
slug: project-card-status-tooltips
status: complete
completed_at: "2026-05-25T09:15:11Z"
---

# Project Card Status Tooltips Summary

Updated the Projects list cards to omit compact `Unknown` status/metadata bubbles while preserving full repository metadata in the selected project detail pane. Visible project-list chips now expose category-aware hover text such as run audit status, verification status, Git status, GitHub status, branch, dirty state, and pull request.

## Verification

- `npm run test -- --project renderer tests/renderer/projects-route.test.tsx` - passed, 1 file and 3 tests
- `npm run typecheck` - passed
- `npm run lint` - passed
- `npm run test:renderer` - passed, 13 files and 76 tests

## Notes

- `Unknown` is still available in detailed repository metadata and DTOs; the filtering is limited to the left-side compact project cards.
- The Electron preload-backed route was verified through renderer tests with bridge mocks because opening the renderer directly in a browser would not provide `window.agentWorkbench`.
