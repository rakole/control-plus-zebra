<!-- generated-by: gsd-doc-writer -->
# Configuration

## Environment variables

The application runtime does not currently read configuration from environment files. The only tracked environment variable reference in the repository is a test helper for refreshing golden fixtures.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UPDATE_GOLDENS` | Optional | unset | When set to `1`, `tests/adapters/fake-test/fake-adapter.golden.test.ts` rewrites `tests/fixtures/fake-test/phase1-session.normalized.json` with the latest normalized snapshot. |

## Config file format

Agent Workbench is configured primarily through checked-in TypeScript and JSON files rather than runtime `.env` files.

| File | Format | Purpose |
|------|--------|---------|
| `package.json` | JSON | Declares scripts, dependencies, Electron entrypoint, and package metadata. |
| `forge.config.ts` | TypeScript | Configures Electron Forge packaging and the Vite plugin build targets. |
| `vite.main.config.ts` | TypeScript | Builds the Electron main process bundle. |
| `vite.preload.config.ts` | TypeScript | Builds the preload bundle. |
| `vite.renderer.config.ts` | TypeScript | Configures the React renderer build and Tailwind plugin. |
| `eslint.config.mjs` | JavaScript module | Enforces renderer, core, and adapter-boundary restrictions. |
| `vitest.config.ts` | TypeScript | Splits tests into `node` and `renderer` projects. |
| `tsconfig.json` | JSON | Enables strict TypeScript compilation and the `@/*` renderer path alias. |
| `components.json` | JSON | Stores `shadcn` UI generation settings for the renderer layer. |

Minimal checked-in JSON configuration example:

```json
{
  "style": "radix-mira",
  "tailwind": {
    "css": "src/renderer/styles.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "iconLibrary": "lucide"
}
```

## Required vs optional settings

- No runtime environment variables are required for `npm start`, `npm run lint`, `npm run typecheck`, or the default test commands.
- Source registration settings are required only when you add a data source through the UI or the view-model services. `src/main/core/registry/source-registry.ts` requires adapter and root path values when creating a source record.
- Scan operations require an enabled and already validated source. `src/main/app/data-sources-view-model-service.ts` throws if a source is disabled or still invalid when `scanDataSource` is requested.
- The `UPDATE_GOLDENS` flag is optional and affects only the fake adapter golden test.

## Defaults

| Setting | Default | Defined in |
|---------|---------|------------|
| `WorkbenchRuntimeOptions.projectDir` | `process.cwd()` | `src/main/app/workbench-runtime.ts` |
| `WorkbenchRuntimeOptions.appDataDir` | `path.join(projectDir, ".agent-workbench")` | `src/main/app/workbench-runtime.ts` |
| New source `enabled` flag | `true` | `src/main/core/registry/source-registry.ts` |
| Renderer window size | `1180x760`, minimum `800x680` | `src/main/window.ts` |
| Main-process Vite target | `node24` | `vite.main.config.ts` |
| Preload and renderer Vite target | `chrome148` | `vite.preload.config.ts`, `vite.renderer.config.ts` |

## Per-environment overrides

- No `.env.development`, `.env.production`, or `.env.test` files are checked in.
- `src/main/security/content-security-policy.ts` switches between development and production Content Security Policy modes based on whether Electron was launched with `MAIN_WINDOW_VITE_DEV_SERVER_URL`.
- Packaging behavior is defined in `forge.config.ts`; the current maker list only includes `@electron-forge/maker-zip` for `darwin`.
- UI generation preferences live in `components.json`, so renderer scaffolding stays reproducible without environment-specific overrides.
