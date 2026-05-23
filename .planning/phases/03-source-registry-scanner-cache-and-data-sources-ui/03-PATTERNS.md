# Phase 3: Source Registry, Scanner, Cache, and Data Sources UI - Pattern Map

**Mapped:** 2026-05-23  
**Files analyzed:** 40 likely new/modified files  
**Analogs found:** 35 / 40

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/core/adapter-contract/types.ts` | model | request-response, transform | `src/main/core/adapter-contract/types.ts` | exact-modify |
| `src/main/core/adapter-contract/session-source-adapter.ts` | service contract | request-response, streaming | `src/main/core/adapter-contract/session-source-adapter.ts` | exact-modify |
| `src/main/core/registry/source-registry.ts` | service | CRUD | `src/main/core/registry/adapter-registry.ts` | role-match |
| `src/main/core/registry/source-registry-store.ts` | service | file-I/O, CRUD | `src/main/core/registry/adapter-registry.ts` | partial |
| `src/main/core/security/path-allowlist.ts` | utility | file-I/O | no exact analog | none |
| `src/main/core/security/safe-filesystem.ts` | service | file-I/O | `src/main/adapters/fake-test/discovery.ts` | inverse-gap |
| `src/main/core/ingestion/scanner.ts` | service | streaming, batch | `src/main/app/session-view-model-service.ts` | exact lifecycle |
| `src/main/core/ingestion/raw-artifact-index.ts` | service | CRUD, transform | `src/main/core/model/identifiers.ts` | partial |
| `src/main/core/ingestion/normalization-validator.ts` | utility | transform | `tests/contract/run-adapter-contract.ts` | role-match |
| `src/main/core/cache/cache-keys.ts` | utility | transform | `src/main/core/model/identifiers.ts` | exact pattern |
| `src/main/core/cache/file-backed-cache-store.ts` | service | file-I/O, CRUD | no exact analog | none |
| `src/main/core/watcher/watch-plan.ts` | model | event-driven | `src/main/core/model/capabilities.ts` | partial |
| `src/main/core/watcher/watch-orchestrator.ts` | service | event-driven | no exact analog | none |
| `src/main/adapters/fake-test/discovery.ts` | adapter service | file-I/O, streaming | `src/main/adapters/fake-test/discovery.ts` | exact-modify |
| `src/main/adapters/fake-test/parse.ts` | adapter service | file-I/O, streaming | `src/main/adapters/fake-test/parse.ts` | exact-modify |
| `src/main/app/data-sources-view-model-service.ts` | service | request-response, CRUD | `src/main/app/session-view-model-service.ts` | role-match |
| `src/main/app/session-view-model-service.ts` | service | request-response | `src/main/app/session-view-model-service.ts` | exact-modify |
| `src/main/ipc/channels.ts` | config | request-response | `src/main/ipc/channels.ts` | exact-modify |
| `src/main/ipc/view-models.ts` | model | request-response, transform | `src/main/ipc/view-models.ts` | exact-modify |
| `src/main/ipc/handlers.ts` | controller | request-response | `src/main/ipc/handlers.ts` | exact-modify |
| `src/preload/index.ts` | provider | request-response | `src/preload/index.ts` | exact-modify |
| `src/preload/types.ts` | model/provider | request-response | `src/preload/types.ts` | exact-modify |
| `src/renderer/App.tsx` | component | request-response | `src/renderer/App.tsx` | exact-modify |
| `src/renderer/components/AppShell.tsx` | component | request-response | `src/renderer/components/AppShell.tsx` | exact-modify |
| `src/renderer/routes/DataSourcesRoute.tsx` | component | request-response, CRUD | `src/renderer/routes/SessionsRoute.tsx` | role-match |
| `src/renderer/components/DataSourceList.tsx` | component | request-response | `src/renderer/components/SessionList.tsx` | role-match |
| `src/renderer/components/DataSourceDetail.tsx` | component | request-response | `src/renderer/components/SessionPreview.tsx` | role-match |
| `src/renderer/components/SourceStatusBadge.tsx` | component | transform | `src/renderer/components/CapabilityBadge.tsx` | role-match |
| `src/renderer/components/DataSourcesLoadingSkeleton.tsx` | component | request-response | `src/renderer/components/LoadingSkeleton.tsx` | role-match |
| `tests/main/core/source-registry.test.ts` | test | CRUD, file-I/O | `tests/main/ipc/session-view-model-service.test.ts` | partial |
| `tests/main/core/safe-filesystem.test.ts` | test | file-I/O | no exact analog | none |
| `tests/main/core/scanner.test.ts` | test | streaming, batch | `tests/contract/run-adapter-contract.ts` | role-match |
| `tests/main/core/raw-artifact-index.test.ts` | test | CRUD, transform | `tests/contract/run-adapter-contract.ts` | partial |
| `tests/main/core/file-backed-cache-store.test.ts` | test | file-I/O, CRUD | no exact analog | none |
| `tests/main/ipc/data-sources-ipc.test.ts` | test | request-response | `tests/main/ipc/ipc-handlers.test.ts` | exact pattern |
| `tests/preload/preload-api-surface.test.ts` | test | request-response | `tests/preload/preload-api-surface.test.ts` | exact-modify |
| `tests/renderer/data-sources-route.test.tsx` | test | request-response | `tests/renderer/sessions-route.test.tsx` | exact pattern |
| `tests/boundaries/import-boundaries.test.ts` | test | transform | `tests/boundaries/import-boundaries.test.ts` | exact-modify |
| `tests/boundaries/shared-naming.test.ts` | test | transform | `tests/boundaries/shared-naming.test.ts` | exact-modify |
| `tests/renderer/renderer-boundary-source.test.ts` | test | transform | `tests/renderer/renderer-boundary-source.test.ts` | exact-modify |

## Pattern Assignments

### Core Adapter Contract Files

**Applies to:** `src/main/core/adapter-contract/types.ts`, `src/main/core/adapter-contract/session-source-adapter.ts`, `src/main/core/watcher/watch-plan.ts`

**Analog:** `src/main/core/adapter-contract/session-source-adapter.ts`

**Imports pattern** (lines 1-16):
```typescript
import type { HarnessCapabilities } from "../model/capabilities.js";
import type { AdapterId } from "../model/identifiers.js";
import type { OutputArtifact } from "../model/entities.js";
import type {
  AdapterContext,
  AdapterNormalizationInput,
  AdapterNormalizationResult,
  DiscoveredHarnessSource,
  LoadedOutputArtifact,
  RawArtifactRef,
  RawHarnessEvent,
  SourceRootConfig,
  SourceRootHint,
  SourceRootValidation,
  SupportedPlatform
} from "./types.js";
```

**Core contract pattern** (lines 28-55):
```typescript
export interface SessionSourceAdapter<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
  descriptor: HarnessDescriptor;
  validateSourceRoot(root: SourceRootConfig, context: AdapterContext): Promise<SourceRootValidation>;
  discoverSources(root: SourceRootConfig, context: AdapterContext): AsyncIterable<DiscoveredHarnessSource>;
  discoverArtifacts(source: DiscoveredHarnessSource, context: AdapterContext): AsyncIterable<RawArtifactRef>;
  parseArtifact(artifact: RawArtifactRef, context: AdapterContext): AsyncIterable<TRawEvent>;
  normalize(input: AdapterNormalizationInput<TRawEvent>, context: AdapterContext): Promise<AdapterNormalizationResult>;
  loadOutputArtifact?(artifact: OutputArtifact, context: AdapterContext): Promise<LoadedOutputArtifact>;
}
```

**Existing types to extend** from `src/main/core/adapter-contract/types.ts` (lines 29-45, 57-67):
```typescript
export interface SourceRootConfig {
  rootPath: string;
  displayName?: string;
  metadata?: Record<string, string>;
}

