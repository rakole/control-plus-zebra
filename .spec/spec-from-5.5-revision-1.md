Yes — this is the right correction. The previous spec accidentally made “Gemini CLI” the architecture, when it should only be the first **session-source adapter**. Below is the revised architecture/spec delta that should replace the Gemini-hardcoded parts.

The product should be renamed conceptually from **Gemini Workbench** to something harness-neutral such as **Agent Workbench**, **Harness Workbench**, or **Coding Agent Workbench**. The uploaded prompt originally framed the app around “Gemini Workbench” and a Gemini-specific data root, while also requiring a local-first Electron/Vite/React app and normalized parsing/observability stack.  The revised architecture keeps that stack, but moves all Gemini assumptions behind a `gemini-cli` adapter.

# Revised Core Decision

The app is a **local-first coding-harness observability and audit platform**.

Gemini CLI is only the first supported harness.

Adding a future harness, such as `xyz`, must require:

1. Creating `src/main/adapters/xyz/`.
2. Implementing the shared adapter contract.
3. Adding fixtures and adapter contract tests.
4. Registering the adapter descriptor.

It must **not** require editing:

* `gemini-cli` adapter code.
* Shared shell parsing.
* Shared verification logic.
* Shared run audit engine.
* Git/GitHub providers.
* Cache/indexing logic.
* UI pages.
* IPC contracts, except where a new general capability needs to be added.

# 1. Terminology Changes

Replace Gemini-specific product vocabulary with harness-neutral vocabulary.

| Old Term              | New Shared-Core Term                   | Notes                                                |
| --------------------- | -------------------------------------- | ---------------------------------------------------- |
| Gemini Workbench      | Agent Workbench / Harness Workbench    | Product name should not bind to Gemini.              |
| Gemini data root      | Harness source root                    | A configured root for one adapter.                   |
| Gemini project folder | Harness project source                 | Adapter-discovered source tied to a repo/project.    |
| Gemini session        | Agent session / harness session        | Shared model uses `Session`.                         |
| Gemini message        | Assistant message / session message    | Shared core uses `SessionMessage`.                   |
| Gemini event          | `SessionEvent` / `NormalizedEvent`     | No `GeminiEvent` in core.                            |
| Gemini JSONL parser   | `gemini-cli` adapter parser            | Adapter-private implementation.                      |
| Gemini tool call      | `ToolCall`                             | Shared core uses normalized tool calls.              |
| Gemini sidecar        | `ToolOutputArtifact` / `SidecarOutput` | Adapter maps raw sidecars to normalized output refs. |
| Gemini root setting   | Data Sources / Harnesses settings      | UI lists all configured adapters.                    |

The shared core may show provider-specific labels in the UI, but only through adapter metadata. For example, the Session Detail page may display “Gemini CLI” as a badge because the session’s `adapterId` is `gemini-cli`, not because the page is Gemini-specific.

# 2. Revised Product Summary

**Agent Workbench** is a standalone macOS desktop app for observing, replaying, and auditing local coding-agent sessions across multiple CLI harnesses.

V1 supports:

* `gemini-cli` adapter.
* Harness-neutral project/session dashboards.
* Session replay.
* Tool/file/shell activity.
* Verification classification.
* Run audit.
* Git context.
* Optional GitHub PR context.
* Export/import.
* Local-only privacy model.

The original Gemini files remain important as the first adapter fixture: observed Gemini data includes `.project_root`, `logs.json`, `chats/session-*.jsonl`, `tool-outputs/session-<uuid>/*.txt`, sparse `shell_history`, and parser hazards such as duplicate records, JSON/plain text sidecars, shell exit-code parsing, active-file mutation, and cancellation events.

# 3. Architecture Boundary

## Shared Core Owns

The shared core owns everything that should apply to all harnesses:

* Normalized data model.
* Adapter contract.
* Adapter registry.
* Source registry.
* Cache/indexing.
* File watcher orchestration.
* Shell command parsing.
* Shell exit-code parsing.
* Verification classification.
* Run audit engine.
* Status classification.
* Git provider.
* GitHub provider.
* Export/import.
* IPC API.
* UI pages and view models.
* Privacy/security policy.
* Cross-adapter search/filter/sort.
* Contract test harness.

## Harness Adapters Own

Each harness adapter owns only harness-specific concerns:

* Default source-root discovery.
* Source-root validation.
* Raw file/artifact discovery.
* Raw log parsing.
* Harness-specific sidecar parsing.
* Raw-to-normalized mapping.
* Harness-specific dedupe rules.
* Harness-specific active-session evidence, if available.
* Fixture set.
* Adapter contract tests.
* Capability declaration.

## Hard Boundary Rule

Shared core must not import adapter internals.

Allowed dependency direction:

```text
adapters/*  -> core/adapter-contract
adapters/*  -> core/model
adapters/*  -> core/diagnostics

core/*      -> no imports from adapters/*
renderer/*  -> no imports from adapters/*
composition root / adapter-registry -> imports adapter entrypoints only
```

Use lint rules or TypeScript project references to enforce this.

# 4. Revised Technical Architecture

```text
Electron Main Process
├─ Adapter Registry
│  ├─ gemini-cli adapter
│  └─ future xyz adapter
├─ Source Registry
├─ Scanner / Indexer
├─ Watcher Orchestrator
├─ Normalized Store
├─ Cache Layer
├─ Shell Parser
├─ Verification Engine
├─ Run Audit Engine
├─ Git Provider
├─ GitHub Provider
├─ Export / Import
└─ IPC Handlers

Preload
└─ Narrow typed bridge, no raw filesystem or shell access

React Renderer
├─ Overview
├─ Projects
├─ Sessions
├─ Session Detail
├─ Run Audit
├─ Harnesses / Data Sources Settings
└─ Diagnostics
```

The renderer should not know that Gemini uses `logs.json` or `chats/*.jsonl`. It receives normalized sessions, events, tool calls, shell commands, files, diagnostics, and capability flags.

