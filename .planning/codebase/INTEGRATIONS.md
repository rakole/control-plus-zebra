---
last_mapped_commit: 0440aff34cc6fd23624ebf75d2f812f0c6cc8109
---

# External Integrations

**Analysis Date:** 2026-05-23

## APIs & External Services

**Harness Adapters:**
- Fake Test Harness - Local fixture-backed adapter used to prove harness-neutral contracts.
  - SDK/Client: Not applicable; implementation is local TypeScript in `src/main/adapters/fake-test/index.ts`.
  - Auth: Not applicable; no auth or token environment variables are used by `src/main/adapters/fake-test/**`.
  - Source discovery: validates a single local JSON fixture file through `stat` in `src/main/adapters/fake-test/discovery.ts`.
  - Artifact parsing: reads and parses local JSON through `readFile`, `JSON.parse`, and `zod` validation in `src/main/adapters/fake-test/parse.ts` and `src/main/adapters/fake-test/types.ts`.

**Network APIs:**
- Not detected in `src/**`, `tests/**`, `package.json`, `eslint.config.mjs`, or `vitest.config.ts`.
- No `fetch`, HTTP client package, WebSocket client, REST SDK, GraphQL client, or webhook server dependency is present in `package.json`.

**Git / GitHub Evidence:**
- Git and GitHub are modeled as capability states but not integrated in Phase 1 code.
  - Capability fields: `gitContextCapture` and `githubContextCapture` are defined in `src/main/core/model/capabilities.ts`.
  - Fake adapter reports both capabilities as unsupported in `src/main/adapters/fake-test/descriptor.ts`.
  - Fixture data also marks Git and GitHub evidence unsupported in `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
  - No `git`, `gh`, `child_process`, `execFile`, or `spawn` runtime integration is detected in `src/**` or `tests/**`.

## Data Storage

**Databases:**
- Not detected.
  - Connection: Not applicable; no database URL or connection config is detected in `src/**`, `tests/**`, or `package.json`.
  - Client: Not applicable; no SQLite, PostgreSQL, MySQL, Redis, Prisma, Drizzle, or ORM package is present in `package.json`.

**File Storage:**
- Local filesystem only.
  - Fixture input: `src/main/adapters/fake-test/fixtures/phase1-session.fixture.json`.
  - Golden snapshot output fixture: `tests/fixtures/fake-test/phase1-session.normalized.json`.
  - Adapter file reads: `src/main/adapters/fake-test/discovery.ts` and `src/main/adapters/fake-test/parse.ts`.
  - Test-only golden rewrite path: `tests/adapters/fake-test/fake-adapter.golden.test.ts` writes `tests/fixtures/fake-test/phase1-session.normalized.json` only when `UPDATE_GOLDENS=1`.

**Caching:**
- None detected.
- `.gitignore` reserves `.data/` and `.cache-loader/` for local development data, but no cache implementation exists in `src/**`.

## Authentication & Identity

**Auth Provider:**
- Not detected.
  - Implementation: No login, OAuth, session token, API key, credential store, or identity provider usage is present in `src/**`, `tests/**`, or `package.json`.
  - Environment: No required auth environment variables are detected; `.gitignore` excludes common `.env*` files.

## Monitoring & Observability

**Error Tracking:**
- None detected.
- No Sentry, OpenTelemetry, Datadog, Logtail, Honeycomb, or equivalent package is present in `package.json`.

**Logs:**
- No logging framework is installed in `package.json`.
- Adapter and contract behavior emits structured diagnostics rather than logs through `src/main/core/diagnostics/diagnostic.ts`, `src/main/adapters/fake-test/parse.ts`, and `src/main/adapters/fake-test/normalize.ts`.

## CI/CD & Deployment

**Hosting:**
- Not detected.
- No Electron packaging configuration, app distribution target, server hosting config, Dockerfile, or deployment manifest is present in repo-root config files or `src/**`.

**CI Pipeline:**
- Not detected in the scanned repo files.
- Validation commands are local npm scripts in `package.json`: `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:boundaries`.

## Environment Configuration

**Required env vars:**
- None detected for application runtime in `src/**` or `package.json`.
- Optional test maintenance variable: `UPDATE_GOLDENS=1` in `tests/adapters/fake-test/fake-adapter.golden.test.ts`.

**Secrets location:**
- No secret files are present at repo root.
- `.gitignore` excludes `.env`, `.env.local`, `.env.development.local`, `.env.test.local`, and `.env.production.local`.
- No checked-in credential, certificate, package-token, or service-account file is detected in the scanned repo file inventory.

## Webhooks & Callbacks

**Incoming:**
- None detected.
- No HTTP server, Electron IPC entrypoint, route handler, webhook handler, or callback endpoint exists in `src/**`.

**Outgoing:**
- None detected.
- No outbound HTTP, WebSocket, GitHub API, cloud API, email, analytics, telemetry, or payment callback code exists in `src/**`.

---

*Integration audit: 2026-05-23*