export interface AdapterContext {
  projectDir: string;
  platform: NodeJS.Platform;
}

export interface RawArtifactRef {
  id: RawArtifactId;
  adapterId: AdapterId;
  sourceId: SourceId;
  nativeId: string;
  path: string;
  artifactType: string;
  byteLength?: number;
  mtimeMs?: number;
}
```

**Planner notes:** extend `AdapterContext` with safe filesystem helpers before refactoring fake adapter reads. Add watch-plan metadata as adapter evidence/capability truth, not renderer lifecycle control.

---

### Source Registry and Adapter Registry

**Applies to:** `src/main/core/registry/source-registry.ts`, `src/main/core/registry/source-registry-store.ts`

**Analog:** `src/main/core/registry/adapter-registry.ts`

**Imports and private state pattern** (lines 1-8):
```typescript
import type {
  HarnessDescriptor,
  SessionSourceAdapter
} from "../adapter-contract/index.js";
import type { AdapterId } from "../model/identifiers.js";

export class AdapterRegistry {
  readonly #adapters = new Map<AdapterId, SessionSourceAdapter>();
```

**CRUD-style registry methods** (lines 10-39):
```typescript
register(adapter: SessionSourceAdapter): this {
  if (this.#adapters.has(adapter.descriptor.id)) {
    throw new Error(`Adapter '${adapter.descriptor.id}' is already registered.`);
  }

  this.#adapters.set(adapter.descriptor.id, adapter);
  return this;
}

get(adapterId: AdapterId): SessionSourceAdapter | undefined {
  return this.#adapters.get(adapterId);
}

require(adapterId: AdapterId): SessionSourceAdapter {
  const adapter = this.get(adapterId);

  if (!adapter) {
    throw new Error(`Adapter '${adapterId}' is not registered.`);
  }

  return adapter;
}
```

**Composition root pattern** from `src/main/core/registry/register-bundled-adapters.ts` (lines 4-12):
```typescript
export function registerBundledAdapters(
  registry: AdapterRegistry = new AdapterRegistry()
): AdapterRegistry {
  registry.register(fakeTestAdapter);
  return registry;
}

export function createBundledAdapterRegistry(): AdapterRegistry {
  return registerBundledAdapters();
}
```

**Planner notes:** source registry should use harness-neutral records with `adapterId`, `sourceId`, `displayName`, `rootPath`, `enabled`, validation summary, scan/cache summary, diagnostics, and timestamps. Store persistence has no exact analog, so keep it injected/test-temp-dir based and Zod-validated.

---

### Safe Filesystem and Fake Adapter Refactor

**Applies to:** `src/main/core/security/path-allowlist.ts`, `src/main/core/security/safe-filesystem.ts`, `src/main/adapters/fake-test/discovery.ts`, `src/main/adapters/fake-test/parse.ts`

**Analog:** current fake adapter filesystem use, to replace with safe context helpers.

**Current direct stat gap** from `src/main/adapters/fake-test/discovery.ts` (lines 1-3, 16-24):
```typescript
import { stat } from "node:fs/promises";
import path from "node:path";

export async function validateFakeTestSourceRoot(
  root: SourceRootConfig,
  _context: AdapterContext
): Promise<SourceRootValidation> {
  const resolvedPath = path.resolve(root.rootPath);

  try {
    const fileStat = await stat(resolvedPath);
```

**Current artifact metadata pattern** (lines 92-112):
```typescript
export async function* discoverFakeTestArtifacts(
  source: DiscoveredHarnessSource,
  _context: AdapterContext
): AsyncIterable<RawArtifactRef> {
  const fileStat = await stat(source.rootPath);

  yield {
    id: createRawArtifactId({ adapterId: source.adapterId, sourceId: source.id, nativeId: source.rootPath }),
    adapterId: source.adapterId,
    sourceId: source.id,
    nativeId: source.rootPath,
    path: source.rootPath,
    artifactType: "fake-session-fixture",
    mediaType: "application/json",
    byteLength: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  };
}
```

**Current direct read gap** from `src/main/adapters/fake-test/parse.ts` (lines 33-49):
```typescript
export async function* parseFakeTestArtifact(
  artifact: RawArtifactRef
): AsyncIterable<FakeRawEvent> {
  let fixtureText: string;

  try {
    fixtureText = await readFile(artifact.path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown read error";
    yield buildParseDiagnosticEvent(artifact, "read", `Unable to read fake fixture artifact: ${message}`, artifact.nativeId);
    return;
  }
```

**Planner notes:** safe filesystem should live under shared core, canonicalize real paths, reject traversal/symlink escape, and expose only scoped helper methods through `AdapterContext`. Adapter files should stop importing `node:fs/promises` for source-root reads.

---

### Scanner, Raw Artifact Index, and Normalization Validator

**Applies to:** `src/main/core/ingestion/scanner.ts`, `src/main/core/ingestion/raw-artifact-index.ts`, `src/main/core/ingestion/normalization-validator.ts`

**Analog:** `src/main/app/session-view-model-service.ts`, `tests/contract/run-adapter-contract.ts`

**Existing lifecycle to extract** from `src/main/app/session-view-model-service.ts` (lines 53-83):
```typescript
async function loadFakeNormalizedData(): Promise<AdapterNormalizationResult> {
  const adapter = registry.require("fake-test");
  const context = {
    projectDir: process.cwd(),
    platform: process.platform
  };
  const validation = await adapter.validateSourceRoot({ rootPath: fakeFixturePath }, context);

  if (!validation.ok) {
    throw new Error("Fake session fixture failed source validation.");
  }

  const [source] = await collectAsync(adapter.discoverSources({ rootPath: fakeFixturePath }, context));
  const artifacts = await collectAsync(adapter.discoverArtifacts(source, context));
  const rawEvents = await collectRawEvents(adapter.parseArtifact, artifacts, context);

  return adapter.normalize({ source, artifacts, rawEvents }, context);
}
```

**Async collection helpers** (lines 120-145):
```typescript
async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}
```

**Reusable scanner test lifecycle** from `tests/contract/run-adapter-contract.ts` (lines 389-425):
```typescript
export async function exerciseAdapter<TRawEvent extends RawHarnessEvent>(
  adapter: SessionSourceAdapter<TRawEvent>,
  root: SourceRootConfig | string,
  context: AdapterContext = createAdapterTestContext()
): Promise<ExercisedAdapter<TRawEvent>> {
  const resolvedRoot = toSourceRootConfig(root);
  const validation = await adapter.validateSourceRoot(resolvedRoot, context);
  const sources = await collectAsync(adapter.discoverSources(resolvedRoot, context));
  const source = sources[0];
  const artifacts = await collectAsync(adapter.discoverArtifacts(source, context));
  const rawEvents = (
    await Promise.all(artifacts.map((artifact) => collectAsync(adapter.parseArtifact(artifact, context))))
  ).flat();
  const normalized = await adapter.normalize({ source, artifacts, rawEvents }, context);

  return { context, root: resolvedRoot, validation, sources, source, artifacts, rawEvents, normalized };
}
```

**Normalization relationship checks** from `tests/contract/run-adapter-contract.ts` (lines 226-253, 503-555):
```typescript
function assertNormalizedRelationships(result: AdapterNormalizationResult) {
  const projectIds = new Set(result.projects.map((project) => project.id));
  const sessionIds = new Set(result.sessions.map((session) => session.id));

  for (const project of result.projects) {
    expect(project.kind).toBe("project");
    expect(project.adapterId).toBe(result.adapterId);
    expect(project.sourceId).toBe(result.sourceId);
  }

  for (const session of result.sessions) {
    expect(session.kind).toBe("session");
    expect(session.adapterId).toBe(result.adapterId);
    expect(session.sourceId).toBe(result.sourceId);
    if (session.projectId !== undefined) {
      expect(projectIds.has(session.projectId)).toBe(true);
    }
  }
}
```

**Planner notes:** scanner owns validation/discovery/parse/normalize ordering, changed-artifact decisions, normalization validation, diagnostics, and cache writes. It should diagnose malformed output before merge/cache, not ask adapters for final audit conclusions.

---

### Cache Keys and Deterministic IDs

**Applies to:** `src/main/core/cache/cache-keys.ts`, `src/main/core/cache/file-backed-cache-store.ts`, `src/main/core/ingestion/raw-artifact-index.ts`

**Analog:** `src/main/core/model/identifiers.ts`

**Stable identity pattern** (lines 29-49):
```typescript
export interface StableIdentityParts {
  adapterId: AdapterId;
  nativeId: string;
  sourceId?: SourceId;
}

function hashStableParts(parts: ReadonlyArray<string>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function buildStableId(kind: StableEntityKind, parts: StableIdentityParts): string {
  const tokens = [kind, parts.adapterId];

  if (parts.sourceId) {
    tokens.push(parts.sourceId);
  }

  tokens.push(parts.nativeId);
  return `${kind}_${hashStableParts(tokens)}`;
}
```

**ID helper pattern** (lines 51-92):
```typescript
export function createSourceId(adapterId: AdapterId, nativeId: string): SourceId {
  return buildStableId("source", { adapterId, nativeId });
}

export function createSessionId(parts: StableIdentityParts): SessionId {
  return buildStableId("session", parts);
}

export function createRawArtifactId(parts: StableIdentityParts): RawArtifactId {
  return buildStableId("raw-artifact", parts);
}
```

**Planner notes:** cache/index keys must include adapter identity, source identity, artifact/native identity, size, mtime, inode where available, parser version, adapter version, schema version, and diagnostics hash. File-backed cache store has no exact analog; keep the hashing pattern but do not reuse entity ID prefixes for cache records if that would blur model identity and cache identity.

---

### Diagnostics and Capability Truth

**Applies to:** all source registry, scanner, cache, IPC, and UI DTO files.

**Analog:** `src/main/core/model/capabilities.ts`, `src/main/core/diagnostics/diagnostic.ts`

**Capability state model** from `src/main/core/model/capabilities.ts` (lines 3-10, 34-46):
```typescript
export type CapabilityStatus = "supported" | "unsupported" | "unknown";

export interface CapabilityState {
  status: CapabilityStatus;
  reason?: string;
  details?: string;
}

export const UNKNOWN_CAPABILITY_STATE: CapabilityState = { status: "unknown" };

export function capabilityState(status: CapabilityStatus, reason?: string, details?: string): CapabilityState {
  return {
    status,
    ...(reason ? { reason } : {}),
    ...(details ? { details } : {})
  };
}
```

**Diagnostic builder pattern** from `src/main/core/diagnostics/diagnostic.ts` (lines 35-67):
```typescript
export function buildDiagnostic(
  adapterId: AdapterId,
  code: string,
  message: string,
  severity: DiagnosticSeverity,
  scope: DiagnosticScope,
  confidence: ConfidenceScore,
  options: { sourceId?: SourceId; nativeId?: string; relatedEntityIds?: string[]; metadata?: Record<string, DiagnosticMetadataValue>; } = {}
): Diagnostic {
  const idParts = {
    adapterId,
    nativeId: options.nativeId ?? code,
    ...(options.sourceId ? { sourceId: options.sourceId } : {})
  };

  return {
    id: createDiagnosticId(idParts),
    code,
    message,
    severity,
    scope,
    adapterId,
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    confidence
  };
}
```

**Planner notes:** extend diagnostic scope only if needed for `cache` or `normalization`; otherwise map cache/normalization diagnostics through existing scopes plus metadata. UI labels must preserve Unsupported, Unknown, Stale, Failed, Never Scanned, and diagnostics-bearing states.

---

### Data Sources View Model Service

**Applies to:** `src/main/app/data-sources-view-model-service.ts`, `src/main/app/session-view-model-service.ts`

**Analog:** `src/main/app/session-view-model-service.ts`

**Service interface pattern** (lines 44-48):
```typescript
export interface SessionViewModelService {
  getShellState(): ShellStateViewModel;
  listSessions(): Promise<SessionSummaryViewModel[]>;
  getSessionById(request: GetSessionByIdRequest): Promise<SessionPreviewViewModel | null>;
}
```

**DTO parse before returning** (lines 86-116):
```typescript
return {
  getShellState() {
    return shellStateViewModelSchema.parse({
      appName: "Agent Workbench",
      readOnly: true,
      allowedOperations: ALLOWED_IPC_CHANNELS,
      adapters: registry.listDescriptors().map((descriptor) => ({
        adapterId: descriptor.id,
        displayName: descriptor.displayName
      }))
    });
  },

  async listSessions() {
    const normalized = await loadFakeNormalizedData();
    return normalized.sessions.map((session) =>
      sessionSummaryViewModelSchema.parse(toSessionSummary(normalized, session.id))
    );
  }
};
```

**Capability label mapping** (lines 217-225):
```typescript
function toCapabilityLabel(status: CapabilityState["status"]): CapabilityBadgeLabel {
  switch (status) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}
```

**Planner notes:** create a separate data-sources service instead of growing fake fixture loading. It should assemble sanitized source DTOs from registry, adapter descriptors, scanner/cache summaries, and diagnostics.

---

### IPC Channels, DTOs, and Handlers

**Applies to:** `src/main/ipc/channels.ts`, `src/main/ipc/view-models.ts`, `src/main/ipc/handlers.ts`, `tests/main/ipc/data-sources-ipc.test.ts`

**Analog:** current IPC files and tests.

**Channel allowlist pattern** from `src/main/ipc/channels.ts` (lines 1-13):
```typescript
export const IPC_CHANNELS = {
  getShellState: "app:getShellState",
  listSessions: "sessions:list",
  getSessionById: "sessions:getById"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ALLOWED_IPC_CHANNELS = [
  IPC_CHANNELS.getShellState,
  IPC_CHANNELS.listSessions,
  IPC_CHANNELS.getSessionById
] as const satisfies readonly IpcChannel[];
```

**Zod strict DTO pattern** from `src/main/ipc/view-models.ts` (lines 28-34, 100-113):
```typescript
export const sanitizedErrorViewModelSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export const listSessionsResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), sessions: z.array(sessionSummaryViewModelSchema) }).strict(),
  z.object({ ok: z.literal(false), error: sanitizedErrorViewModelSchema }).strict()
]);
```

**Handler validation and sanitized failure pattern** from `src/main/ipc/handlers.ts` (lines 41-59, 82-99):
```typescript
ipcMain.handle(IPC_CHANNELS.listSessions, async (_event, payload) => {
  const request = listSessionsRequestSchema.safeParse(payload ?? {});

  if (!request.success) {
    return buildInvalidRequestError();
  }

  try {
    const sessions = (await service.listSessions()).filter(
      (session) => !request.data.adapterId || session.adapterId === request.data.adapterId
    );
    return listSessionsResponseSchema.parse({ ok: true, sessions });
  } catch {
    return buildSessionLoadFailedError();
  }
});
```

**IPC test pattern** from `tests/main/ipc/ipc-handlers.test.ts` (lines 14-23, 26-40):
```typescript
it("registers only the allowed IPC channels", () => {
  const collector = createIpcCollector();
  registerIpcHandlers(collector, createFakeService());

  expect([...collector.handlers.keys()]).toEqual([
    IPC_CHANNELS.getShellState,
    IPC_CHANNELS.listSessions,
    IPC_CHANNELS.getSessionById
  ]);
});

it("returns sanitized invalid-request errors for bad get-by-id payloads", async () => {
  const result = await collector.invoke(IPC_CHANNELS.getSessionById, { sessionId: "" });
  expect(result).toEqual({ ok: false, error: { code: "invalid-request", message: "Request payload is not valid for this operation." } });
  expect(JSON.stringify(result)).not.toMatch(/stack|\/Users|adapter|rawEvents/u);
});
```

**Planner notes:** add one named channel per data-source operation, likely `sources:list`, `sources:add`, `sources:update`, `sources:setEnabled`, `sources:validate`, `sources:scan`, and keep adapter list in shell/data-source DTOs. Never add generic filesystem or invoke channels.

---

### Preload Bridge

**Applies to:** `src/preload/index.ts`, `src/preload/types.ts`, `tests/preload/preload-api-surface.test.ts`

**Analog:** current preload files and preload API test.

**Bridge method pattern** from `src/preload/index.ts` (lines 7-19):
```typescript
const agentWorkbench: AgentWorkbenchBridge = Object.freeze({
  getShellState() {
    return ipcRenderer.invoke(IPC_CHANNELS.getShellState);
  },
  listSessions(request: ListSessionsRequest = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.listSessions, request);
  },
  getSessionById(request: GetSessionByIdRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.getSessionById, request);
  }
});