# 5. Adapter Contract

Use one public shared interface. The exact TypeScript can change, but the contract should look like this conceptually:

```ts
type HarnessId = string;

interface HarnessDescriptor {
  id: HarnessId;                 // "gemini-cli", "xyz"
  displayName: string;           // "Gemini CLI", "XYZ"
  vendor?: string;               // "Google", "Internal", etc.
  adapterVersion: string;
  supportedPlatforms: Array<"darwin" | "linux" | "win32">;
  defaultRoots: SourceRootHint[];
  capabilities: HarnessCapabilities;
}

interface SessionSourceAdapter {
  descriptor: HarnessDescriptor;

  getDefaultSourceRoots(ctx: AdapterContext): Promise<SourceRootHint[]>;

  validateSourceRoot(
    root: SourceRootConfig,
    ctx: AdapterContext
  ): Promise<SourceRootValidation>;

  discoverSources(
    root: SourceRootConfig,
    ctx: AdapterContext
  ): AsyncIterable<DiscoveredHarnessSource>;

  discoverArtifacts(
    source: DiscoveredHarnessSource,
    ctx: AdapterContext
  ): AsyncIterable<RawArtifactRef>;

  parseArtifact(
    artifact: RawArtifactRef,
    ctx: AdapterContext
  ): AsyncIterable<RawHarnessEvent>;

  normalize(
    input: AdapterNormalizationInput,
    ctx: AdapterContext
  ): Promise<AdapterNormalizationResult>;

  getWatchPlan(
    source: DiscoveredHarnessSource,
    ctx: AdapterContext
  ): Promise<WatchPlan>;

  loadOutputArtifact?(
    ref: OutputArtifactRef,
    ctx: AdapterContext
  ): Promise<LoadedOutputArtifact>;
}
```

The split is deliberate:

* `parseArtifact` converts raw files to adapter-private raw events.
* `normalize` maps adapter-private raw events into shared `Session`, `SessionEvent`, `ToolCall`, `FileMutation`, `ShellCommandEvidence`, and output artifact refs.
* The shared core validates normalized output and then applies shared shell parsing, verification, run audit, git, GitHub, cache, and UI logic.

## Adapter Context

```ts
interface AdapterContext {
  appVersion: string;
  adapterRegistryVersion: string;
  now: string;
  platform: NodeJS.Platform;
  allowedRoots: string[];
  logger: DiagnosticLogger;
  readFile: SafeReadFile;
  statFile: SafeStatFile;
  createReadStream: SafeReadStream;
}
```

Adapters do not get unrestricted filesystem access. They receive safe filesystem helpers scoped to configured source roots.

# 6. Capability Model

Capabilities are mandatory. The UI must not guess.

```ts
interface HarnessCapabilities {
  discovery: {
    defaultRoots: boolean;
    projectRootMapping: "native" | "inferred" | "none";
    stableProjectId: boolean;
    stableSessionId: boolean;
  };

  replay: {
    transcriptReplay: boolean;
    messageRoles: boolean;
    assistantMessages: boolean;
    lifecycleEvents: boolean;
    cancellationEvents: boolean;
    topicEvents: boolean;
    rawEventPointers: boolean;
  };

  tools: {
    toolCalls: boolean;
    toolResults: boolean;
    fileReads: boolean;
    fileSearches: boolean;
    fileMutations: boolean;
    diffStats: boolean;
    shellCommands: boolean;
    shellOutputs: boolean;
    sidecarOutputs: boolean;
  };

  usage: {
    modelNames: boolean;
    tokenCounts: boolean;
    costEstimates: boolean;
  };

  live: {
    activeSessionDetection: "mtime" | "process" | "hook" | "native" | "none";
    watchableArtifacts: boolean;
    incrementalParsing: boolean;
  };

  audit: {
    agentClaimDetection: boolean;
    finalAnswerDetection: boolean;
    shellExitCodeEvidence: boolean;
    verificationCommandEvidence: boolean;
  };

  export: {
    rawArtifactExport: boolean;
    normalizedExport: boolean;
  };
}
```

## UI Gating Rules

* If `tokenCounts=false`, hide token charts or show “not supported by this harness.”
* If `shellCommands=false`, hide command-count columns for that harness.
* If `fileMutations=false`, show “file mutation evidence unavailable,” not zero mutations.
* If `activeSessionDetection=mtime`, label active status as inferred.
* If `projectRootMapping=inferred`, show lower confidence on project/git context.
* If `sidecarOutputs=false`, do not render a sidecar loading button.

Capabilities can exist at three levels:

1. Adapter-level defaults.
2. Source-level overrides.
3. Session-level observed capabilities.

Example: `gemini-cli` may generally support token counts, but one corrupt or partial session may have no token evidence.

# 7. Revised Data Model

No shared type should be named `GeminiEvent`.

## Core Identity Types

```ts
type HarnessId = string;          // "gemini-cli", "xyz"
type SourceId = string;           // stable per configured root/source
type ProjectId = string;          // stable normalized project identity
type SessionId = string;          // stable global session id
type NativeId = string;           // adapter-native id
type Confidence = "confirmed" | "observed" | "inferred" | "unknown";
```

## Harness Source

```ts
interface HarnessSource {
  id: SourceId;
  adapterId: HarnessId;
  rootPath: string;
  displayName: string;
  sourceKind: "local-root" | "imported-archive" | "manual" | "unknown";
  enabled: boolean;
  validation: SourceRootValidation;
  capabilities: HarnessCapabilities;
  lastScannedAt?: string;
  diagnostics: Diagnostic[];
}
```

## Project

```ts
interface Project {
  id: ProjectId;
  displayName: string;

  primaryRootPath?: string;
  rootConfidence: Confidence;

  harnessRefs: ProjectHarnessRef[];
  sessionIds: SessionId[];

  latestActivityAt?: string;
  latestPrompt?: string;
  latestVerificationState?: VerificationState;

  gitSnapshot?: GitSnapshot;
  githubSnapshot?: GitHubSnapshot;

  diagnostics: Diagnostic[];
}
```

