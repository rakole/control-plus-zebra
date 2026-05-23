# Stack Research

**Domain:** Local-first Electron desktop observability app for coding-agent harness sessions
**Researched:** 2026-05-23
**Confidence:** HIGH for core stack and security posture, MEDIUM for supporting library choices until implementation proves performance on real session fixtures

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Electron | 42.2.0 | macOS desktop shell, main process, preload bridge, renderer host | Current stable Electron release, with Chromium 148 and Node.js 24.15.0. Keeps desktop shell, filesystem access, safe IPC, and packaging in one ecosystem. |
| Electron Forge | 7.11.2 | App scaffolding, development, packaging, makers | Official Electron build tooling with a Vite + TypeScript template. Use it rather than hand-rolling packaging. |
| Vite | 8.0.14 | Fast renderer/dev bundling | Standard fast dev server/build tool for React + TypeScript. Works well with Electron Forge's Vite plugin. |
| React | 19.2.6 | Renderer UI | Current React docs track React 19.2. Good fit for rich dashboards, timeline views, filters, and detail panes. |
| TypeScript | 6.0.3 | Shared type contracts across main, preload, renderer, adapters, tests | Required for the adapter contract and normalized model. TS 6 is a transition release toward TS 7, so keep config explicit and avoid deprecated options. |
| Zod | 4.4.3 | Runtime schema validation for normalized fragments, IPC payloads, config, and fixtures | The app handles untrusted/corrupt local artifacts. Runtime validation prevents adapter output from silently poisoning shared stores and UI assumptions. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vitejs/plugin-react | 6.0.2 | React plugin for Vite | Renderer build setup. |
| React Router | 7.15.1 | Client-side navigation | Use declarative/library mode for Overview, Projects, Sessions, Session Detail, Run Audit, Settings, and Diagnostics pages. Avoid framework/server features in this local app. |
| Chokidar | 5.0.0 | File watching | Use in the shared watcher orchestrator after adapter watch plans are defined. Do not let adapters create arbitrary watchers directly. |
| fast-glob | 3.3.3 | Initial artifact discovery helpers | Useful for bounded, allowlisted scans under configured source roots. Keep globbing in shared scanner or adapter discovery, not renderer. |
| Vitest | 4.1.7 | Unit and contract tests | Use for core model tests, adapter contract tests, shell parser tests, and import-boundary tests. |
| @testing-library/react | 16.3.2 | Component tests | Use for capability-gated view components and interaction flows. |
| Playwright | 1.60.0 | End-to-end and Electron smoke tests | Playwright has experimental Electron automation. Use for smoke checks, not as the only correctness layer. |
| ESLint | 10.4.0 | Linting and import rules | Use for boundary rules: core/renderer must not import adapter-private files. |
| oxlint | 1.66.0 | Fast lint supplement | Optional speed layer once ESLint rules are stable. Do not replace custom import-boundary checks until proven equivalent. |
| Prettier | 3.8.3 | Formatting | Keep generated code and docs consistent. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| npm | Package manager | The repo currently has no package manager files. Start simple with npm unless a later repo decision chooses pnpm. |
| Electron security defaults | Renderer hardening | Keep `nodeIntegration` off, `contextIsolation` on, sandboxing on, restrictive CSP, and a narrow preload bridge. |
| Vitest golden fixtures | Adapter correctness | Every adapter fixture should normalize to golden JSON without adapter-private raw objects except source pointers and diagnostics. |
| Import-boundary checks | Architecture enforcement | Enforce dependency direction from day one; do not rely on review discipline alone. |

## Installation

```bash
# Suggested starting scaffold
npm create electron-app@latest . -- --template=vite-typescript

# Core runtime dependencies after scaffold review
npm install react react-dom react-router zod chokidar fast-glob

# Dev dependencies
npm install -D electron @electron-forge/cli @electron-forge/plugin-vite vite @vitejs/plugin-react typescript vitest @vitest/coverage-v8 @testing-library/react playwright eslint prettier
```