contextBridge.exposeInMainWorld("agentWorkbench", agentWorkbench);
```

**Public bridge type pattern** from `src/preload/types.ts` (lines 1-13):
```typescript
import type {
  GetSessionByIdRequest,
  GetSessionByIdResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ShellStateViewModel
} from "../main/ipc/view-models.js";

export interface AgentWorkbenchBridge {
  getShellState(): Promise<ShellStateViewModel>;
  listSessions(request?: ListSessionsRequest): Promise<ListSessionsResponse>;
  getSessionById(request: GetSessionByIdRequest): Promise<GetSessionByIdResponse>;
}
```

**API-surface guardrail** from `tests/preload/preload-api-surface.test.ts` (lines 8-35):
```typescript
it("declares exactly one public method per allowed operation", async () => {
  const typesSource = await readFile("src/preload/types.ts", "utf8");
  expect(extractBridgeMethodNames(typesSource)).toEqual([
    "getShellState",
    "listSessions",
    "getSessionById"
  ]);
  expect(findForbiddenPublicNames(typesSource)).toEqual([]);
});

it("exposes the typed bridge name without a generic helper", async () => {
  const preloadSource = await readFile("src/preload/index.ts", "utf8");
  expect(preloadSource).toContain('contextBridge.exposeInMainWorld("agentWorkbench"');
  expect(preloadSource).not.toMatch(/\b(?:fs|child_process|shell)\b/u);
});
```

**Planner notes:** extend with named methods only. Keep `ipcRenderer.invoke` private inside method bodies and update tests to include exact public method names.

---

### Renderer Route, Shell, and Components

**Applies to:** `src/renderer/App.tsx`, `src/renderer/components/AppShell.tsx`, `src/renderer/routes/DataSourcesRoute.tsx`, `src/renderer/components/DataSourceList.tsx`, `src/renderer/components/DataSourceDetail.tsx`, `src/renderer/components/SourceStatusBadge.tsx`, `src/renderer/components/DataSourcesLoadingSkeleton.tsx`, `tests/renderer/data-sources-route.test.tsx`

**Analog:** `src/renderer/routes/SessionsRoute.tsx`, `src/renderer/components/AppShell.tsx`, `src/renderer/components/LoadingSkeleton.tsx`, `tests/renderer/sessions-route.test.tsx`

**Route wiring pattern** from `src/renderer/App.tsx` (lines 1-14):
```tsx
import { HashRouter, Navigate, Route, Routes } from "react-router";

