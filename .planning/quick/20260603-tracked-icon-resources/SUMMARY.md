---
quick_id: 20260603-tracked-icon-resources
slug: tracked-icon-resources
status: complete
completed_at: "2026-06-03T09:17:24Z"
---

# Tracked Icon Resources Summary

Promoted the app icon assets out of ignored `build/` output into tracked repo resources so fresh clones do not depend on machine-local leftovers.

## Implementation

- Copied the zebra icon PNG, ICNS, and iconset assets into tracked `resources/icons/`.
- Repointed Electron Forge packaging from `build/icons/zebra-icon` to `resources/icons/zebra-icon`.
- Repointed the development macOS dock icon path from `build/icons/zebra-icon.png` to `resources/icons/zebra-icon.png`.
- Re-scanned repo references and confirmed the only remaining `build` usage is the expected generated `.vite/build` main entrypoint, not app-owned source assets.

## Verification

- `npm run typecheck` - passed.
- `npm start` with the local `build/` directory temporarily moved aside - Electron Forge reached Vite bundle prep and launched the Electron app without any missing icon/resource failure, then hit a pre-existing unrelated `TypeError: Invalid URL` during app load.
