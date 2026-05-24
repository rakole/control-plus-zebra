# Agent Workbench

Agent Workbench is a local-first Electron desktop app for observing and auditing local coding-agent sessions across harnesses. The shared core stays harness-neutral: `gemini-cli` is the first real adapter, `fake-test` proves the second-adapter path, and imported archives stay read-only without becoming normal bundled harnesses.

## Verification

Run these commands before trusting broad changes:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:boundaries`
- `npm run test:renderer`

## Harness-neutrality rule

Shared code must stay harness-neutral. Do not introduce shared `Gemini*` names, provider-specific branching in shared core or renderer-facing surfaces, or adapter-facing contract fields that claim final verification or run-audit conclusions.
