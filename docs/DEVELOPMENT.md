<!-- generated-by: gsd-doc-writer -->
# Development

## Local setup

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/rakole/control-plus-zebra.git
   cd control-plus-zebra
   npm install
   ```
2. Start the app locally when you need the Electron shell:
   ```bash
   npm start
   ```
3. Use the verification commands from the hand-written root `README.md` before trusting changes:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run test:boundaries
   ```

No `.env.example` or bootstrap script is checked in today, so local setup is limited to dependency installation and the normal verification loop.

## Build commands

| Command | Description |
|---------|-------------|
| `npm start` | Launches the Electron Forge development workflow. |
| `npm run lint` | Runs ESLint across the repository. |
| `npm run typecheck` | Runs `tsc --noEmit` with the root `tsconfig.json`. |
| `npm run test` | Runs the Vitest `node` and `renderer` projects declared in `vitest.config.ts`. |
| `npm run test:boundaries` | Runs the boundary-focused Vitest project for architecture and import guardrails. |
| `npm run test:renderer` | Runs only the renderer-targeted Vitest project and tolerates no-test cases. |
| `npm run package` | Builds a packaged application with Electron Forge. |
| `npm run make` | Produces distributable artifacts using the configured Forge makers. |

## Code style

- ESLint is the primary policy layer, configured in `eslint.config.mjs`. Run it with `npm run lint`.
- TypeScript strictness lives in `tsconfig.json`, including `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`. Run it with `npm run typecheck`.
- The renderer uses the `@/*` alias defined in `tsconfig.json` and `vite.renderer.config.ts`; shared code should continue to use explicit relative imports.
- Renderer code must stay behind the typed preload bridge and may not import `electron`, `fs`, `child_process`, or adapter-private modules directly. Those rules are enforced in both `eslint.config.mjs` and `tests/security/renderer-forbidden-apis.test.ts`.

## Branch conventions

No branch naming convention is documented in the repository. There is also no checked-in pull request template or contribution guide yet, so branch names and branch lifecycle are currently team convention rather than repo-enforced policy.

## PR process

- Keep shared terminology harness-neutral. `AGENTS.md` explicitly calls for names like `Harness`, `Session`, `SessionEvent`, `ToolCall`, `OutputArtifact`, and `ShellCommandEvidence`.
- Keep adapter-private logic under `src/main/adapters/`; do not leak adapter details into `src/main/core/` or `src/renderer/`.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:boundaries` before opening a pull request.
- Call out any security-sensitive changes that affect `src/preload/`, `src/main/ipc/`, `src/main/security/`, or `src/main/core/security/`, because those areas enforce the read-only desktop boundary.
- If a change alters normalized fixtures, mention whether `tests/fixtures/fake-test/phase1-session.normalized.json` was intentionally refreshed.