export function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsRoute />} />
          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
```

**Navigation pattern** from `src/renderer/components/AppShell.tsx` (lines 15-57):
```tsx
const disabledNavigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Projects", icon: FolderKanban },
  { label: "Diagnostics", icon: AlertCircle }
] as const;

<span className="nav-item nav-item-disabled" aria-disabled="true" title="Available in a later phase">
  <item.icon size={18} aria-hidden="true" />
  {item.label}
</span>

<NavLink className="nav-item nav-item-active" to="/sessions">
  <Activity size={18} aria-hidden="true" />
  Sessions
</NavLink>
```

**Preload-driven loading and sanitized error pattern** from `src/renderer/routes/SessionsRoute.tsx` (lines 30-57, 126-150):
```tsx
const loadSessions = useCallback(async () => {
  setIsListLoading(true);
  setLoadFailed(false);

  try {
    const response = await window.agentWorkbench.listSessions();

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    setSessions(response.sessions);
  } catch {
    setSessions([]);
    setSelectedSessionId(null);
    setSelectedPreview(null);
    setLoadFailed(true);
  } finally {
    setIsListLoading(false);
  }
}, []);
```

**Split list/detail render pattern** from `src/renderer/routes/SessionsRoute.tsx` (lines 139-149):
```tsx
<section className="sessions-grid" aria-label="Sessions route">
  <SessionList
    focusedIndex={selectedIndex >= 0 ? focusedIndex : 0}
    onFocusIndexChange={changeFocusIndex}
    onSelect={selectSession}
    selectedSessionId={selectedSessionId}
    sessions={sessions}
  />
  <SessionPreview session={selectedPreview} isLoading={isPreviewLoading} />