```ts
interface ProjectHarnessRef {
  adapterId: HarnessId;
  sourceId: SourceId;
  nativeProjectId?: NativeId;
  nativeProjectPath?: string;
  projectRootPath?: string;
  projectRootConfidence: Confidence;
  rawArtifactRefs: RawArtifactRef[];
}
```

## Session

```ts
interface Session {
  id: SessionId;
  adapterId: HarnessId;
  sourceId: SourceId;

  nativeSessionId?: NativeId;
  projectId?: ProjectId;

  title?: string;
  firstUserPrompt?: string;
  latestUserPrompt?: string;

  startedAt?: string;
  lastUpdatedAt?: string;
  durationMs?: number;

  lifecycleStatus: LifecycleStatus;
  attentionReasons: AttentionReason[];

  capabilities: HarnessCapabilities;
  parseConfidence: Confidence;

  messageIds: string[];
  eventIds: string[];
  toolCallIds: string[];
  fileMutationIds: string[];
  shellCommandIds: string[];
  outputArtifactIds: string[];

  usage: UsageSummary;
  verification: VerificationResult;
  runAudit: RunAudit;

  rawArtifactRefs: RawArtifactRef[];
  diagnostics: Diagnostic[];
}
```

## Session Event

```ts
interface SessionEvent {
  id: string;
  sessionId: SessionId;
  adapterId: HarnessId;

  kind:
    | "message"
    | "tool-call"
    | "tool-result"
    | "file-event"
    | "shell-command"
    | "lifecycle"
    | "metadata"
    | "topic"
    | "raw-unknown";

  timestamp?: string;
  orderKey: EventOrderKey;

  actor?: "user" | "assistant" | "system" | "tool" | "harness" | "unknown";

  title?: string;
  text?: string;
  severity?: "info" | "warning" | "error";

  raw?: RawEventPointer;
  diagnostics: Diagnostic[];
}
```

## Session Message

```ts
interface SessionMessage {
  id: string;
  sessionId: SessionId;
  adapterId: HarnessId;

  role: "user" | "assistant" | "system" | "tool" | "unknown";
  timestamp?: string;

  text?: string;
  modelName?: string;
  usage?: UsageSummary;

  toolCallIds: string[];
  eventIds: string[];

  source: RawEventPointer;
  confidence: Confidence;
}
```

## Raw Harness Event

```ts
interface RawHarnessEvent {
  adapterId: HarnessId;
  sourceId: SourceId;
  nativeType?: string;
  nativeId?: string;
  timestamp?: string;
  raw: unknown;
  source: RawEventPointer;
  diagnostics: Diagnostic[];
}
```

This type is shared only as an opaque wrapper. Adapter-specific raw record types live inside the adapter folder, such as `GeminiCliRawRecord`, not in core.

## Tool Call

```ts
interface ToolCall {
  id: string;
  sessionId: SessionId;
  adapterId: HarnessId;

  nativeToolCallId?: NativeId;
  name: string;

  normalizedKind:
    | "read"
    | "search"
    | "write"
    | "replace"
    | "shell"
    | "topic"
    | "network"
    | "mcp"
    | "unknown";

  statusRaw?: string;
  statusNormalized?: "pending" | "completed" | "failed" | "unknown";

  argsPreview?: string;
  resultPreview?: string;

  outputArtifactIds: string[];
  fileMutationId?: string;
  shellCommandId?: string;

  source: RawEventPointer;
  confidence: Confidence;
  diagnostics: Diagnostic[];
}
```

## Shell Command Evidence

Adapters should emit shell command **evidence**, not final verification classifications.

```ts
interface ShellCommandEvidence {
  id: string;
  sessionId: SessionId;
  adapterId: HarnessId;

  toolCallId?: string;
  command?: string;
  cwd?: string;

  outputInline?: string;
  outputArtifactIds: string[];

  rawStatus?: string;
  rawExitCode?: number;

  source: RawEventPointer;
  confidence: Confidence;
}
```

The shared core turns this into a normalized `ShellCommand` by parsing command intent, exit codes, output summaries, failures, and test/build/lint/typecheck evidence.

## Shell Command

```ts
interface ShellCommand {
  id: string;
  sessionId: SessionId;
  adapterId: HarnessId;

  command: string;
  cwd?: string;

  intent:
    | "test"
    | "build"
    | "typecheck"
    | "lint"
    | "install"
    | "git"
    | "other"
    | "unknown";

  outputSource: "inline" | "artifact" | "both" | "missing";
  outputPreview?: string;

  exitCode?: number;
  failed: boolean;

  parsedFailures: ParsedFailure[];
  outputArtifactIds: string[];

  confidence: Confidence;
  diagnostics: Diagnostic[];
}
```

## Output Artifact

```ts
interface OutputArtifact {
  id: string;
  adapterId: HarnessId;
  sourceId: SourceId;
  sessionId?: SessionId;

  nativeRef?: string;
  path?: string;

  kind:
    | "sidecar"
    | "inline-large-output"
    | "raw-log"
    | "screenshot"
    | "unknown";

  contentKind:
    | "plain-text"
    | "json-output-wrapper"
    | "json"
    | "binary"
    | "unknown";

  sizeBytes?: number;
  mtime?: string;

  preview?: string;
  loaded: boolean;

  source: RawEventPointer;
  diagnostics: Diagnostic[];
}
```

## Verification and Run Audit

These remain fully shared.

```ts
type VerificationState = "not-run" | "passed" | "failed" | "mixed" | "unknown";

interface VerificationResult {
  state: VerificationState;
  commandsRun: number;
  verificationCommandsRun: number;

  buildRan: boolean;
  testsRan: boolean;
  typecheckRan: boolean;
  lintRan: boolean;

  failedCommandIds: string[];
  passedCommandIds: string[];

  failedTestsCount?: number;
  summary: string;

  confidence: Confidence;
  diagnostics: Diagnostic[];
}
```

