# Phase 6: Harness-Neutral Triage UI - Research

**Researched:** 2026-05-24 [VERIFIED: codebase grep]
**Domain:** Electron renderer triage surfaces over main-process-owned normalized session, verification, audit, and diagnostics view models. [VERIFIED: codebase grep]
**Confidence:** HIGH [VERIFIED: codebase grep]

> Historical note (post-migration): this research artifact reflects the Phase 6 repo snapshot gathered on 2026-05-24, before the later feature-first renderer migration. References below to `src/renderer/components/AppShell.tsx`, flat route files, or the then-current shell/route structure are preserved as phase research context, not as statements about the current repo layout.

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied verbatim from `.planning/phases/06-harness-neutral-triage-ui/06-CONTEXT.md`. [VERIFIED: codebase grep]

### Locked Decisions
- **D-01:** Once Phase 6 routes exist, `Overview` should become the default landing page instead of keeping `Sessions` as the home route.
- **D-02:** The left navigation should promote `Overview`, `Projects`, `Sessions`, and `Diagnostics` to real routes while keeping `Data Sources` available as the configuration/setup surface.
- **D-03:** Overview should be an attention-first triage dashboard: totals, recent/active activity, failed verification, cancelled runs, needs-attention counts, tool activity, activity-over-time, and harness filters, with links outward to Projects and Sessions instead of deep inline detail.
- **D-04:** Empty or early-stage installs should still route truthfully: when no scanned session data exists, Overview may point users back to Data Sources, but Data Sources should not remain the permanent default once triage data is present.

- **D-05:** Phase 6 should ship a real Projects page now, driven by normalized project/session/audit rollups, instead of deferring the whole page until Phase 7.
- **D-06:** Project-level git and GitHub fields required by the product contract (`branch`, `HEAD`, `dirty state`, changed/untracked files, PR state) must render as explicit `Unknown` or `Unsupported` placeholders until the shared git/GitHub providers land in Phase 7; the UI must not infer or invent them from session evidence.
- **D-07:** Project summaries should group all observed harnesses under the shared project identity and use shared audit/verification truth for the latest triage signal, rather than privileging any single adapter.
- **D-08:** The first Projects slice should prioritize session count, observed harnesses, latest activity, latest verification/audit truth, and repo path visibility; deeper repo-state inspection stays a later-phase concern.

- **D-09:** Keep `Sessions` as the fast triage surface, evolving the current list/detail pattern into a denser summary view rather than turning it into the full evidence browser.
- **D-10:** Add a separate `Session Detail` route for the chronological mixed timeline of normalized evidence, with the current preview card treated as the lightweight precursor rather than the final detail experience.
- **D-11:** Add a dedicated `Run Audit` route or subview for sectioned claim-vs-evidence review; audit evidence should not be buried inside the general chronological timeline.
- **D-12:** Sessions rows/cards should surface the shared-core truth that matters for triage first: audit status, verification status, lifecycle, project, harness, capability warnings, command/file/tool counts, and failed-command signal when supported.
- **D-13:** Session Detail should use progressive disclosure: lead with harness badge, project, IDs, lifecycle, verification/audit summaries, and attention reasons, then show a mixed timeline of messages, lifecycle events, tool calls, shell commands, file mutations, output artifacts, and unknown/raw evidence markers.
- **D-14:** Run Audit should group evidence by product-facing questions (`claim vs evidence`, `verification`, `files changed`, `commands`, `cancellation/incompletion`, `git/GitHub`, `capability gaps`, `parser diagnostics`) instead of replaying one long event feed.

- **D-15:** Diagnostics should read like an operator console for trust and ingestion issues: grouped, actionable, and scan-friendly first, with raw diagnostic codes/messages still visible inside each group.
- **D-16:** Capability warnings, unsupported states, and unknown states must reuse one shared vocabulary across Overview, Projects, Sessions, Session Detail, Run Audit, and Diagnostics so the same evidence gap never looks clean in one surface and broken in another.
- **D-17:** Diagnostics groups should reflect the real source areas already present in the system (`adapter`, `source`, `normalization`, `cache`) and extend naturally to parser/capability-oriented views without inventing a separate provider-specific taxonomy.
- **D-18:** Diagnostics and warning surfaces must stay sanitized renderer DTOs: enough detail to explain truth and uncertainty, but no raw filesystem dumps, unsafe command output leakage, or adapter-private object exposure.

### the agent's Discretion
- Exact route naming and nesting for `Overview`, `Projects`, `Session Detail`, and `Run Audit`, as long as Overview becomes the triage entrypoint and Run Audit remains a distinct evidence view.
- Exact card/table composition and visual density, as long as triage signals stay scan-first and capability gaps remain explicit.
- Exact aggregation helpers and view-model service boundaries needed to expose project rollups, session detail, audit sections, and diagnostics groups through typed IPC.
- Exact chart and activity-summary implementation choices for Overview, as long as they stay read-only, harness-neutral, and truthful when capabilities are missing.