</section>
```

**Skeleton pattern** from `src/renderer/components/LoadingSkeleton.tsx` (lines 1-23):
```tsx
export function LoadingSkeleton() {
  return (
    <section className="sessions-grid" aria-label="Sessions loading">
      <div className="session-list" aria-label="Loading session summaries">
        {[0, 1, 2].map((index) => (
          <div className="session-row skeleton-row" key={index}>
            <div className="skeleton-copy">
              <span className="skeleton-line skeleton-line-title" />
              <span className="skeleton-line skeleton-line-meta" />
            </div>
            <span className="skeleton-pill" />
          </div>
        ))}
      </div>
    </section>
  );
}
```

**Renderer test pattern** from `tests/renderer/sessions-route.test.tsx` (lines 90-107, 162-191):
```tsx
it("renders the Sessions-first shell and loads summaries through the preload bridge", async () => {
  render(<App />);
  expect(screen.getByText("Overview").closest("[aria-disabled='true']")).not.toBeNull();
  expect(screen.getAllByTitle("Available in a later phase")).toHaveLength(3);
  await screen.findByRole("button", { name: /Fixture import session/u });
  expect(listSessions).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
});

it("renders the exact sanitized error copy without leaking raw details", async () => {
  listSessions.mockResolvedValueOnce({ ok: false, error: { code: "sessions.list.failed", message: "Internal raw path /tmp/private/fixture.json" } });
  render(<App />);
  expect(await screen.findByText("Sessions could not load. Check the preload bridge and IPC handler, then reload sessions.")).toBeInTheDocument();
  expect(screen.queryByText(/\/tmp\/private/u)).not.toBeInTheDocument();
});
```

**Planner notes:** Data Sources route should copy the route state machine but use UI-SPEC copy exactly. It must keep typed path entry only, explicit validate then scan, keyboard row selection, selected-source preservation after reload, and exact Unsupported/Unknown labels.

---

### Boundary Tests

**Applies to:** `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`, `tests/renderer/renderer-boundary-source.test.ts`

**Analog:** existing boundary tests.

**Import boundary rules** from `tests/boundaries/import-boundaries.test.ts` (lines 139-182):
```typescript
if (sourceKind.type === "core" && targetKind.type === "adapter") {
  if (
    allowedCoreAdapterEntrypoints.has(sourceLogicalPath) &&
    path.posix.basename(targetLogicalPath) === "index.ts"
  ) {
    continue;
  }

  violations.push({
    reason:
      "Shared core can only import bundled adapter entrypoints from the registry composition root."
  });
}