```ts
interface RunAudit {
  sessionId: SessionId;
  adapterId: HarnessId;

  classification:
    | "clean"
    | "incomplete"
    | "cancelled"
    | "verification-failed"
    | "needs-review"
    | "unknown";

  agentClaimedCompleted: boolean | "unknown";
  finalAnswerPresent: boolean;
  requestCancelled: boolean;

  verificationCommandsRun: boolean;
  shellExitCodes: number[];

  failedTestsDetected: boolean;
  filesMutated: boolean;

  generatedOrUntrackedFiles?: boolean;
  gitDirty?: boolean;

  pendingToolCalls: boolean;

  reasons: AttentionReason[];
  confidence: Confidence;
}
```

# 8. Revised Folder Structure

```text
src/
  main/
    core/
      adapter-contract/
        SessionSourceAdapter.ts
        HarnessCapabilities.ts
        AdapterDiagnostics.ts

      model/
        Project.ts
        Session.ts
        SessionEvent.ts
        SessionMessage.ts
        ToolCall.ts
        OutputArtifact.ts
        FileMutation.ts
        ShellCommand.ts
        VerificationResult.ts
        RunAudit.ts
        DashboardStats.ts

      registry/
        adapterRegistry.ts
        sourceRegistry.ts

      ingestion/
        scanner.ts
        indexer.ts
        normalizationValidator.ts
        rawArtifactIndex.ts
        sessionMerger.ts

      watcher/
        watchOrchestrator.ts
        watchPlan.ts

      shell/
        shellCommandParser.ts
        shellExitCodeParser.ts
        shellIntentClassifier.ts
        testOutputParser.ts

      verification/
        verificationClassifier.ts

      audit/
        runAuditEngine.ts
        statusClassifier.ts

      git/
        gitProvider.ts

      github/
        githubCliProvider.ts

      cache/
        cacheStore.ts
        cacheKeys.ts
        cacheInvalidation.ts

      export/
        archiveExporter.ts
        archiveImporter.ts

      ipc/
        handlers.ts
        viewModels.ts

      security/
        pathAllowlist.ts
        redaction.ts
        commandRunner.ts

    adapters/
      gemini-cli/
        index.ts
        descriptor.ts
        capabilities.ts
        reader.ts
        discovery.ts
        parser/
          logsJsonParser.ts
          chatJsonlParser.ts
          sidecarParser.ts
          projectRootParser.ts
        mapper/
          toNormalizedSession.ts
          toNormalizedEvents.ts
          toToolCalls.ts
        fixtures/
          basic-session/
          shell-failure/
          cancellation/
          duplicate-records/
          sidecars/
        tests/
          geminiCliAdapter.contract.test.ts

      xyz/
        index.ts
        descriptor.ts
        capabilities.ts
        reader.ts
        parser/
        mapper/
        fixtures/
        tests/

  preload/
    api.ts

  renderer/
    app/
    pages/
      Overview.tsx
      Projects.tsx
      Sessions.tsx
      SessionDetail.tsx
      RunAudit.tsx
      HarnessesSettings.tsx
      Diagnostics.tsx
    components/
      HarnessBadge.tsx
      CapabilityGate.tsx
      StatusBadge.tsx
      SessionTimeline.tsx
      ToolCallCard.tsx
      ShellCommandCard.tsx
      OutputArtifactViewer.tsx
      GitBadge.tsx
      GitHubPrBadge.tsx
```

## Import Rules

```text
core/** may import:
  - core/**
  - shared types/libs

adapters/<id>/** may import:
  - core/adapter-contract/**
  - core/model/**
  - core/diagnostics/**

renderer/** may import:
  - IPC view models only
  - no adapter-private files

adapterRegistry.ts may import:
  - adapters/*/index
```

Adding `xyz` means adding a new folder and registering the adapter entrypoint. It must not require editing `src/main/adapters/gemini-cli/**`.

# 9. Gemini CLI Adapter Scope

The `gemini-cli` adapter owns all observed Gemini-specific details.

It should parse:

* `~/.gemini/tmp` as the default source root.
* Project-scoped folders.
* `.project_root`.
* `logs.json`.
* `chats/session-*.jsonl`.
* `tool-outputs/session-<uuid>/*.txt`.
* Sparse `shell_history` only as auxiliary or ignored evidence.

The observed parser notes explicitly say `.project_root`, `logs.json`, `chats/session-*.jsonl`, and `tool-outputs/session-<uuid>/*.txt` exist in the sampled Gemini temp directory, while `shell_history` is sparse and not a reliable transcript.

The adapter maps Gemini-specific records into shared core types:

| Gemini CLI Raw Item            | Shared Type                                           |
| ------------------------------ | ----------------------------------------------------- |
| Project folder under temp root | `DiscoveredHarnessSource`                             |
| `.project_root`                | `ProjectHarnessRef.projectRootPath`                   |
| `logs.json` user index         | `SessionMessage` discovery hints                      |
| Chat metadata record           | `Session` metadata                                    |
| `type: "user"`                 | `SessionMessage(role: "user")`                        |
| `type: "gemini"`               | `SessionMessage(role: "assistant")` and/or `ToolCall` |
| `type: "info"` cancellation    | `SessionEvent(kind: "lifecycle")`                     |
| `$set.lastUpdated`             | `SessionEvent(kind: "metadata")`                      |
| `toolCalls`                    | `ToolCall`                                            |
| `write_file` / `replace`       | `FileMutation`                                        |
| `run_shell_command`            | `ShellCommandEvidence`                                |
| `tool-outputs` sidecar         | `OutputArtifact`                                      |

Gemini-specific raw event names, such as `GeminiCliRawRecord`, are allowed only inside `src/main/adapters/gemini-cli/**`.

# 10. Shared Parser / Ingestion Flow

The shared ingestion flow becomes:

```text
1. Load enabled adapters from Adapter Registry.
2. For each adapter, load configured source roots.
3. Ask adapter to validate each root.
4. Ask adapter to discover harness sources.
5. Ask adapter to discover raw artifacts.
6. Index raw artifacts by adapter/source/path/mtime/size/inode.
7. Ask adapter to parse changed artifacts.
8. Ask adapter to normalize raw events into core model fragments.
9. Validate normalized fragments with shared schemas.
10. Merge normalized fragments into Projects/Sessions.
11. Run shared shell parsing.
12. Run shared verification classification.
13. Run shared run audit.
14. Attach git/GitHub snapshots.
15. Store normalized cache.
16. Emit UI update events.
```

## Important Boundary

Adapters may produce:

* `ShellCommandEvidence`.
* `ToolCall`.
* `FileMutation`.
* `SessionEvent`.
* `OutputArtifact`.

Adapters may not produce final shared audit conclusions such as:

* `verification.state = passed`.
* `runAudit.classification = clean`.
* `attentionReasons = failed-verification`.

Those are shared-core responsibilities.

The reason is exactly the observed Gemini footgun: a tool call can report success while the underlying shell command exits nonzero. The uploaded notes say tool-call `status: "success"` only means the tool invocation completed, and shell success must be parsed from output such as `Exit Code: 0` or `Exit Code: 1`.

# 11. Shared Shell Parsing

The shell parser is not part of any adapter.

It consumes `ShellCommandEvidence` from all adapters.

Responsibilities:

* Extract command string.
* Extract working directory.
* Load inline and output-artifact text.
* Parse exit code.
* Detect failure.
* Classify command intent:

    * `test`
    * `build`
    * `typecheck`
    * `lint`
    * `install`
    * `git`
    * `other`
    * `unknown`
* Parse common test summaries.
* Extract failing test names where possible.
* Produce normalized `ShellCommand`.

Adapters should not duplicate this. A future `xyz` adapter should only map its raw shell-command records into `ShellCommandEvidence`.

# 12. Shared Verification Classification

The verification engine is shared and harness-neutral.

Inputs:

* `ShellCommand[]`
* `FileMutation[]`
* `SessionEvent[]`
* `SessionMessage[]`
* `GitSnapshot`
* Adapter/session capabilities

Outputs:

* `VerificationResult`
* `AttentionReason[]`
* `LifecycleStatus` updates where relevant

Rules:

* Nonzero exit code means failed command.
* Nonzero exit code in test/build/typecheck/lint means failed verification.
* No verification command found means `not-run`, not `passed`.
* Missing shell support means `unknown`, not `passed`.
* Adapter raw tool status never overrides parsed shell exit code.
* If output is missing because sidecar loading failed, verification confidence decreases.

# 13. Shared Run Audit Engine

Run Audit remains the product wedge and should be harness-neutral.

Truth table fields:

* Agent claimed completed?
* Final answer present?
* Request cancelled?
* Tool activity after final answer?
* Files mutated?
* Shell commands run?
* Build/test/typecheck/lint run?
* Shell exit codes?
* Failed tests detected?
* Generated/untracked files?
* Git dirty after claimed completion?
* Pending tool calls?
* Parser confidence?
* Capability gaps?

Classification precedence:

1. Active.
2. Cancelled.
3. Verification failed.
4. Incomplete.
5. Needs review.
6. Clean.
7. Unknown.

The uploaded prompt identified the audit opportunity as “agent claimed done vs verification reality,” especially when a run mutated files, tests failed, and the session ended cancelled.  Keep that as a shared product concept, not a Gemini-specific one.

# 14. Revised Status Model

Shared status fields:

```ts
type LifecycleStatus =
  | "active"
  | "finished"
  | "cancelled"
  | "unknown";

type AttentionReason =
  | "failed-verification"
  | "cancelled"
  | "no-final-answer"
  | "pending-tool-call"
  | "dirty-after-claim"
  | "sidecar-missing"
  | "parser-warning"
  | "no-verification"
  | "capability-missing"
  | "unknown";
```

## V1 Rules

* **Active**: session artifacts are changing recently, using shared watcher evidence or adapter-provided active evidence.
* **Cancelled**: normalized lifecycle event indicates cancellation.
* **Failed Verification**: shared shell parser detects nonzero exit code, especially in test/build/typecheck/lint.
* **Needs Attention**: cancelled, failed verification, pending tool, no final answer after activity, dirty repo after claim, missing output artifacts, parser warnings, or no verification.
* **Finished**: no recent updates, final assistant message exists, no known pending tools, not cancelled, no known verification failure.
* **Unknown**: insufficient capabilities, incomplete parse, missing source root, corrupt raw artifacts, or no reliable lifecycle evidence.

## V2 Rules

V2 can improve active-session detection using adapter capabilities:

* `process` detection.
* Harness lifecycle hooks.
* Native active session APIs.
* Session lockfiles.
* PID-to-session mapping.
* Adapter-specific event streams.

But V2 still must emit normalized lifecycle evidence into shared core.

# 15. Revised UI Specification

The UI pages stay, but all labels become harness-neutral.

The original requested pages were Overview, Projects, Sessions, Session Detail, Run Audit, and Settings/Data, with audit status, shell commands, sidecar loading, git context, and GitHub context.  Those pages remain, but now include harness filters and capability-aware rendering.

## Overview

Add:

* Harness filter: All / Gemini CLI / XYZ.
* Sessions by harness.
* Failed verification by harness.
* Capability coverage warnings:

    * “3 sessions cannot report shell output.”
    * “XYZ adapter does not expose token counts.”
* Cross-harness attention queue.

Metrics:

* Total projects.
* Total sessions.
* Active/recent sessions.
* Failed verification.
* Cancelled.
* Needs attention.
* Tool call breakdown.
* Activity over time.
* Token usage by model, only for sessions with `tokenCounts=true`.

## Projects

Columns:

* Project.
* Repo path.
* Harnesses observed.
* Latest harness activity.
* Current branch.
* HEAD SHA.
* Dirty state.
* Changed/untracked files.
* GitHub PR badge.
* Session count.
* Latest verification state.

A project may have sessions from multiple harnesses. Example:

```text
blueprint
  Harnesses: Gemini CLI, XYZ
  Sessions: 14
  Latest: Gemini CLI · failed verification
```

## Sessions

Columns:

* Status.
* Harness.
* Project.
* Branch at inspection.
* Session ID.
* Native session ID.
* First prompt.
* Assistant/model.
* Start/last updated.
* Token count if supported.
* Tool count.
* File mutation count.
* Command count.
* Failed command count.
* Capability warnings.

## Session Detail

Rename Gemini-specific labels:

| Old Label       | New Label          |
| --------------- | ------------------ |
| Gemini messages | Assistant messages |
| Gemini event    | Session event      |
| Gemini metadata | Harness metadata   |
| Gemini sidecar  | Output artifact    |
| Gemini root     | Source root        |

Header:

* Harness badge.
* Project.
* Session ID.
* Native session ID.
* Lifecycle status.
* Attention reasons.
* Capability warnings.

Timeline:

* User messages.
* Assistant messages.
* System/harness messages.
* Lifecycle events.
* Tool calls.
* File events.
* Shell commands.
* Output artifacts.
* Unknown raw events, collapsed.

## Run Audit

No Gemini wording.

Sections:

* Claim vs evidence.
* Verification.
* Files changed.
* Commands.
* Cancellation/incompletion.
* Git/GitHub state.
* Capability gaps.
* Parser diagnostics.

## Settings / Data

Rename to **Harnesses & Data Sources**.

Sections:

* Enabled harnesses.
* Configured source roots by harness.
* Default roots.
* Import archives.
* Watch settings.
* Git settings.
* GitHub CLI settings.
* Privacy/export settings.
* Adapter diagnostics.
* Adapter contract version.

Example:

```text
Harnesses

✓ Gemini CLI
  Default root: ~/.gemini/tmp
  Capabilities: replay, tool calls, shell commands, sidecars, token counts
  Status: enabled

○ XYZ
  Default root: not configured
  Capabilities: unknown until root configured
  Status: disabled
```

# 16. Revised Data Source Specification

## Source Root

```ts
interface SourceRootConfig {
  id: SourceId;
  adapterId: HarnessId;
  rootPath: string;
  enabled: boolean;
  addedBy: "default" | "user" | "import";
  label?: string;
}
```

## Source Discovery

Shared core does not scan every root the same way. It asks each adapter:

```text
gemini-cli:
  default candidate: ~/.gemini/tmp
  discovery: project-scoped folders
  artifacts: .project_root, logs.json, chats/*.jsonl, tool-outputs/**/*

xyz:
  default candidate: adapter-defined
  discovery: adapter-defined
  artifacts: adapter-defined
```

## Raw Artifact Reference

```ts
interface RawArtifactRef {
  id: string;
  adapterId: HarnessId;
  sourceId: SourceId;

  path?: string;
  nativeRef?: string;

  artifactKind:
    | "session-log"
    | "message-index"
    | "project-root-map"
    | "output-artifact"
    | "history"
    | "metadata"
    | "unknown";

  sizeBytes?: number;
  mtime?: string;
  inode?: string;

  parseStrategy?: "stream-jsonl" | "json" | "text" | "adapter-native" | "unknown";
}
```

# 17. Revised Parser Spec

## Shared Parser Orchestrator

The shared orchestrator:

* Does safe file access.
* Applies path allowlists.
* Tracks mtimes/sizes/inodes.
* Runs adapters.
* Validates normalized output.
* Maintains cache.
* Handles partial parses.
* Emits diagnostics.
* Runs shared audit logic.

## Adapter Parser Responsibilities

Each adapter must:

* Parse only its own raw artifacts.
* Tolerate corrupt or partial raw data.
* Preserve source pointers.
* Emit diagnostics instead of throwing.
* Map raw records into normalized fragments.
* Dedupe raw duplicates using harness-specific semantics.
* Avoid verification classification.
* Avoid git/GitHub lookup.
* Avoid UI formatting decisions.

## Gemini CLI Parser Responsibilities

The `gemini-cli` parser owns the observed Gemini footguns:

* `logs.json` is sparse.
* `chats/*.jsonl` is the main event stream.
* Duplicate/intermediate assistant records may exist.
* Tool calls may appear first without results and later with results.
* `$set.lastUpdated` patch records exist.
* Sidecars may be JSON wrappers or plain text.
* Tool status success does not prove shell command success.
* Active sessions may be appended while parsed.
* Cancelled sessions may lack final assistant response.

These are explicitly listed in the uploaded parser notes.

## Sidecar Handling

Shared core provides:

* Safe artifact loading.
* Size limits.
* Preview generation.
* Redaction.
* Export inclusion/exclusion.
* Lazy loading.

Adapters provide:

* How to find sidecars.
* How to associate sidecars with sessions/tool calls.
* Harness-specific sidecar parsing if needed.

For Gemini CLI:

* JSON sidecar with `output` field maps to `OutputArtifact.contentKind = "json-output-wrapper"`.
* Plain text sidecar maps to `OutputArtifact.contentKind = "plain-text"`.

## Incremental Parsing

The shared cache tracks:

* Adapter ID.
* Source ID.
* Raw artifact ID.
* Path.
* Size.
* Mtime.
* Inode.
* Last parsed byte offset, when supported.
* Parser version.
* Adapter version.
* Normalization schema version.
* Diagnostics hash.

Adapters can opt into incremental parsing:

```ts
capabilities.live.incrementalParsing = true
```

If false, changed artifacts are reparsed from scratch.

# 18. Cache / Indexing

Cache keys must include adapter identity.