### Deferred Ideas (OUT OF SCOPE)
- Saved cross-page filters, search, and custom triage presets can wait until the first complete triage surfaces exist.
- Real git/GitHub branch, dirty-state, and PR data remain Phase 7 work.
- Token-usage charts or model-cost reporting should stay gated behind real capability support and later product scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | User can view an Overview page with total projects, total sessions, active/recent sessions, failed verification, cancelled sessions, needs-attention sessions, tool activity, activity over time, and harness filters. | Build Overview from main-process rollups over `cacheStore.listLatestRecords()` plus `record.derived.sessions`, not from renderer-side recomputation. [VERIFIED: codebase grep] |
| UI-02 | User can view a Projects page with project name, repo path, observed harnesses, latest activity, branch, HEAD SHA, dirty state, changed/untracked files, session count, and latest verification state when supported. | Project rollups should come from normalized `projects` plus session/audit joins; Phase 7 git fields stay explicit placeholders. [VERIFIED: codebase grep] |
| UI-03 | User can view a Sessions page with status, harness, project, branch, session ID, native session ID, first prompt, assistant/model, timestamps, token count if supported, tool count, file mutation count, command count, failed command count, and capability warnings. | Extend the current `SessionsRoute` list/detail seam and `SessionSummaryViewModel` shape instead of replacing the route pattern. [VERIFIED: codebase grep] |
| UI-04 | User can view a Session Detail page with harness badge, project, session IDs, lifecycle status, attention reasons, capability warnings, and a timeline of messages, lifecycle events, tool calls, file events, shell commands, output artifacts, and unknown raw events. | Drive a new detail route from normalized events and related entity collections already persisted in cache records. [VERIFIED: codebase grep] |
| UI-05 | User can view Run Audit evidence grouped by claim vs evidence, verification, files changed, commands, cancellation/incompletion, git/GitHub state, capability gaps, and parser diagnostics. | Reuse scan-time `verification` and `audit` derivations from cache, then expose grouped supporting IDs through sanitized DTOs. [VERIFIED: codebase grep] |
| UI-07 | User can view parser, source, adapter, cache, and capability diagnostics from a Diagnostics page. | Reuse existing diagnostic `sourceArea` vocabulary and sanitize before crossing IPC. [VERIFIED: codebase grep] |
| UI-08 | UI behavior is driven by adapter metadata and capabilities, with no provider-specific branches except display labels and capability metadata. | Keep all routing and rendering adapter-neutral; current boundary tests already reject shared provider-ID branches and adapter-private imports. [VERIFIED: codebase grep] |
| UI-09 | Unsupported capability states render as unsupported or unknown instead of zero values. | Use explicit DTO state labels or unions for every derived metric whose evidence may be missing or unsupported. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets] |
| TEST-07 | UI tests prove capability gates render unsupported/unknown states and do not show missing evidence as zero. | Extend the existing renderer/jsdom test style plus node-side IPC service tests; keep focused commands per route and service. [VERIFIED: codebase grep] [CITED: https://vitest.dev/guide/projects] |

Requirement descriptions copied from `.planning/REQUIREMENTS.md`. [VERIFIED: codebase grep]
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Shared naming must stay harness-neutral; do not add shared `Gemini*` types or shared provider-specific branches. [VERIFIED: codebase grep]
- Every normalized entity from harness data must keep `adapterId` and, where relevant, `sourceId`. [VERIFIED: codebase grep]
- Adapters emit evidence and diagnostics only; final verification state, run-audit classification, and attention reasons stay in shared core or main-owned view models. [VERIFIED: codebase grep]
- Missing or unsupported capabilities must remain explicit states, never zero values, implicit passes, or silent omissions. [VERIFIED: codebase grep]
- `src/renderer/**` may consume IPC view models only and must not import adapter-private or main-process internals. [VERIFIED: codebase grep]
- Renderer security boundaries stay intact: no Node integration, no broad Electron APIs, no arbitrary file reads, and no shell execution. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/security]
- Preload stays a narrow typed bridge with one method per allowed IPC operation; do not expose raw `ipcRenderer` helpers. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation]
- Fixed read-only git and optional `gh` commands are V1-only allowances; Phase 6 must not invent mutation controls. [VERIFIED: codebase grep]

## Summary

Phase 6 is not primarily a renderer build. The hard seam is that Phase 5 already derives truthful shell, verification, and run-audit results during scanning and persists them under `record.derived.sessions`, but the public IPC layer still only exposes sanitized session summaries and previews. The planner should therefore make main-process DTO expansion the first dependency, then add preload methods and renderer routes on top of that stable contract. [VERIFIED: codebase grep]

The current shell already provides the exact route-activation seam the phase needs: `src/renderer/App.tsx` only routes `/data-sources` and `/sessions`, while `src/renderer/components/AppShell.tsx` still renders `Overview`, `Projects`, and `Diagnostics` as disabled placeholders. The existing `SessionsRoute`, `SessionList`, and `SessionPreview` components prove the read-only interaction style, keyboard behavior, loading/error handling, and explicit capability-warning language that the new surfaces should reuse instead of replacing. [VERIFIED: codebase grep]

The planning shape is clean and matches the roadmap slices: `06-01` should add main-owned triage rollups plus route activation for Overview/Projects/Sessions; `06-02` should add the Session Detail timeline DTO and route; `06-03` should add grouped Run Audit DTOs and the dedicated evidence route; `06-04` should add diagnostics grouping plus shared capability-warning primitives; `06-05` should lock the phase with renderer and IPC tests that prove unsupported and unknown states never collapse into `0`, `Passed`, or `Clean`. [VERIFIED: codebase grep]