if (sourceKind.type === "renderer" && (targetKind.type === "core" || targetKind.type === "main")) {
  violations.push({
    reason: "Renderer code must not import main-process internals."
  });
}
```

**Harness-neutral naming checks** from `tests/boundaries/shared-naming.test.ts` (lines 25-63, 107-128):
```typescript
it("keeps shared core and renderer free of Gemini-specific symbols and provider branches", async () => {
  const sources = await loadTypeScriptSources(sharedRoots);

  expect(findGeminiSymbolViolations(sources)).toEqual([]);
  expect(findGeminiProviderBranchViolations(sources)).toEqual([]);
});

function findGeminiProviderBranchViolations(sources: SourceText[]): TextViolation[] {
  return collectViolations(
    sources,
    /(?:[A-Za-z0-9_.\])]+\s*(?:===|!==|==|!=)\s*["']gemini-cli["']|case\s+["']gemini-cli["'])/gu,
    "Shared core and renderer must not branch on Gemini provider IDs."
  );
}
```

**Renderer source safety checks** from `tests/renderer/renderer-boundary-source.test.ts` (lines 15-27, 29-67):
```typescript
const forbiddenControlPatterns = [
  /\bLaunch\b/u,
  /\bApprove\b/u,
  /\bReject\b/u,
  /\bTerminal\b/u,
  /\bCreate PR\b/u,
  /\bCleanup\b/u,
  /\bDelete\b/u,
  /\bReset\b/u,
  /\bRun command\b/u
] as const;