Adjust the exact scaffold command once the implementation phase confirms whether the empty repo can safely be scaffolded in place or should be generated into a temporary directory and copied across.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Electron Forge + Vite | electron-vite | electron-vite is attractive for dedicated Electron/Vite apps, but Electron Forge is the official Electron build tool. Prefer Forge unless the implementation spike finds a blocking issue. |
| File-backed cache first | SQLite/better-sqlite3 immediately | SQLite is a good future store, but native-module rebuild/packaging can distract from Phase 0/1 contract proof. Start with file-backed normalized cache, design cache boundaries so SQLite can replace it later. |
| React Router library/declarative mode | React Router framework mode | Framework mode is overkill for local Electron pages and can blur app/server concerns. |
| Zod schemas | TypeScript-only types | Static types do not validate corrupt JSONL, sidecars, source config, IPC payloads, or adapter output at runtime. |
| Vitest contract tests | Only Playwright end-to-end tests | E2E catches integration failures late. Adapter and audit correctness need fast deterministic contract tests. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Shared `Gemini*` types | Leaks first-adapter assumptions into core and renderer | `Harness*`, `Session*`, `SessionEvent`, `RawHarnessEvent`, `ToolCall`, `OutputArtifact` |
| Renderer imports from `src/main/adapters/*` | Couples UI to provider internals and blocks future harnesses | IPC view models plus adapter metadata/capabilities |
| Adapter-owned verification conclusions | Different adapters would classify runs differently | Adapter emits evidence; shared core classifies |
| Arbitrary shell execution | Violates V1 read-only safety and privacy model | Fixed read-only git/gh provider commands only |
| Native database dependency in Phase 0 | Packaging/rebuild risk before architecture is proven | File-backed cache abstraction first |

## Stack Patterns by Variant

**If implementing Phase 0/1 contract proof:**
- Use in-memory stores plus golden JSON fixtures.
- Because the first proof is adapter neutrality, not storage throughput.

**If implementing file watching:**
- Use adapter-provided `WatchPlan` objects consumed by a shared watcher orchestrator.
- Because adapters know raw artifact layouts, but the shared core must own watcher lifecycle and security allowlists.

**If implementing larger cache/search later:**
- Keep cache interfaces storage-agnostic and include `adapterId`, `sourceId`, artifact identity, mtime, size, adapter version, and schema version in keys.
- Because cross-adapter collisions are a central failure mode.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Electron 42.2.0 | Node.js 24.15.0, Chromium 148 | Electron bundles these versions; choose dev tooling that supports modern ESM and Node 24. |
| React 19.2.6 | React DOM 19.2.6, @testing-library/react 16.3.2 | Keep React and React DOM versions matched. |
| TypeScript 6.0.3 | Vite 8.0.14, React 19 types | Keep `module`, `moduleResolution`, `target`, and deprecation settings explicit because TS 6 changed defaults and prepares for TS 7. |
| Playwright 1.60.0 | Electron testing | Electron support is experimental; use it for smoke coverage, not sole verification. |

## Sources

- https://releases.electronjs.org/release/v42.2.0 - Electron 42.2.0 release, Chromium/Node/V8 versions.
- https://www.electronforge.io/templates/vite-+-typescript - Electron Forge Vite + TypeScript template guidance.
- https://www.electronjs.org/docs/latest/tutorial/security - Electron security checklist and V1 safety posture.
- https://www.electronjs.org/docs/latest/tutorial/context-isolation - contextBridge and preload guidance.
- https://www.electronjs.org/docs/latest/tutorial/ipc - IPC patterns and process boundary.
- https://vite.dev/guide/ - Vite React/TypeScript project support.
- https://react.dev/versions - React latest major/minor documentation.
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html - TypeScript 6 defaults and migration notes.
- https://vitest.dev/guide/ - Vitest test runner guidance.
- https://playwright.dev/docs/api/class-electron - Playwright Electron automation caveat.
- https://zod.dev/packages/zod - Zod package purpose.
- npm registry queried with `npm view` on 2026-05-23 for exact package versions.

---
*Stack research for: Agent Workbench*
*Researched: 2026-05-23*
