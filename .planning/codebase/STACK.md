---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---

# Technology Stack

**Analysis Date:** 2026-05-23

## Languages

**Primary:**
- TypeScript 6.0.3 - All application and test implementation lives under `src/**/*.ts` and `tests/**/*.ts`; configured by `tsconfig.json`.

**Secondary:**
- JSON - Fixture and normalized golden data live in `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json` and `tests/fixtures/fake-test/phase1-session.normalized.json`.
- JavaScript ESM config - ESLint configuration is in `eslint.config.mjs`.

## Runtime

**Environment:**
- Node.js - Current local runtime observed as `v26.0.0`; package metadata is ESM via `"type": "module"` in `package.json`.
- TypeScript target is `ES2024` with `module` and `moduleResolution` set to `NodeNext` in `tsconfig.json`.
- No `engines.node`, `.nvmrc`, or `.node-version` file is present; transitive tool dependencies in `package-lock.json` include packages requiring Node `^20.19.0 || ^22.13.0 || >=24`.

**Package Manager:**
- npm - Current local npm observed as `11.12.1`.
- Lockfile: present at `package-lock.json` with `lockfileVersion: 3`.

## Frameworks

**Core:**
- No UI/runtime app framework is installed in `package.json`.
- The implemented runtime surface is a Node-compatible TypeScript core in `src/main/core/**` plus adapter code in `src/main/adapters/fake-test/**`.
- Electron, Electron Forge, Vite, React, and Playwright are not present in `package.json` or `package-lock.json`.

**Testing:**
- Vitest 4.1.7 - Unit, contract, parser, boundary, and adapter tests run from `tests/**/*.test.ts`; configured by `vitest.config.ts`.

**Build/Dev:**
- TypeScript 6.0.3 - `npm run typecheck` runs `tsc --noEmit` from `package.json`.
- ESLint 10.4.0 with `typescript-eslint` 8.59.4 - `npm run lint` runs `eslint .`; repo-specific boundaries are encoded in `eslint.config.mjs`.
- No bundler, packager, or production build command is configured in `package.json`.

## Key Dependencies

**Critical:**
- `zod` 4.4.3 - Runtime validation for fake adapter fixture capabilities/events/artifacts in `src/main/adapters/fake-test/types.ts`.

**Infrastructure:**
- `@types/node` 25.9.1 - Node type declarations used by core, adapter, and tests via `types: ["node", "vitest/globals"]` in `tsconfig.json`.
- `typescript` 6.0.3 - Strict typechecking with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `isolatedModules`, and `verbatimModuleSyntax` in `tsconfig.json`.
- `eslint` 10.4.0 - Static analysis entrypoint configured in `eslint.config.mjs`.
- `typescript-eslint` 8.59.4 - TypeScript parser/config support for ESLint rules in `eslint.config.mjs`.
- `vitest` 4.1.7 - Test runner used by `tests/contract/run-adapter-contract.ts`, `tests/adapters/fake-test/*.test.ts`, and `tests/boundaries/*.test.ts`.

## Configuration

**Environment:**
- No required application environment variables are detected in `src/**`, `tests/**`, `package.json`, `eslint.config.mjs`, or `vitest.config.ts`.
- Optional test maintenance flag: `UPDATE_GOLDENS=1` allows `tests/adapters/fake-test/fake-adapter.golden.test.ts` to rewrite `tests/fixtures/fake-test/phase1-session.normalized.json`.
- No `.env*` files are present at repo root; `.gitignore` excludes `.env`, `.env.local`, `.env.development.local`, `.env.test.local`, and `.env.production.local`.

**Build:**
- `package.json` defines `lint`, `typecheck`, `test`, and `test:boundaries`.
- `tsconfig.json` defines strict NodeNext TypeScript compilation for `src/**/*`, `tests/**/*`, and `vitest.config.ts`.
- `vitest.config.ts` sets the test environment to `node` and includes `tests/**/*.test.ts`.
- `eslint.config.mjs` enforces harness-neutral boundaries for `src/main/core/**/*.ts`, `src/renderer/**/*.ts`, and adapter-contract files.
- `.gitignore` excludes dependency folders, environment files, logs, build outputs, Electron package artifacts, Playwright output, coverage, temp files, and local app data directories.

## Platform Requirements

**Development:**
- Install dependencies with `npm install` or `npm ci` using `package-lock.json`.
- Run validation with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:boundaries` from `package.json`.
- Current code is Node-only TypeScript and reads local fixture files through `node:fs/promises` in `src/main/adapters/fake-test/discovery.ts` and `src/main/adapters/fake-test/parse.ts`.

**Production:**
- Deployment target is not detected; there is no packaged app, Electron entrypoint, server entrypoint, production build script, or hosting configuration in `package.json`, `src/**`, or repo-root config files.

---

*Stack analysis: 2026-05-23*