it("contains no V1 mutation or terminal-control labels", async () => {
  const sources = await loadRendererSources();
  const violations = sources.flatMap((source) =>
    forbiddenControlPatterns
      .filter((pattern) => pattern.test(source.text))
      .map((pattern) => ({ file: source.file, pattern: String(pattern) }))
  );

  expect(violations).toEqual([]);
});
```

**Planner notes:** update these tests when adding `/data-sources` so renderer stays free of main/adapter imports, provider branches, mutation labels, raw filesystem APIs, and conclusion fields.

## Shared Patterns

### Harness-Neutral Ownership

**Source:** `AGENTS.md`, `tests/boundaries/import-boundaries.test.ts`, `tests/boundaries/shared-naming.test.ts`  
**Apply to:** all shared core, IPC, preload, and renderer files.

Shared core can own source registry, scanner, cache, watcher, diagnostics, and IPC view models. Adapter-private files own harness-specific parsing only. Renderer consumes typed IPC view models and must not import `src/main/**` or adapter-private modules except preload type imports already used by the bridge.

### Request Validation and Sanitized Errors

**Source:** `src/main/ipc/handlers.ts` lines 41-59 and 82-99  
**Apply to:** all new data-source IPC handlers.

Use `schema.safeParse(payload ?? {})`; return `{ ok: false, error: { code: "invalid-request", message: "Request payload is not valid for this operation." } }` on request failure; catch service exceptions and return operation-specific sanitized failures without stack traces, raw paths, raw events, or adapter-private details.

### Runtime DTO Validation

**Source:** `src/main/ipc/view-models.ts` lines 1-13, 28-34, 100-113  
**Apply to:** source list/detail DTOs, add/update requests, validate/scan responses, cache summaries, diagnostics DTOs.

Use Zod `.strict()` objects and discriminated `ok` unions. Keep user-facing enums explicit: `Not Validated`, `Validating`, `Valid`, `Validation Failed`, `Never Scanned`, `Scanning`, `Scan Failed`, `Scanned with Diagnostics`, `Cached`, `Stale`, `Unsupported`, `Unknown`, `Watch Supported`, `Watch Unsupported`, `Watch Unknown`.

### One Method Per Preload Operation

**Source:** `src/preload/index.ts` lines 7-19, `tests/preload/preload-api-surface.test.ts` lines 8-35  
**Apply to:** every new renderer operation.

Add named methods such as `listDataSources`, `addDataSource`, `updateDataSource`, `setDataSourceEnabled`, `validateDataSource`, and `scanDataSource`. Do not expose generic `invoke`, `send`, `on`, `removeListener`, `fs`, `child_process`, `shell`, or arbitrary path read APIs.

### Stable Adapter/Source Identity

**Source:** `src/main/core/model/identifiers.ts` lines 29-49 and 51-92  
**Apply to:** source registry IDs, raw artifact index IDs, cache keys, normalized cache records.

Build every persistent identity from adapter ID plus source ID where relevant. Do not key cache or normalized data only by native session ID, artifact path, or display name.

### Explicit Unknown and Unsupported Truth

**Source:** `src/main/core/model/capabilities.ts` lines 3-10 and 34-46; `tests/renderer/sessions-route.test.tsx` lines 182-191  
**Apply to:** data-source row badges, detail summaries, watch support, cache status, validation status, diagnostics count.

Never flatten unsupported, unknown, stale, failed, diagnostics-bearing, or never-scanned states into `0`, `Passed`, `Clean`, or hidden UI. Successful/cached states should still use explicit labels.

### UI Layout and Copy

**Source:** `03-UI-SPEC.md` lines 88-174 and 176-211  
**Apply to:** `DataSourcesRoute.tsx` and child components.

Use split list/detail layout, typed path entry, exact copy labels, disabled nav tooltip `Available in a later phase`, no native picker, no launch/approve/reject/terminal/PR/cleanup/delete/reset/clear-cache controls, and no full Diagnostics route.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/main/core/security/path-allowlist.ts` | utility | file-I/O | No existing safe path allowlist or canonical realpath guard exists. Planner should use Node `path`/`fs.realpath` primitives and tests. |
| `src/main/core/security/safe-filesystem.ts` | service | file-I/O | Existing adapter direct `stat`/`readFile` calls are inverse examples, not safe analogs. |
| `src/main/core/cache/file-backed-cache-store.ts` | service | file-I/O, CRUD | No existing file-backed JSON store in the codebase. Use injected app-data/test temp directory, Zod validation, deterministic writes. |
| `src/main/core/watcher/watch-orchestrator.ts` | service | event-driven | No watcher lifecycle exists. Phase 3 should add only minimal shared-core boundary and support truth, not full live controls. |
| `tests/main/core/safe-filesystem.test.ts` | test | file-I/O | No existing filesystem security test. Cover traversal, symlink escape, disabled source, and unindexed artifact rejection. |

## Metadata

**Analog search scope:** `src/main/core/**`, `src/main/app/**`, `src/main/ipc/**`, `src/preload/**`, `src/renderer/**`, `tests/boundaries/**`, `tests/main/ipc/**`, `tests/preload/**`, `tests/renderer/**`, plus fake adapter gap files.  
**Files scanned:** 56 source/test files under the primary code/test trees.  
**Dirty worktree respected:** existing dirty files were read only; no source files were modified.  
**Pattern extraction date:** 2026-05-23