```text
cacheKey = hash(
  adapterId,
  sourceId,
  rawArtifactId,
  artifactPath/nativeRef,
  mtime,
  size,
  adapterVersion,
  normalizationSchemaVersion
)
```

Global session ID:

```text
session.id = hash(adapterId, sourceId, nativeSessionId || artifact identity)
```

This prevents collisions between Gemini and `xyz` sessions with the same native session ID.

## Cache Tables / Stores

V1 file-backed cache or V2 SQLite should store:

* Harness sources.
* Projects.
* Project-harness refs.
* Sessions.
* Session events.
* Messages.
* Tool calls.
* File mutations.
* Shell commands.
* Output artifacts.
* Verification results.
* Run audits.
* Git snapshots.
* GitHub snapshots.
* Diagnostics.
* Raw artifact index.
* Adapter capabilities snapshot.

# 19. Git / GitHub Integration

No change in ownership: git and GitHub remain shared.

Adapters only provide project root evidence. Shared git provider decides whether and how to inspect it.

Project root confidence matters:

* `confirmed`: native project-root mapping or validated repo root.
* `observed`: adapter saw a project-root file.
* `inferred`: derived from logs or paths.
* `unknown`: no reliable root.

For Gemini CLI, project root can be read from `.project_root`, and git branch/status must be collected separately because Gemini logs do not include it.

Shared git provider still owns:

* Branch.
* HEAD SHA.
* Dirty/clean.
* Changed files.
* Untracked files.
* Additions/deletions.
* Remote URL.

Shared GitHub provider still owns:

* `gh` detection.
* PR lookup.
* PR checks.
* Review/merge status where available.
* Timeouts.
* Caching.
* Failure behavior.

# 20. IPC API Changes

Use harness-neutral IPC names.

```text
harnesses:list
harnesses:getCapabilities

sources:list
sources:add
sources:update
sources:disable
sources:validate
sources:rescan

scanner:getStatus
scanner:rescanAll
scanner:rescanSource

projects:list
projects:get

sessions:list
sessions:get
sessions:getTimeline

events:get
toolCalls:get
shellCommands:get
outputArtifacts:getPreview
outputArtifacts:load

audit:getRunAudit
dashboard:getStats

git:getSnapshot
github:getSnapshot

export:createArchive
import:openArchive

diagnostics:list
```

Remove or avoid APIs such as:

```text
gemini:getSessions
gemini:getRoot
gemini:loadSidecar
```

# 21. Security / Privacy Updates

The old security model remains, but the allowlist is now adapter-aware.

Instead of:

```text
Allow ~/.gemini/tmp
```

Use:

```text
Allow configured SourceRootConfig.rootPath for enabled adapter
Allow imported archive roots
Allow validated project roots only for shared read-only git/gh operations
Allow output artifact paths only if indexed by an adapter and resolved under an allowed root
```

No adapter should receive raw shell execution ability.

Allowed shared commands remain:

* Fixed `git` commands.
* Fixed `gh` commands.
* Detection commands such as `git --version`, `gh --version`.

Adapters cannot execute commands. They only parse local artifacts.

# 22. Adapter Contract Tests

Every adapter must pass the same shared contract suite.

## Required Test Categories

### 1. Descriptor and Capabilities

* Adapter has stable `id`.
* Adapter has display name.
* Adapter declares capabilities.
* Capabilities match fixture behavior.
* Adapter does not claim features unsupported by fixtures.

### 2. Source Discovery

* Default roots are returned.
* Invalid roots are rejected with diagnostics.
* Valid fixture roots are accepted.
* Source discovery produces stable IDs.

### 3. Raw Artifact Discovery

* Discovers expected raw artifacts.
* Ignores irrelevant files.
* Handles missing optional artifacts.
* Does not escape configured root.

### 4. Normalization

Every adapter must normalize fixture sessions into shared core objects:

* Project.
* Session.
* Messages.
* Session events.
* Tool calls.
* Output artifacts if supported.
* File mutations if supported.
* Shell command evidence if supported.
* Diagnostics.

### 5. Shared Fixture Scenarios

Each adapter should include fixtures for every supported capability:

* Basic session.
* Multi-message session.
* Assistant final answer.
* Tool call.
* File read/search.
* File mutation.
* Shell command.
* Shell command failure.
* Cancellation/lifecycle event.
* Sidecar/output artifact.
* Duplicate/intermediate raw records, if applicable.
* Partial/corrupt raw data.
* Active/changing artifact, if supported.

If an adapter does not support a capability, the contract suite should assert that:

* The capability is declared false.
* The UI receives unsupported/unknown, not false zeroes.
* The adapter does not fabricate evidence.

### 6. Golden Normalization Tests

For each fixture:

```text
fixture raw data -> adapter normalize -> normalized golden JSON
```

The golden file should not contain adapter-private raw objects except source pointers and diagnostics.

### 7. Import Boundary Tests

Automated checks:

* `core/**` does not import `adapters/**`.
* `renderer/**` does not import `adapters/**`.
* `gemini-cli/**` does not import `xyz/**`.
* `xyz/**` does not import `gemini-cli/**`.
* Shared tests can import adapters only through the adapter registry or contract-test harness.

# 23. Adding `xyz`: Acceptance Criteria

A future `xyz` harness is added correctly only if:

* New folder exists: `src/main/adapters/xyz/`.
* `xyz` exports a `SessionSourceAdapter`.
* `xyz` has descriptor and capabilities.
* `xyz` has fixtures.
* `xyz` passes adapter contract tests.
* `xyz` appears in Settings / Harnesses.
* `xyz` sessions appear in Overview/Sessions.
* `xyz` unsupported capabilities are hidden or marked unavailable.
* Shared shell parsing works if `xyz` emits shell evidence.
* Shared run audit works if enough normalized evidence exists.
* No `gemini-cli` adapter files were modified.
* No UI page has `if adapterId === "xyz"` logic, except optional display-name overrides through registry metadata.

# 24. Revised Implementation Phases

