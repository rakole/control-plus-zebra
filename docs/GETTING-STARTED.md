<!-- generated-by: gsd-doc-writer -->
# Getting Started

## Prerequisites

- Git for cloning the repository.
- A working Node.js and npm installation. The repository does not pin a version through `package.json` `engines`, `.nvmrc`, or `.node-version`.
- macOS if you want to use the currently configured packaged target. `forge.config.ts` only configures `@electron-forge/maker-zip` for `darwin`.

## Installation steps

1. Clone the repository.
   ```bash
   git clone https://github.com/rakole/control-plus-zebra.git
   ```
2. Change into the project directory.
   ```bash
   cd control-plus-zebra
   ```
3. Install dependencies.
   ```bash
   npm install
   ```

## First run

Start the desktop app with Electron Forge:

```bash
npm start
```

That command launches the Electron main process from `src/main/electron-main.ts`, builds the preload bundle from `src/preload/index.ts`, and serves the React renderer configured by `vite.renderer.config.ts`.

On first launch, the app routes to `#/overview`. To load real data:

1. Open **Data Sources**.
2. Add a `fake-test` or `gemini-cli` source root and validate it.
3. Scan the source to populate Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics.
4. Optionally import a previously exported `.awb-archive.json` file through the archive import action instead of adding a live source.

If you want a packaged desktop build instead of the dev shell, run:

```bash
npm run package
```

## Common setup issues

### Source scans blocked

If a scan fails immediately, check the source state first. `src/main/app/data-sources-view-model-service.ts` refuses scans for disabled sources, invalid sources, and imported archives, so the normal flow is validate first, then scan.

### Renderer boundary violations

If `npm run lint` or `npm run test` fails after renderer changes, inspect `src/renderer/` imports first. The project rejects direct use of `electron`, `ipcRenderer`, `fs`, `child_process`, `process.env`, `process.cwd()`, `eval`, `window.require`, and `require()` in renderer files via `eslint.config.mjs` and `tests/security/renderer-forbidden-apis.test.ts`.

### Boundary or naming regressions

If `npm run test:boundaries` fails, check for shared code importing adapter-private modules or for shared/renderer code introducing Gemini-specific identifiers. The repository enforces those guardrails in `tests/boundaries/` and the restricted syntax rules in `eslint.config.mjs`.

### Golden snapshot refreshes

If an adapter golden test fails because a normalized fixture intentionally changed, rerun the specific test with `UPDATE_GOLDENS=1` before re-running the suite. Both `tests/adapters/fake-test/fake-adapter.golden.test.ts` and `tests/adapters/gemini-cli/gemini-adapter.golden.test.ts` support that refresh path.

## Next steps

- Read [Architecture](./ARCHITECTURE.md) for the main-process, preload, renderer, and adapter boundaries.
- Read [Development](./DEVELOPMENT.md) for local workflow expectations, script reference, and boundary rules.
- Read [Testing](./TESTING.md) before adding or refactoring coverage.
- Read [Configuration](./CONFIGURATION.md) for runtime defaults, checked-in config files, and app data paths.
