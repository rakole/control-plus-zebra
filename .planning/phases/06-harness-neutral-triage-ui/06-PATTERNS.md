# Phase 6: Harness-Neutral Triage UI - Pattern Map

**Mapped:** 2026-05-24
**Scope:** Main-owned triage aggregation, typed IPC/preload expansion, renderer route growth, truthful unsupported/unknown states, and adapter-neutral UI coverage.

## Existing Patterns To Preserve

| New Area | Closest Existing Analog | Pattern To Reuse |
|----------|-------------------------|------------------|
| Overview and Projects rollups | `src/main/app/session-view-model-service.ts` | Load cached normalized records in main, merge once, then parse sanitized DTOs with strict Zod schemas before they cross IPC. |
| Route-specific preload methods | `src/preload/index.ts`, `src/preload/types.ts`, `src/main/ipc/channels.ts` | Keep one typed preload method per IPC operation. Do not add a generic invoke helper or raw channel passthrough. |
| Renderer route composition | `src/renderer/App.tsx`, `src/renderer/components/AppShell.tsx`, `src/renderer/routes/DataSourcesRoute.tsx` | Register each route explicitly in `HashRouter`, promote nav items in `AppShell`, and keep route-level loading/error/empty states local to the page. |
| Sessions triage interaction | `src/renderer/routes/SessionsRoute.tsx`, `src/renderer/components/SessionList.tsx`, `src/renderer/components/SessionPreview.tsx` | Preserve the split list/detail flow, keyboard row navigation, and read-only reload semantics while enriching the summary data. |
| Truth-state rendering | `src/main/ipc/view-models.ts`, `tests/renderer/sessions-route.test.tsx`, `tests/main/ipc/session-view-model-service.test.ts` | Keep unsupported and unknown states explicit in DTOs and tests; never collapse missing evidence into `0`, `Passed`, or `Clean`. |
| Internal derived truth usage | `src/main/core/cache/file-backed-cache-store.ts`, `src/main/core/audit/types.ts`, `src/main/core/verification/types.ts` | Reuse `record.derived.sessions[].verification` and `.audit` from Phase 5 instead of recomputing verification or audit logic in renderer code. |

## Planned File Roles

| Plan | Files / Modules | Role |
|------|-----------------|------|
| `06-01` | `src/main/app/triage-view-model-service.ts`, `src/main/ipc/{channels,handlers,view-models}.ts`, `src/preload/{index,types}.ts`, `src/renderer/{App.tsx,components/AppShell.tsx,routes/OverviewRoute.tsx,routes/ProjectsRoute.tsx,routes/SessionsRoute.tsx}` | Add the route/DTO/service foundation for Overview, Projects, and a denser Sessions triage surface. |
| `06-02` | `src/main/app/session-detail-view-model-service.ts`, `src/main/ipc/**`, `src/preload/**`, `src/renderer/routes/SessionDetailRoute.tsx`, `src/renderer/components/triage/session-detail/**` | Add the session detail summary rail plus chronological mixed-evidence timeline. |
| `06-03` | `src/main/app/run-audit-view-model-service.ts`, `src/main/ipc/**`, `src/preload/**`, `src/renderer/routes/RunAuditRoute.tsx`, `src/renderer/components/triage/run-audit/**` | Add grouped run-audit evidence surfaces from shared derived truth. |
| `06-04` | `src/main/app/diagnostics-view-model-service.ts`, `src/main/ipc/**`, `src/preload/**`, `src/renderer/routes/DiagnosticsRoute.tsx`, `src/renderer/components/triage/{TruthStateBadge,CapabilityWarningPanel,DiagnosticGroup}.tsx` | Add diagnostics aggregation and shared capability-warning presentation primitives. |
| `06-05` | `tests/main/ipc/**`, `tests/renderer/**`, `tests/boundaries/**` plus any small support fixes in `src/main/ipc/**` or `src/renderer/**` | Lock adapter-neutral rendering and truth-state behavior with focused service, renderer, and boundary coverage. |

## Key Code Excerpts

### Main already owns the sanitized session aggregation seam

```typescript
async listSessions() {
  const data = await loadSessionData(runtime);

  return [...data.sessionsById.values()].map((session) =>
    sessionSummaryViewModelSchema.parse(toSessionSummary(data, session))
  );
}
```

Phase 6 should extend this pattern for Overview, Projects, Session Detail, Run Audit, and Diagnostics rather than creating renderer-side derivation helpers.

### IPC/preload already enforce one method per operation

```typescript
const agentWorkbench: AgentWorkbenchBridge = Object.freeze({
  listSessions(request: ListSessionsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listSessions, request);
  },
  getSessionById(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSessionById, request);
  }
});
```

New triage surfaces should follow this exact style with explicit bridge methods such as `getOverviewDashboard`, `listProjects`, `getSessionDetail`, `getSessionRunAudit`, and `listDiagnostics`.

### Current route shell already has the navigation seam Phase 6 needs

```typescript
<Routes>
  <Route path="/" element={<Navigate to="/sessions" replace />} />
  <Route path="/data-sources" element={<DataSourcesRoute />} />
  <Route path="/sessions" element={<SessionsRoute />} />
</Routes>
```

Phase 6 should promote `Overview`, `Projects`, and `Diagnostics` to real routes, move the root redirect to `/overview`, and keep `Data Sources` available as the setup/config surface.

### Derived cache truth is already persisted and ready for UI projection

```typescript
export interface DerivedSessionCacheRecord {
  sessionId: string;
  shellCommands: ParsedShellCommand[];
  verification?: VerificationResult;
  audit?: RunAuditResult;
}
```

Session Detail, Run Audit, and Overview attention metrics should consume this shared derived payload instead of reinterpreting raw events in the renderer.

## Implementation Notes

- Prefer discriminated unions or paired label objects for metrics whose evidence may be unsupported or unknown.
- Keep provider differences limited to descriptor display names and capability metadata. Do not add `if (adapterId === "gemini-cli")` branches in shared renderer or main code.
- Use the existing CSS system and already-configured official `shadcn` path only when it reduces repetition without adding new dependencies.
- Keep route-level reload behavior read-only and view-model-only. Phase 6 must not launch scans, mutate repositories, or execute shell commands.