## Phase 0 — Harness-Neutral Architecture Reset

Deliverables:

* Rename product language internally from Gemini-specific to harness-neutral.
* Define `HarnessId`, `SourceId`, `SessionId`.
* Define adapter contract.
* Define capability schema.
* Define import-boundary rules.
* Define normalized model without `GeminiEvent`.

Acceptance criteria:

* No shared-core type named `GeminiEvent`.
* No shared IPC name starts with `gemini:`.
* UI copy uses “harness,” “agent session,” “assistant,” and “source root.”

## Phase 1 — Core Model and Adapter Registry

Deliverables:

* Shared normalized data schemas.
* Adapter registry.
* Source registry.
* Capability gating helpers.
* Diagnostics model.
* Contract-test harness skeleton.

Acceptance criteria:

* A fake test adapter can register and produce a normalized fixture session.
* UI can list harnesses and capabilities without knowing adapter internals.

## Phase 2 — Gemini CLI Adapter

Deliverables:

* `src/main/adapters/gemini-cli/`.
* Default root discovery for `~/.gemini/tmp`.
* `.project_root` parser.
* `logs.json` parser.
* `chats/*.jsonl` parser.
* `tool-outputs` parser.
* Raw-to-normalized mapper.
* Gemini fixture suite.
* Adapter contract tests.

Acceptance criteria:

* Uploaded Gemini sample fixture parses through adapter.
* Gemini parser footguns are handled inside the adapter.
* Core receives only normalized objects.
* Shared core does not import Gemini parser files.

## Phase 3 — Shared Ingestion, Cache, Watcher

Deliverables:

* Scanner orchestrator.
* Raw artifact index.
* Watch plan orchestration.
* Cache keys including `adapterId`.
* Incremental parse support where adapter supports it.
* Diagnostics propagation.

Acceptance criteria:

* Multiple adapters can be scanned in one run.
* Cache entries do not collide across adapters.
* Watch events are routed to the owning adapter.

## Phase 4 — Shared Shell, Verification, Run Audit

Deliverables:

* Shell command parser.
* Exit-code parser.
* Test/build/typecheck/lint classifier.
* Verification engine.
* Run audit engine.
* Status classifier.

Acceptance criteria:

* Tool success never overrides shell exit failure.
* Sessions without shell support are marked unknown/not supported, not clean.
* Run Audit works for any adapter that emits normalized evidence.

## Phase 5 — Harness-Neutral UI

Deliverables:

* Overview with harness filter.
* Projects with harness badges.
* Sessions with harness column.
* Session Detail using `SessionEvent`, not Gemini-specific event names.
* Run Audit with capability gaps.
* Harnesses/Data Sources settings.

Acceptance criteria:

* Gemini and fake adapter sessions render through the same pages.
* Token/model/tool/sidecar UI is capability-gated.
* No page imports adapter-private types.

## Phase 6 — Git and GitHub Providers

Deliverables:

* Shared git provider.
* Shared GitHub CLI provider.
* Project-root confidence handling.
* PR/check badges.

Acceptance criteria:

* Works for any adapter that provides a validated project root.
* Missing project root disables git cleanly.
* GitHub is optional and read-only.

## Phase 7 — Export / Import

Deliverables:

* Harness-neutral archive manifest.
* Adapter/source/session metadata.
* Normalized export.
* Optional raw artifact export.
* Import as read-only source.

Acceptance criteria:

* Archive preserves `adapterId`.
* Imported sessions render without original local source roots.
* Raw export warns about sensitive transcript data.

## Phase 8 — Adapter Contract Hardening

Deliverables:

* Full contract suite.
* Golden normalization fixtures.
* Import-boundary tests.
* Capability truth tests.
* Corrupt/partial artifact tests.

Acceptance criteria:

* `gemini-cli` passes.
* Fake/stub `xyz` adapter can be added without editing Gemini.
* CI fails if shared core imports adapter internals.

## Phase 9 — Real `xyz` Adapter

Deliverables:

* New adapter folder.
* New fixtures.
* New descriptor/capabilities.
* Root/artifact discovery.
* Parser/mapper.
* Contract tests.

Acceptance criteria:

* No `gemini-cli` code changed.
* No shared audit/shell/git/GitHub logic duplicated.
* UI pages work through capabilities.

# 25. Revised Open Questions

1. Should adapters be bundled only in V1, or should V2 support third-party adapter plugins?
2. Should source-root defaults be adapter-provided only, or can organization policy add default roots?
3. Should raw artifacts be exportable for all adapters, or only adapters that explicitly support safe raw export?
4. Should adapter capabilities be static, dynamic, or both?
5. How should cross-harness sessions in the same repo be grouped if two harnesses work on the same branch?
6. Should the app show one project row per repo, or one project-harness pair per repo/harness?
7. Should adapter contract tests require all fixture categories, or only capability-declared categories?
8. Should cost estimates stay out of core until pricing sources are stable per model/provider?
9. Should lifecycle hooks be modeled as a generic V2 capability rather than Gemini-specific hook support?
10. Should `xyz` be treated as a bundled adapter example to prove the architecture early?

# 26. Most Important Spec Edits to Make Immediately

Make these changes before implementation starts:

1. Rename the app concept from **Gemini Workbench** to a harness-neutral name.
2. Replace “Gemini data root” with **Harness Source Root**.
3. Replace `GeminiEvent` with `SessionEvent` / `RawHarnessEvent`.
4. Add `adapterId` to every normalized entity.
5. Add `HarnessCapabilities`.
6. Add `SessionSourceAdapter`.
7. Move all Gemini parsing to `src/main/adapters/gemini-cli`.
8. Make shell parsing, verification, and run audit shared.
9. Make UI pages capability-driven.
10. Add adapter contract tests before adding a second real harness.

That correction will save you from the classic first-adapter trap: building the product around Gemini’s file layout, then discovering that every future harness requires copy-pasted ingestion, duplicate audit logic, and UI conditionals.
