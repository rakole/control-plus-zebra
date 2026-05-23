# Agent Workbench

Agent Workbench is currently in Phase 1: architecture contracts and fixture proof. This repo is intentionally proving the harness-neutral shared core before any Electron shell or UI depth lands, so the fake adapter and future Gemini adapter both have to fit the same shared contract.

## Phase 1 verification

Run these commands before trusting changes in this milestone:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:boundaries`

## Harness-neutrality rule

Shared code must stay harness-neutral. Do not introduce shared `Gemini*` names, provider-specific branching in shared core or renderer-facing surfaces, or adapter-facing contract fields that claim final verification or run-audit conclusions.
