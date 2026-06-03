---
quick_id: 20260603-tracked-icon-resources
slug: tracked-icon-resources
status: in-progress
created_at: "2026-06-03T00:00:00Z"
---

# Tracked Icon Resources

Move app icon assets out of ignored `build/` output into tracked source assets so fresh clones can launch and package without machine-local build leftovers.

## Scope

- Promote the existing zebra icon files into a tracked repo resource directory.
- Repoint Electron Forge packaging and the development dock icon path to the tracked resources.
- Confirm no other app resources are referenced only from ignored `build/` output.

## Verification

- Confirm repo references no longer point at `build/icons`.
- Run focused validation for the touched config and main-process code.
- Verify startup still reaches the Electron launch path without relying on a pre-existing `build/` directory.
