<!-- generated-by: gsd-doc-writer -->
# Getting Started

## Prerequisites

- Git for cloning the repository.
- A working Node.js and npm installation. This repository does not pin a version through `package.json` `engines`, `.nvmrc`, or `.node-version`.
- macOS if you want to run the Electron app exactly as the project is currently packaged. `forge.config.ts` only configures `@electron-forge/maker-zip` for `darwin`.

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

That command launches the Electron main process defined in `src/main/electron-main.ts`, builds the preload bundle from `src/preload/index.ts`, and serves the React renderer configured by `vite.renderer.config.ts`.

## Common setup issues

### Renderer boundary violations

If `npm run lint` or `npm run test` fails after renderer changes, inspect `src/renderer/` imports first. The project rejects direct use of `electron`, `ipcRenderer`, `fs`, `child_process`, `process.env`, `process.cwd()`, `eval`, `window.require`, and `require()` in renderer files via `eslint.config.mjs` and `tests/security/renderer-forbidden-apis.test.ts`.

### Boundary or naming regressions

If `npm run test:boundaries` fails, check for shared code importing adapter-private modules or for shared/renderer code introducing Gemini-specific identifiers. The repository enforces those guardrails in `tests/boundaries/` and the restricted syntax rules in `eslint.config.mjs`.

### Golden snapshot refreshes

If the fake adapter golden test fails because a normalized fixture intentionally changed, rerun the specific test with `UPDATE_GOLDENS=1` before re-running the suite so `tests/fixtures/fake-test/phase1-session.normalized.json` is updated from `tests/adapters/fake-test/fake-adapter.golden.test.ts`.

## Next steps

- Read [Architecture](./ARCHITECTURE.md) for the main-process, preload, renderer, and adapter boundaries.
- Read [Development](./DEVELOPMENT.md) for local workflow expectations and script reference.
- Read [Testing](./TESTING.md) before adding or refactoring coverage.
- Read [Configuration](./CONFIGURATION.md) for runtime defaults and checked-in config files.