**Primary recommendation:** Create a new main-owned triage view-model layer over cached normalized and derived session data, expose it through one typed IPC method per surface, and keep the renderer strictly presentational and capability-aware. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Route activation and shell navigation (`/overview`, `/projects`, `/sessions`, `/diagnostics`) | Browser / Client | API / Backend | Route matching, redirects, selected nav state, and focus/keyboard behavior belong in the renderer; the renderer should only consume typed data from main. [VERIFIED: codebase grep] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] |
| Overview rollups and attention metrics | API / Backend | Database / Storage | Totals, status counts, and time-series bins should be computed from cached normalized plus derived truth once, in main, to avoid renderer drift and duplicate truth logic. [VERIFIED: codebase grep] |
| Project rollups and placeholder git fields | API / Backend | Browser / Client | Project aggregation depends on normalized project/session/audit joins and explicit Phase 7 placeholder policy; renderer only presents the sanitized result. [VERIFIED: codebase grep] |
| Sessions queue interaction and row selection | Browser / Client | API / Backend | List focus, arrow-key navigation, and selected-row rendering are renderer concerns, but the row payloads should arrive as already-shaped DTOs. [VERIFIED: codebase grep] |
| Session Detail mixed timeline | API / Backend | Browser / Client | Ordering normalized events and attaching related messages/tool calls/artifacts is safer in main; renderer owns progressive disclosure and scroll behavior. [VERIFIED: codebase grep] |
| Run Audit grouped evidence | API / Backend | Browser / Client | Evidence grouping must remain aligned with shared-core audit truth and supporting IDs, so grouping belongs in main rather than ad hoc renderer transforms. [VERIFIED: codebase grep] |
| Diagnostics grouping and capability-warning vocabulary | API / Backend | Browser / Client | Diagnostics need consistent grouping by existing source areas and safe sanitization before IPC; renderer renders filters and scan-first presentation. [VERIFIED: codebase grep] |
| Harness-filter state during one app session | Browser / Client | API / Backend | Filter chip state is session-local UI state, but API methods may optionally accept adapter filters to reduce overfetch or simplify per-surface queries. [VERIFIED: codebase grep] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` [VERIFIED: npm registry] | `42.2.0` published 2026-05-19 [VERIFIED: npm registry] | Secure local desktop shell and typed preload bridge. [CITED: https://www.electronjs.org/docs/latest/tutorial/security] | Electron’s current security guidance still centers on context isolation, sandboxing, CSP, and narrow preload APIs, which matches the repo’s existing Phase 2 shell and must remain intact during Phase 6. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/security] |
| `react` [VERIFIED: npm registry] | `19.2.6` published 2026-05-06 [VERIFIED: npm registry] | Renderer UI composition and non-blocking route/filter updates. [CITED: https://react.dev/reference/react/startTransition] | React 19’s `startTransition` remains the standard way to keep heavier route/filter updates responsive, and React Router can already wrap router state updates with it. [CITED: https://react.dev/reference/react/startTransition] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] |
| `react-router` [VERIFIED: npm registry] | `7.15.1` published 2026-05-14 [VERIFIED: npm registry] | Hash-based route state for Electron renderer pages. [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] | The repo already uses `HashRouter`, and official docs confirm it stores location in the hash and can wrap router state updates in `React.startTransition`, which fits a local Electron shell well. [VERIFIED: codebase grep] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] |
| `zod` [VERIFIED: npm registry] | `4.4.3` published 2026-05-04 [VERIFIED: npm registry] | Strict runtime validation for new triage DTOs and IPC payloads. [CITED: https://zod.dev/api?id=sets] | Phase 6 will add many new renderer-facing shapes; `z.strictObject` and discriminated unions are the right way to make unsupported and unknown states explicit instead of optional loose blobs. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` [VERIFIED: npm registry] ` [WARNING: slopcheck flagged as suspicious — verify before using.]` | `4.1.7` published 2026-05-20 [VERIFIED: npm registry] | Split `node` and `renderer` test projects for IPC services and jsdom route tests. [CITED: https://vitest.dev/guide/projects] | Use for every new main-service and renderer-route assertion; the repo already runs separate node and jsdom projects and focused `--project` executions. [VERIFIED: codebase grep] [CITED: https://vitest.dev/guide/projects] |
| `@testing-library/react` [VERIFIED: npm registry] | `16.3.2` published 2026-01-19 [VERIFIED: npm registry] | User-centric renderer route tests in jsdom. [CITED: https://testing-library.com/docs/react-testing-library/intro] | Use for navigation, empty/error states, row selection, filter behavior, and explicit badge assertions instead of component-instance tests. [VERIFIED: codebase grep] [CITED: https://testing-library.com/docs/react-testing-library/intro] |
| `shadcn` [VERIFIED: npm registry] | `4.8.0` published 2026-05-21 [VERIFIED: npm registry] | Optional official registry components for repeated triage primitives. [CITED: https://ui.shadcn.com/docs/installation/manual] | Use only if repeated bordered cards, badges, separators, tabs, or tables meaningfully reduce duplication; otherwise keep the current CSS-first shell style. [VERIFIED: codebase grep] [CITED: https://ui.shadcn.com/docs/installation/manual] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Main-owned triage aggregation [VERIFIED: codebase grep] | Renderer-side recomputation from raw session summaries [ASSUMED] | Reject this. It would duplicate audit logic, increase drift risk, and make `UI-09` failures likely. [VERIFIED: codebase grep] |
| Existing `HashRouter` route model [VERIFIED: codebase grep] | A new state library or custom router [ASSUMED] | Reject this. Current routes already use React Router, and Phase 6 needs more typed routes, not a navigation rewrite. [VERIFIED: codebase grep] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] |
| Native HTML/CSS/SVG summaries inside the existing shell [VERIFIED: codebase grep] | A third-party chart/dashboard library [ASSUMED] | Reject this for Phase 6. The UI-SPEC explicitly favors compact bordered metrics over glossy charts, and the required attention views are simple enough to render without another dependency. [VERIFIED: codebase grep] |
| Existing shell CSS plus optional official `shadcn` pieces [VERIFIED: codebase grep] | A new component framework [ASSUMED] | Reject this. The repo already has the theme primitives and optional official registry path; another UI kit would increase surface area without solving the core truth-model problem. [VERIFIED: codebase grep] [CITED: https://ui.shadcn.com/docs/installation/manual] |

**Installation:**

```bash
# No new phase-specific runtime package install is required for the primary path.
# Reuse the existing stack in package.json and add official shadcn components only if repetition justifies them.
```

No new phase-specific package install is required because the repo already includes React, React Router, Zod, Vitest, Testing Library, Lucide, Tailwind, and the local `shadcn` CLI. [VERIFIED: codebase grep] [VERIFIED: npm registry]

## Package Legitimacy Audit

No new package install is required for the primary recommendation. The phase-relevant existing dependencies below were checked anyway because Phase 6 may lean on them directly. [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `react-router` [VERIFIED: npm registry] | npm [VERIFIED: npm registry] | 12y 3mo [VERIFIED: npm registry] | 49,081,721/week [VERIFIED: npm registry] | `github.com/remix-run/react-router` [VERIFIED: npm registry] | `OK` [VERIFIED: slopcheck] | Approved existing dependency; keep as the only router. [VERIFIED: codebase grep] |
| `zod` [VERIFIED: npm registry] | npm [VERIFIED: npm registry] | 6y 2mo [VERIFIED: npm registry] | 179,832,332/week [VERIFIED: npm registry] | `github.com/colinhacks/zod` [VERIFIED: npm registry] | `OK` [VERIFIED: slopcheck] | Approved existing dependency for DTO validation. [VERIFIED: codebase grep] |
| `@testing-library/react` [VERIFIED: npm registry] | npm [VERIFIED: npm registry] | 7y 0mo [VERIFIED: npm registry] | 42,541,889/week [VERIFIED: npm registry] | `github.com/testing-library/react-testing-library` [VERIFIED: npm registry] | `OK` [VERIFIED: slopcheck] | Approved existing dependency for renderer tests. [VERIFIED: codebase grep] |
| `shadcn` [VERIFIED: npm registry] | npm [VERIFIED: npm registry] | 1y 10mo [VERIFIED: npm registry] | 4,952,612/week [VERIFIED: npm registry] | `github.com/shadcn-ui/ui` [VERIFIED: npm registry] | `OK` [VERIFIED: slopcheck] | Approved optional dependency; use official registry only. [CITED: https://ui.shadcn.com/docs/installation/manual] |
| `vitest` [VERIFIED: npm registry] ` [WARNING: slopcheck flagged as suspicious — verify before using.]` | npm [VERIFIED: npm registry] | 4y 5mo [VERIFIED: npm registry] | 62,372,627/week [VERIFIED: npm registry] | `github.com/vitest-dev/vitest` [VERIFIED: npm registry] | `SUS` from typosquat heuristic against `vite` [VERIFIED: slopcheck] | Existing locked dependency already used by the repo; no new install task needed, but keep the warning documented. [VERIFIED: codebase grep] [CITED: https://vitest.dev/guide/projects] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]
**Packages flagged as suspicious [SUS]:** `vitest`. [VERIFIED: slopcheck]

## Architecture Patterns

### System Architecture Diagram

```text
Renderer routes
  /overview  /projects  /sessions  /sessions/:id  /sessions/:id/audit  /diagnostics
        |
        v
window.agentWorkbench.* surface-specific methods
        |
        v
Preload: one typed method per IPC operation
        |
        v
IPC handlers + Zod request/response validation
        |
        v
Main triage view-model services
  - overview rollups
  - project rollups
  - session summaries/detail timeline
  - grouped run audit DTOs
  - grouped diagnostics DTOs
        |
        +----------------------+
        |                      |
        v                      v
Normalized cache records   Derived session truth
projects/sessions/events   shellCommands/verification/audit
        |                      |
        +---------- merge/join/sanitize -----------+
```

The main process should stay the only place that joins normalized entities with derived shell, verification, audit, and diagnostic state before the renderer sees it. [VERIFIED: codebase grep]

### Recommended Project Structure

```text
src/
├── main/
│   ├── app/
│   │   ├── triage-view-model-service.ts      # overview/projects shared rollups
│   │   ├── session-detail-view-model-service.ts
│   │   ├── run-audit-view-model-service.ts
│   │   └── diagnostics-view-model-service.ts
│   └── ipc/
│       ├── channels.ts                       # new per-surface channels
│       ├── handlers.ts                       # one handler per method
│       └── view-models.ts                    # Zod schemas for every new DTO
├── preload/
│   ├── index.ts                              # one bridge method per new channel
│   └── types.ts
└── renderer/
    ├── routes/
    │   ├── OverviewRoute.tsx
    │   ├── ProjectsRoute.tsx
    │   ├── SessionsRoute.tsx                 # extend existing
    │   ├── SessionDetailRoute.tsx
    │   ├── RunAuditRoute.tsx
    │   └── DiagnosticsRoute.tsx
    └── components/
        └── triage/                           # shared badges, metric cards, timeline rows, diagnostics groups
```

The exact filenames are discretionary, but splitting services by surface keeps DTO growth readable and lets tests stay focused per surface. [VERIFIED: codebase grep]

### Pattern 1: Main-Owned Aggregation + Zod-Parsed DTOs

**What:** Load cached normalized records in main, join them there, and parse the outgoing DTO with a strict Zod schema before it crosses IPC. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets]
**When to use:** Every new Overview, Projects, Session Detail, Run Audit, and Diagnostics payload. [VERIFIED: codebase grep]
**Example:**

```typescript
// Source: src/main/app/session-view-model-service.ts
async listSessions() {
  const data = await loadSessionData(runtime);

  return [...data.sessionsById.values()].map((session) =>
    sessionSummaryViewModelSchema.parse(toSessionSummary(data, session))
  );
}
```

This existing pattern is the right model to extend for the new triage surfaces. [VERIFIED: codebase grep]

### Pattern 2: Explicit Metric State Instead of Nullable Numbers

**What:** Represent metric outputs as either a numeric value, `Unsupported`, or `Unknown`, rather than as optional numbers with renderer fallbacks. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets]
**When to use:** Counts and git/GitHub placeholders on Overview, Projects, Sessions, and Run Audit. [VERIFIED: codebase grep]
**Example:**

```typescript
// Source: adapted from Zod strict/discriminated-union patterns
const metricStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value"),
    value: z.number().int().nonnegative()
  }),
  z.strictObject({
    kind: z.literal("unsupported"),
    label: z.literal("Unsupported"),
    reason: z.string().optional()
  }),
  z.strictObject({
    kind: z.literal("unknown"),
    label: z.literal("Unknown"),
    reason: z.string().optional()
  })
]);
```

This directly prevents `count || 0` and `status ?? "Clean"` bugs. [VERIFIED: codebase grep]

### Pattern 3: Non-Blocking Filter and Drill-In Updates

**What:** Keep cross-route filter changes and heavier detail-route loads responsive with transition-friendly state updates. [CITED: https://react.dev/reference/react/startTransition] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter]
**When to use:** Harness filter chips, Overview drill-ins, and route transitions to Session Detail or Run Audit. [CITED: https://react.dev/reference/react/startTransition]
**Example:**

```typescript
// Source: adapted from React startTransition guidance
import { startTransition } from "react";

function applyHarnessFilter(nextFilter: HarnessFilter) {
  startTransition(() => {
    setHarnessFilter(nextFilter);
    navigate("/sessions");
  });
}
```

This is an optimization tool, not a new state model. Use it only around route/filter transitions that can block list rendering. [CITED: https://react.dev/reference/react/startTransition]

### Anti-Patterns to Avoid

- **Renderer-side audit math:** Do not re-derive verification or run-audit states from summary DTOs in route components; reuse scan-time derived truth from cache records. [VERIFIED: codebase grep]
- **Generic preload escape hatches:** Do not expose `invoke`, `send`, or raw `ipcRenderer` helpers; Electron explicitly recommends one method per IPC message. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation]
- **Provider-ID page branches:** Do not branch on `adapterId === "gemini-cli"` in shared renderer or main code; existing boundary tests will fail and the architecture contract forbids it. [VERIFIED: codebase grep]
- **Silent placeholder collapse:** Do not use `?? 0`, hidden columns, or empty strings for unsupported git/GitHub or verification fields. [VERIFIED: codebase grep]
- **Mixing chronology with judgment:** Do not bury grouped audit evidence inside Session Detail’s timeline; the phase contract requires separate Session Detail and Run Audit surfaces. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Route state in Electron renderer | A custom hash parser or local nav framework [ASSUMED] | Existing `react-router` `HashRouter` plus additional routes. [VERIFIED: codebase grep] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] | The repo already uses it, and it matches Electron’s local-shell routing constraints. [VERIFIED: codebase grep] |
| IPC contract validation | Ad hoc runtime checks or loose DTO objects [ASSUMED] | Zod strict object schemas and discriminated unions in `src/main/ipc/view-models.ts`. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets] | This is the existing contract pattern and the safest way to preserve truthful unsupported/unknown states. [VERIFIED: codebase grep] |
| Verification/audit classification for UI | New renderer heuristics over counts and badges [ASSUMED] | Reuse `record.derived.sessions[].verification` and `.audit` from scan-time derivation. [VERIFIED: codebase grep] | Shared-core rules already encode precedence and attention reasons; duplicating them would cause drift. [VERIFIED: codebase grep] |
| Diagnostics taxonomy | A new provider-specific diagnostics category tree [ASSUMED] | Existing `adapter` / `source` / `normalization` / `cache` group vocabulary, extended with capability-oriented group views only in presentation. [VERIFIED: codebase grep] | The repo and phase contract already use these source areas. [VERIFIED: codebase grep] |
| New dashboard/chart dependency | A charting framework for simple counts and activity strips [ASSUMED] | Existing CSS layout, text metrics, and lightweight SVG if needed. [VERIFIED: codebase grep] | Phase 6 needs truthful triage, not a chart library; the UI-SPEC explicitly avoids glossy dashboards. [VERIFIED: codebase grep] |

**Key insight:** the tricky logic already exists in shared core and cache; Phase 6 should surface it faithfully, not invent a second truth engine in the renderer. [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Flattening Capability Gaps Into Zero or Green

**What goes wrong:** Counts or states fall back to `0`, `Passed`, or `Clean` when evidence is missing, unsupported, or not yet derived. [VERIFIED: codebase grep]
**Why it happens:** Current session DTOs use plain numeric fields for evidence counts, and careless new dashboard math can treat absence as zero. [VERIFIED: codebase grep]
**How to avoid:** Model every truth-sensitive field as explicit value/unsupported/unknown state or keep a paired label alongside the numeric value. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets]
**Warning signs:** `?? 0`, hidden git columns, no-verification sessions showing only neutral badges, or tests asserting counts without asserting capability labels. [VERIFIED: codebase grep]

### Pitfall 2: Recomputing Audit Truth in the Renderer

**What goes wrong:** Overview, Projects, or Run Audit pages drift from Phase 5 precedence rules because the renderer derives status from incomplete summary payloads. [VERIFIED: codebase grep]
**Why it happens:** It is tempting to compute “needs attention” from lightweight fields instead of exposing richer DTOs from main. [VERIFIED: codebase grep]
**How to avoid:** Keep grouping, precedence, supporting IDs, and attention reasons in main-owned services backed by `record.derived.sessions`. [VERIFIED: codebase grep]
**Warning signs:** renderer helpers that inspect `adapterId`, parse shell command text, or rebuild audit groups from counts. [VERIFIED: codebase grep]

### Pitfall 3: Breaking the Read-Only Preload Contract

**What goes wrong:** New route data needs lead to a generic preload bridge, raw IPC exposure, or broad “load everything” methods. [VERIFIED: codebase grep]
**Why it happens:** Surface count grows quickly in Phase 6, and generic helpers feel cheaper than explicit methods. [VERIFIED: codebase grep]
**How to avoid:** Add one typed method per allowed IPC operation and keep request/response schemas strict. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation]
**Warning signs:** `window.agentWorkbench.invoke`, passing channel strings through the renderer, or handlers returning raw cache records. [VERIFIED: codebase grep]

### Pitfall 4: Letting Provider Labels Become Provider Logic

**What goes wrong:** Route components or services branch on Gemini-specific IDs or fields once detail surfaces grow. [VERIFIED: codebase grep]
**Why it happens:** Gemini is the first real adapter, so its fixtures dominate current tests and examples. [VERIFIED: codebase grep]
**How to avoid:** Keep provider differences confined to descriptor display names and capability metadata; never let them change shared page logic. [VERIFIED: codebase grep]
**Warning signs:** `if (adapterId === "gemini-cli")`, special-case timeline sections, or provider-specific column visibility. [VERIFIED: codebase grep]

## Code Examples

Verified patterns from official sources and current repo seams:

### Safe Preload Surface Pattern

```typescript
// Source: https://www.electronjs.org/docs/latest/tutorial/context-isolation
// Adapted to match the repo's current bridge style.
contextBridge.exposeInMainWorld("agentWorkbench", {
  listOverview: () => ipcRenderer.invoke("overview:list"),
  getProjectById: (request) => ipcRenderer.invoke("projects:getById", request)
});
```

Electron explicitly recommends one method per IPC message instead of exposing a generic send/invoke surface. [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation]

### Focused Renderer Test Command Pattern

```bash
npm run test:renderer -- tests/renderer/sessions-route.test.tsx
npm run test -- --project node tests/main/ipc/session-view-model-service.test.ts
```

Both focused commands work in the current repo and match Vitest’s documented `--project` filtering model. [VERIFIED: codebase grep] [CITED: https://vitest.dev/guide/projects]

### Strict DTO Pattern for Unsupported and Unknown States

```typescript
// Source: https://zod.dev/api?id=sets
const triageStatusSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("value"), value: z.string().min(1) }),
  z.strictObject({ kind: z.literal("unsupported"), label: z.literal("Unsupported") }),
  z.strictObject({ kind: z.literal("unknown"), label: z.literal("Unknown") })
]);
```

This keeps unsupported and unknown states explicit at the schema boundary instead of relying on renderer fallback rules. [CITED: https://zod.dev/api?id=sets]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vitest `workspace` terminology [CITED: https://vitest.dev/guide/projects] | Vitest `projects` configuration [CITED: https://vitest.dev/guide/projects] | Deprecated since Vitest 3.2; current docs describe `projects` as the replacement. [CITED: https://vitest.dev/guide/projects] | The repo already uses `projects`; Phase 6 tests should stay on that model. [VERIFIED: codebase grep] |
| Direct `window.X = apiObject` preload exposure [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation] | `contextBridge.exposeInMainWorld(...)` with one method per IPC message [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation] | Electron recommends this in current context-isolation guidance. [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation] | New Phase 6 surfaces should add explicit bridge methods, not generic IPC helpers. [VERIFIED: codebase grep] |
| Route updates treated as urgent by default [CITED: https://react.dev/reference/react/startTransition] | Router state updates can be wrapped in `React.startTransition`, and React Router’s `HashRouter` documents transition-aware updates. [CITED: https://react.dev/reference/react/startTransition] [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] | Current docs. [CITED: https://reactrouter.com/api/declarative-routers/HashRouter] | Heavy filter or drill-in navigation can stay responsive without introducing a new state library. [CITED: https://react.dev/reference/react/startTransition] |

**Deprecated/outdated:**

- Treating renderer DTOs as permissive objects with silent extra keys is outdated for this repo; current code already standardizes on strict Zod-parsed view models. [VERIFIED: codebase grep]
- Keeping `Overview`, `Projects`, and `Diagnostics` as disabled placeholders is now outdated relative to the Phase 6 contract. [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No new runtime package installs are required for the primary Phase 6 implementation path. [ASSUMED] | Standard Stack | Low. The fallback is still to use the already-approved local `shadcn` CLI or add a narrowly justified package with a separate legitimacy check. |
| A2 | A split of one shared triage rollup service plus separate detail/audit/diagnostics services will plan more cleanly than one monolithic view-model service. [ASSUMED] | Recommended Project Structure | Low. The planner can collapse these into fewer files if the implementation stays main-owned and typed. |

## Open Questions

1. **Should filter state live in route URLs, top-level renderer state, or both?**
   - What we know: the UI-SPEC requires harness filters to persist while navigating among triage routes during the same app session. [VERIFIED: codebase grep]
   - What's unclear: whether the planner wants that persistence encoded in hash/search params for deep-link parity, or only in-memory for Phase 6. [ASSUMED]
   - Recommendation: keep the plan flexible here, but avoid pushing filter state into main or cache for Phase 6. [ASSUMED]

2. **Should Run Audit DTOs expose grouped sections only, or sections plus raw supporting entity collections?**
   - What we know: the phase contract requires grouped evidence questions and sanitized detail, not raw cache records. [VERIFIED: codebase grep]
   - What's unclear: the minimum data shape needed for a good renderer without overfetching or leaking raw detail. [ASSUMED]
   - Recommendation: plan for grouped sections with stable IDs and short summaries first; add deeper supporting collections only where the UI-SPEC explicitly needs drill-in detail. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite, Vitest, Electron scripts | ✓ [VERIFIED: codebase grep] | `v26.0.0` [VERIFIED: codebase grep] | — |
| npm | package scripts and local CLI execution | ✓ [VERIFIED: codebase grep] | `11.12.1` [VERIFIED: codebase grep] | — |
| Vite CLI | renderer/dev build path | ✓ [VERIFIED: codebase grep] | `8.0.14` [VERIFIED: codebase grep] | — |
| Vitest CLI | renderer and node test projects | ✓ [VERIFIED: codebase grep] | `4.1.7` [VERIFIED: codebase grep] | — |
| Electron CLI | local shell launch and smoke workflow | ✓ [VERIFIED: codebase grep] | `42.2.0` [VERIFIED: codebase grep] | — |
| local `shadcn` CLI | optional official UI primitive generation | ✓ [VERIFIED: codebase grep] | `4.8.0` [VERIFIED: codebase grep] | existing CSS-first components |

**Missing dependencies with no fallback:**

- None. [VERIFIED: codebase grep]

**Missing dependencies with fallback:**

- None. [VERIFIED: codebase grep]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest` `4.1.7` with `node` and `renderer` projects. [VERIFIED: codebase grep] [VERIFIED: npm registry] |
| Config file | `vitest.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm run test:renderer -- tests/renderer/sessions-route.test.tsx` or `npm run test -- --project node tests/main/ipc/session-view-model-service.test.ts`. Both were executed successfully during research. [VERIFIED: codebase grep] |
| Full suite command | `npm run test`. [VERIFIED: codebase grep] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Overview renders truthful totals, attention states, and harness filters. | renderer + node service | `npm run test -- --project renderer tests/renderer/overview-route.test.tsx` | ❌ Wave 0 |
| UI-02 | Projects renders cross-harness rollups and explicit Phase 7 git placeholders. | renderer + node service | `npm run test -- --project renderer tests/renderer/projects-route.test.tsx` | ❌ Wave 0 |
| UI-03 | Sessions stays fast triage and surfaces explicit unknown/unsupported state. | renderer | `npm run test:renderer -- tests/renderer/sessions-route.test.tsx` | ✅ |
| UI-04 | Session Detail renders summary rail plus chronological mixed timeline. | renderer + node service | `npm run test -- --project renderer tests/renderer/session-detail-route.test.tsx` | ❌ Wave 0 |
| UI-05 | Run Audit renders grouped evidence sections from shared derived truth. | renderer + node service | `npm run test -- --project renderer tests/renderer/run-audit-route.test.tsx` | ❌ Wave 0 |
| UI-07 | Diagnostics renders grouped source-area warnings without raw leakage. | renderer + node service | `npm run test -- --project renderer tests/renderer/diagnostics-route.test.tsx` | ❌ Wave 0 |
| UI-08 | Shared renderer/main code avoids provider-ID branches. | boundary + renderer | `npm run test:boundaries` | ✅ |
| UI-09 | Unsupported and unknown values do not render as zero, passed, or clean. | renderer + node service | `npm run test -- --project renderer tests/renderer/triage-truth-states.test.tsx` | ❌ Wave 0 |
| TEST-07 | Capability gates remain explicit across routes and DTOs. | renderer + node service | `npm run test -- --project node tests/main/ipc/triage-view-model-service.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** run the smallest affected project command, usually `npm run test -- --project renderer <route-test>` or `npm run test -- --project node <service-test>`. [VERIFIED: codebase grep] [CITED: https://vitest.dev/guide/projects]
- **Per wave merge:** run `npm run test:renderer`, `npm run test -- --project node tests/main/ipc`, and `npm run test:boundaries`. [VERIFIED: codebase grep]
- **Phase gate:** `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:boundaries` all green before `$gsd-verify-work`. [VERIFIED: codebase grep]

### Wave 0 Gaps

- [ ] `tests/renderer/overview-route.test.tsx` — covers `UI-01`. [VERIFIED: codebase grep]
- [ ] `tests/renderer/projects-route.test.tsx` — covers `UI-02`. [VERIFIED: codebase grep]
- [ ] `tests/renderer/session-detail-route.test.tsx` — covers `UI-04`. [VERIFIED: codebase grep]
- [ ] `tests/renderer/run-audit-route.test.tsx` — covers `UI-05`. [VERIFIED: codebase grep]
- [ ] `tests/renderer/diagnostics-route.test.tsx` — covers `UI-07`. [VERIFIED: codebase grep]
- [ ] `tests/renderer/triage-truth-states.test.tsx` — covers `UI-09` across multiple routes. [ASSUMED]
- [ ] `tests/main/ipc/triage-view-model-service.test.ts` — covers Overview/Projects rollups and placeholder truth. [ASSUMED]
- [ ] `tests/main/ipc/session-detail-view-model-service.test.ts` — covers timeline sanitization and grouping. [ASSUMED]
- [ ] `tests/main/ipc/run-audit-view-model-service.test.ts` — covers grouped evidence DTOs. [ASSUMED]
- [ ] `tests/main/ipc/diagnostics-view-model-service.test.ts` — covers grouped source-area diagnostics DTOs. [ASSUMED]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no [VERIFIED: codebase grep] | None in scope for Phase 6. [VERIFIED: codebase grep] |
| V3 Session Management | no [VERIFIED: codebase grep] | None in scope for Phase 6. [VERIFIED: codebase grep] |
| V4 Access Control | no [VERIFIED: codebase grep] | No user/account privilege model is introduced by this phase. [VERIFIED: codebase grep] |
| V5 Input Validation | yes [VERIFIED: codebase grep] | Zod strict DTO and IPC schema parsing. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets] |
| V6 Cryptography | no [VERIFIED: codebase grep] | None in scope for Phase 6. [VERIFIED: codebase grep] |

### Known Threat Patterns for Electron + Typed IPC + Read-Only Triage UI

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer tries to call arbitrary IPC channels | Elevation of Privilege | Keep `contextBridge` narrow and expose one method per allowed IPC operation only. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation] |
| Raw cache records or filesystem paths leak into renderer DTOs | Information Disclosure | Sanitize in main, return strict view models only, and keep tests that reject raw file leakage. [VERIFIED: codebase grep] |
| Malicious or malformed payload reaches an IPC handler | Tampering | Parse every request and response with strict Zod schemas before use. [VERIFIED: codebase grep] [CITED: https://zod.dev/api?id=sets] |
| Provider-specific branches change trust semantics | Tampering | Keep shared renderer/main code harness-neutral and preserve boundary tests against provider-ID branches. [VERIFIED: codebase grep] |
| Remote-content assumptions creep into local shell pages | Elevation of Privilege | Preserve Electron security defaults: context isolation, sandboxing, no Node integration in renderer, restrictive CSP. [VERIFIED: codebase grep] [CITED: https://www.electronjs.org/docs/latest/tutorial/security] |

## Sources

### Primary (HIGH confidence)

- Codebase inspection of `src/main/app/session-view-model-service.ts`, `src/main/core/ingestion/scanner.ts`, `src/main/core/cache/file-backed-cache-store.ts`, `src/main/ipc/{view-models,handlers,channels}.ts`, `src/preload/{index,types}.ts`, `src/renderer/{App,styles}.tsx`, `src/renderer/components/AppShell.tsx`, `src/renderer/routes/{SessionsRoute,DataSourcesRoute}.tsx`, and existing tests. [VERIFIED: codebase grep]
- Electron Context Isolation docs: https://www.electronjs.org/docs/latest/tutorial/context-isolation [CITED: https://www.electronjs.org/docs/latest/tutorial/context-isolation]
- Electron Security docs: https://www.electronjs.org/docs/latest/tutorial/security [CITED: https://www.electronjs.org/docs/latest/tutorial/security]
- React Router `HashRouter` docs: https://reactrouter.com/api/declarative-routers/HashRouter [CITED: https://reactrouter.com/api/declarative-routers/HashRouter]
- React `startTransition` docs: https://react.dev/reference/react/startTransition [CITED: https://react.dev/reference/react/startTransition]
- Vitest Test Projects docs: https://vitest.dev/guide/projects [CITED: https://vitest.dev/guide/projects]
- Vitest Test Environment docs: https://vitest.dev/guide/environment.html [CITED: https://vitest.dev/guide/environment.html]
- Zod API docs: https://zod.dev/api?id=sets [CITED: https://zod.dev/api?id=sets]
- shadcn manual installation docs: https://ui.shadcn.com/docs/installation/manual [CITED: https://ui.shadcn.com/docs/installation/manual]
- Testing Library React intro: https://testing-library.com/docs/react-testing-library/intro [CITED: https://testing-library.com/docs/react-testing-library/intro]
- npm registry verification via `npm view` for `electron`, `react`, `react-router`, `zod`, `vitest`, `@testing-library/react`, and `shadcn`. [VERIFIED: npm registry]
- slopcheck 0.6.1 package legitimacy scan results for phase-relevant dependencies. [VERIFIED: slopcheck]

### Secondary (MEDIUM confidence)

- None. [VERIFIED: codebase grep]

### Tertiary (LOW confidence)

- None. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - package versions were verified in the npm registry and matched against official docs for the phase-relevant libraries. [VERIFIED: npm registry]
- Architecture: HIGH - the current repo already exposes the exact main/IPC/preload/renderer seams Phase 6 must extend. [VERIFIED: codebase grep]
- Pitfalls: HIGH - the major failure modes are directly visible in existing tests, UI contracts, and Phase 5 derived-truth boundaries. [VERIFIED: codebase grep]

**Research date:** 2026-05-24 [VERIFIED: codebase grep]
**Valid until:** 2026-06-23 for codebase seams and 2026-05-31 for package/version currency. [ASSUMED]
