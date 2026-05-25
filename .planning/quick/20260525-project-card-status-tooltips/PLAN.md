---
quick_id: 20260525-project-card-status-tooltips
slug: project-card-status-tooltips
status: in-progress
created_at: "2026-05-25T09:08:31Z"
---

# Project Card Status Tooltips

Update the Projects page list cards so compact project status bubbles omit `Unknown` states and visible bubbles explain their category on hover.

## Scope

- Hide `Unknown` truth/field badges in the left-side project list cards only.
- Preserve detailed repository metadata values in the selected project detail pane.
- Add category tooltips for visible status bubbles such as run audit, verification, git, GitHub, branch, dirty state, and PR.
- Add renderer coverage for the compact-card behavior.

## Verification

- Focused Projects route renderer tests.
- TypeScript check if the touched renderer typings need it.
