import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AdapterContext,
  AdapterNormalizationResult,
  DiscoveredHarnessSource,
  RawArtifactRef,
  RawHarnessEvent,
  SessionSourceAdapter,
  SourceRootConfig,
  SourceRootValidation
} from "../../src/main/core/adapter-contract/index.js";
import type { Diagnostic } from "../../src/main/core/diagnostics/diagnostic.js";
import type {
  CapabilityState,
  HarnessCapabilities
} from "../../src/main/core/model/capabilities.js";
import { createSafeFilesystem } from "../../src/main/core/security/index.js";

const REQUIRED_CAPABILITY_KEYS = [
  "sessionDiscovery",
  "liveSessionObservation",
  "eventStreaming",
  "messageCapture",
  "toolCallCapture",
  "shellCommandCapture",
  "outputArtifactCapture",
  "fileMutationCapture",
  "sourceValidation",
  "watchPlans",
  "gitContextCapture",
  "githubContextCapture",
  "verificationSignals"
] as const satisfies ReadonlyArray<keyof HarnessCapabilities>;

const FORBIDDEN_CONCLUSION_KEYS = [
  "verificationState",
  "verificationStatus",
  "runAuditStatus",
  "runAuditClassification",
  "attentionReasons",
  "attentionReason"
] as const;

type MinimumKey =
  | "sources"
  | "artifacts"
  | "rawEvents"
  | "projects"
  | "sessions"
  | "events"
  | "messages"
  | "toolCalls"
  | "shellCommands"
  | "outputArtifacts"
  | "fileMutations"
  | "diagnostics";

export interface ExercisedAdapter<TRawEvent extends RawHarnessEvent = RawHarnessEvent> {
  context: AdapterContext;
  root: SourceRootConfig;
  validation: SourceRootValidation;
  sources: DiscoveredHarnessSource[];
  source: DiscoveredHarnessSource;
  artifacts: RawArtifactRef[];
  rawEvents: TRawEvent[];
  normalized: AdapterNormalizationResult;
}

export interface RunAdapterContractSuiteOptions<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
  name: string;
  adapter: SessionSourceAdapter<TRawEvent>;
  root: SourceRootConfig | string;
  expectedCapabilityStatuses?: Partial<
    Record<keyof HarnessCapabilities, CapabilityState["status"]>
  >;
  expectedDiagnosticCodes?: string[];
  minimums?: Partial<Record<MinimumKey, number>>;
  assertExercisedAdapter?(adapterRun: ExercisedAdapter<TRawEvent>): void;
  assertNormalized?(
    normalized: AdapterNormalizationResult,
    adapterRun: ExercisedAdapter<TRawEvent>
  ): void;
}

function createAdapterTestContext(root: SourceRootConfig): AdapterContext {
  return {
    projectDir: process.cwd(),
    platform: process.platform,
    safeFilesystem: createSafeFilesystem({
      allowedRootPaths: [root.rootPath]
    })
  };
}

function toSourceRootConfig(root: SourceRootConfig | string): SourceRootConfig {
  if (typeof root === "string") {
    return {
      rootPath: path.resolve(root)
    };
  }

  return {
    ...root,
    rootPath: path.resolve(root.rootPath)
  };
}

function buildMinimums(overrides: RunAdapterContractSuiteOptions["minimums"] = {}) {
  return {
    sources: 1,
    artifacts: 1,
    rawEvents: 1,
    projects: 1,
    sessions: 1,
    events: 1,
    messages: 0,
    toolCalls: 0,
    shellCommands: 0,
    outputArtifacts: 0,
    fileMutations: 0,
    diagnostics: 0,
    ...overrides
  };
}

function assertCapabilityState(
  state: CapabilityState,
  key: keyof HarnessCapabilities,
  expectedStatus?: CapabilityState["status"]
) {
  expect(state).toBeTypeOf("object");
  expect(state).not.toBeNull();
  expect(state).toHaveProperty("status");
  expect(["supported", "unsupported", "unknown"]).toContain(state.status);

  if (expectedStatus) {
    expect(state.status).toBe(expectedStatus);
  }

  if (state.reason !== undefined) {
    expect(state.reason).toEqual(expect.any(String));
  }

  if (state.details !== undefined) {
    expect(state.details).toEqual(expect.any(String));
  }

  expect(state.status).not.toBe(0 as never);
  expect(state.status).not.toBe(false as never);
  expect(key).toEqual(expect.any(String));
}

function assertHarnessCapabilities(
  capabilities: HarnessCapabilities,
  expectedStatuses: Partial<Record<keyof HarnessCapabilities, CapabilityState["status"]>> = {}
) {
  for (const key of REQUIRED_CAPABILITY_KEYS) {
    assertCapabilityState(capabilities[key], key, expectedStatuses[key]);
  }
}

function assertDiagnosticShape(
  diagnostic: Diagnostic,
  adapterId: string,
  sourceId: string | undefined
) {
  expect(diagnostic.id).toEqual(expect.any(String));
  expect(diagnostic.code).toEqual(expect.any(String));
  expect(diagnostic.message).toEqual(expect.any(String));
  expect(["info", "warning", "error"]).toContain(diagnostic.severity);
  expect(
    [
      "adapter",
      "source",
      "artifact",
      "project",
      "session",
      "event",
      "message",
      "tool-call",
      "shell-command",
      "output-artifact",
      "file-mutation"
    ]
  ).toContain(diagnostic.scope);
  expect(diagnostic.adapterId).toBe(adapterId);

  if (sourceId !== undefined && diagnostic.sourceId !== undefined) {
    expect(diagnostic.sourceId).toBe(sourceId);
  }

  expect(diagnostic.confidence.level).toEqual(expect.any(String));

  if (diagnostic.relatedEntityIds) {
    expect(diagnostic.relatedEntityIds.every((id) => typeof id === "string")).toBe(true);
  }
}

function findForbiddenKeys(
  value: unknown,
  pathPrefix = "$",
  hits: string[] = []
): string[] {
  if (!value || typeof value !== "object") {
    return hits;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findForbiddenKeys(item, `${pathPrefix}[${index}]`, hits);
    });
    return hits;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_CONCLUSION_KEYS.includes(key as (typeof FORBIDDEN_CONCLUSION_KEYS)[number])) {
      hits.push(`${pathPrefix}.${key}`);
    }
    findForbiddenKeys(nestedValue, `${pathPrefix}.${key}`, hits);
  }

  return hits;
}

function assertNormalizedRelationships(result: AdapterNormalizationResult) {
  const projectIds = new Set(result.projects.map((project) => project.id));
  const sessionIds = new Set(result.sessions.map((session) => session.id));
  const eventIds = new Set(result.events.map((event) => event.id));
  const toolCallIds = new Set(result.toolCalls.map((toolCall) => toolCall.id));
  const outputArtifactIds = new Set(result.outputArtifacts.map((artifact) => artifact.id));
  const fileMutationIds = new Set(result.fileMutations.map((mutation) => mutation.id));

  for (const project of result.projects) {
    expect(project.kind).toBe("project");
    expect(project.adapterId).toBe(result.adapterId);
    expect(project.sourceId).toBe(result.sourceId);
    expect(project.nativeId).toEqual(expect.any(String));
    expect(project.name).toEqual(expect.any(String));
    expect(project.confidence.level).toEqual(expect.any(String));
  }

  for (const session of result.sessions) {
    expect(session.kind).toBe("session");
    expect(session.adapterId).toBe(result.adapterId);
    expect(session.sourceId).toBe(result.sourceId);
    expect(session.nativeId).toEqual(expect.any(String));
    expect(["active", "completed", "cancelled", "unknown"]).toContain(session.lifecycleState);
    expect(session.confidence.level).toEqual(expect.any(String));

    if (session.projectId !== undefined) {
      expect(projectIds.has(session.projectId)).toBe(true);
    }
  }

  for (const event of result.events) {
    expect(event.kind).toBe("session-event");
    expect(event.adapterId).toBe(result.adapterId);
    expect(event.sourceId).toBe(result.sourceId);
    expect(sessionIds.has(event.sessionId)).toBe(true);
    expect(event.nativeId).toEqual(expect.any(String));
    expect(Number.isInteger(event.ordinal)).toBe(true);
    expect(event.ordinal).toBeGreaterThan(0);
    expect(
      ["lifecycle", "message", "tool-call", "shell-command", "output-artifact", "file-mutation", "metadata"]
    ).toContain(event.eventKind);

    if (event.messageId !== undefined) {
      expect(
        result.messages.some((message) => message.id === event.messageId)
      ).toBe(true);
    }

    if (event.toolCallId !== undefined) {
      expect(toolCallIds.has(event.toolCallId)).toBe(true);
    }

    if (event.shellCommandId !== undefined) {
      expect(
        result.shellCommands.some((shellCommand) => shellCommand.id === event.shellCommandId)
      ).toBe(true);
    }

    if (event.outputArtifactId !== undefined) {
      expect(outputArtifactIds.has(event.outputArtifactId)).toBe(true);
    }

    if (event.fileMutationId !== undefined) {
      expect(fileMutationIds.has(event.fileMutationId)).toBe(true);
    }
  }

  for (const message of result.messages) {
    expect(message.kind).toBe("session-message");
    expect(message.adapterId).toBe(result.adapterId);
    expect(message.sourceId).toBe(result.sourceId);
    expect(sessionIds.has(message.sessionId)).toBe(true);
    expect(message.nativeId).toEqual(expect.any(String));
    expect(["assistant", "system", "tool", "user"]).toContain(message.role);
    expect(message.content).toEqual(expect.any(String));
    expect(Number.isInteger(message.ordinal)).toBe(true);
    expect(message.ordinal).toBeGreaterThan(0);

    if (message.eventId !== undefined) {
      expect(eventIds.has(message.eventId)).toBe(true);
    }
  }

  for (const toolCall of result.toolCalls) {
    expect(toolCall.kind).toBe("tool-call");
    expect(toolCall.adapterId).toBe(result.adapterId);
    expect(toolCall.sourceId).toBe(result.sourceId);
    expect(sessionIds.has(toolCall.sessionId)).toBe(true);
    expect(toolCall.nativeId).toEqual(expect.any(String));
    expect(toolCall.toolName).toEqual(expect.any(String));
    expect(["started", "succeeded", "failed", "cancelled", "unknown"]).toContain(toolCall.status);

    if (toolCall.eventId !== undefined) {
      expect(eventIds.has(toolCall.eventId)).toBe(true);
    }

    if (toolCall.artifactIds) {
      expect(toolCall.artifactIds.every((artifactId) => outputArtifactIds.has(artifactId))).toBe(
        true
      );
    }

    if (toolCall.fileMutationIds) {
      expect(toolCall.fileMutationIds.every((fileMutationId) => fileMutationIds.has(fileMutationId))).toBe(true);
    }
  }

  for (const shellCommand of result.shellCommands) {
    expect(shellCommand.kind).toBe("shell-command");
    expect(shellCommand.adapterId).toBe(result.adapterId);
    expect(shellCommand.sourceId).toBe(result.sourceId);
    expect(sessionIds.has(shellCommand.sessionId)).toBe(true);
    expect(shellCommand.nativeId).toEqual(expect.any(String));
    expect(shellCommand.command).toEqual(expect.any(String));
    expect(["stdout", "stderr", "combined", "unknown"]).toContain(shellCommand.outputSource);

    if (shellCommand.eventId !== undefined) {
      expect(eventIds.has(shellCommand.eventId)).toBe(true);
    }
  }

  for (const artifact of result.outputArtifacts) {
    expect(artifact.kind).toBe("output-artifact");
    expect(artifact.adapterId).toBe(result.adapterId);
    expect(artifact.sourceId).toBe(result.sourceId);
    expect(sessionIds.has(artifact.sessionId)).toBe(true);
    expect(artifact.nativeId).toEqual(expect.any(String));
    expect(["image", "json", "text", "trace", "unknown"]).toContain(artifact.artifactKind);

    if (artifact.eventId !== undefined) {
      expect(eventIds.has(artifact.eventId)).toBe(true);
    }
  }

  for (const mutation of result.fileMutations) {
    expect(mutation.kind).toBe("file-mutation");
    expect(mutation.adapterId).toBe(result.adapterId);
    expect(mutation.sourceId).toBe(result.sourceId);
    expect(sessionIds.has(mutation.sessionId)).toBe(true);
    expect(mutation.nativeId).toEqual(expect.any(String));
    expect(mutation.path).toEqual(expect.any(String));
    expect(["created", "updated", "deleted", "unknown"]).toContain(mutation.mutationKind);

    if (mutation.eventId !== undefined) {
      expect(eventIds.has(mutation.eventId)).toBe(true);
    }

    if (mutation.toolCallId !== undefined) {
      expect(toolCallIds.has(mutation.toolCallId)).toBe(true);
    }
  }
}

export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

export async function exerciseAdapter<TRawEvent extends RawHarnessEvent>(
  adapter: SessionSourceAdapter<TRawEvent>,
  root: SourceRootConfig | string,
  context?: AdapterContext
): Promise<ExercisedAdapter<TRawEvent>> {
  const resolvedRoot = toSourceRootConfig(root);
  const runtimeContext = context ?? createAdapterTestContext(resolvedRoot);
  const validation = await adapter.validateSourceRoot(resolvedRoot, runtimeContext);
  const sources = await collectAsync(adapter.discoverSources(resolvedRoot, runtimeContext));
  const source = sources[0];

  if (!source) {
    throw new Error(`Adapter '${adapter.descriptor.id}' did not discover any sources.`);
  }

  const artifacts = await collectAsync(adapter.discoverArtifacts(source, runtimeContext));
  const rawEvents = (
    await Promise.all(
      artifacts.map((artifact) => collectAsync(adapter.parseArtifact(artifact, runtimeContext)))
    )
  ).flat();
  const normalized = await adapter.normalize(
    {
      source,
      artifacts,
      rawEvents
    },
    runtimeContext
  );

  return {
    context: runtimeContext,
    root: resolvedRoot,
    validation,
    sources,
    source,
    artifacts,
    rawEvents,
    normalized
  };
}

export function runAdapterContractSuite<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
>({
  name,
  adapter,
  root,
  expectedCapabilityStatuses = {},
  expectedDiagnosticCodes = [],
  minimums,
  assertExercisedAdapter,
  assertNormalized
}: RunAdapterContractSuiteOptions<TRawEvent>) {
  const expectedMinimums = buildMinimums(minimums);

  describe(`${name} adapter contract`, () => {
    it("exposes reusable descriptor metadata and mandatory capability truth states", () => {
      expect(adapter.descriptor.id).toEqual(expect.any(String));
      expect(adapter.descriptor.displayName).toEqual(expect.any(String));
      expect(adapter.descriptor.adapterVersion).toEqual(expect.any(String));
      expect(adapter.descriptor.supportedPlatforms.length).toBeGreaterThan(0);
      expect(adapter.descriptor.defaultRoots.length).toBeGreaterThan(0);

      for (const defaultRoot of adapter.descriptor.defaultRoots) {
        expect(defaultRoot.path).toEqual(expect.any(String));
        expect(defaultRoot.label).toEqual(expect.any(String));
        expect(["directory", "file"]).toContain(defaultRoot.kind);
      }

      assertHarnessCapabilities(adapter.descriptor.capabilities, expectedCapabilityStatuses);
    });

    it("runs validation, discovery, parsing, normalization, and diagnostics through one harness", async () => {
      const adapterRun = await exerciseAdapter(adapter, root);
      const { validation, sources, source, artifacts, rawEvents, normalized } = adapterRun;

      expect(validation.ok).toBe(true);
      expect(validation.normalizedPath).toEqual(expect.any(String));
      expect(Array.isArray(validation.diagnostics)).toBe(true);

      if (validation.capabilities) {
        assertHarnessCapabilities(validation.capabilities, expectedCapabilityStatuses);
      }

      expect(sources).toHaveLength(expectedMinimums.sources);

      for (const discoveredSource of sources) {
        expect(discoveredSource.id).toEqual(expect.any(String));
        expect(discoveredSource.adapterId).toBe(adapter.descriptor.id);
        expect(discoveredSource.nativeId).toEqual(expect.any(String));
        expect(discoveredSource.rootPath).toEqual(expect.any(String));
        expect(discoveredSource.displayName).toEqual(expect.any(String));
        expect(discoveredSource.confidence.level).toEqual(expect.any(String));
      }

      expect(artifacts.length).toBeGreaterThanOrEqual(expectedMinimums.artifacts);

      for (const artifact of artifacts) {
        expect(artifact.id).toEqual(expect.any(String));
        expect(artifact.adapterId).toBe(adapter.descriptor.id);
        expect(artifact.sourceId).toBe(source.id);
        expect(artifact.nativeId).toEqual(expect.any(String));
        expect(artifact.path).toEqual(expect.any(String));
        expect(artifact.artifactType).toEqual(expect.any(String));
      }

      expect(rawEvents.length).toBeGreaterThanOrEqual(expectedMinimums.rawEvents);

      for (const rawEvent of rawEvents) {
        expect(rawEvent.id).toEqual(expect.any(String));
        expect(rawEvent.adapterId).toBe(adapter.descriptor.id);
        expect(rawEvent.sourceId).toBe(source.id);
        expect(artifacts.some((artifact) => artifact.id === rawEvent.artifactId)).toBe(true);
        expect(rawEvent.kind).toEqual(expect.any(String));
      }

      expect(normalized.adapterId).toBe(adapter.descriptor.id);
      expect(normalized.sourceId).toBe(source.id);

      expect(normalized.projects.length).toBeGreaterThanOrEqual(expectedMinimums.projects);
      expect(normalized.sessions.length).toBeGreaterThanOrEqual(expectedMinimums.sessions);
      expect(normalized.events.length).toBeGreaterThanOrEqual(expectedMinimums.events);
      expect(normalized.messages.length).toBeGreaterThanOrEqual(expectedMinimums.messages);
      expect(normalized.toolCalls.length).toBeGreaterThanOrEqual(expectedMinimums.toolCalls);
      expect(normalized.shellCommands.length).toBeGreaterThanOrEqual(
        expectedMinimums.shellCommands
      );
      expect(normalized.outputArtifacts.length).toBeGreaterThanOrEqual(
        expectedMinimums.outputArtifacts
      );
      expect(normalized.fileMutations.length).toBeGreaterThanOrEqual(
        expectedMinimums.fileMutations
      );
      expect(normalized.diagnostics.length).toBeGreaterThanOrEqual(expectedMinimums.diagnostics);

      assertHarnessCapabilities(
        normalized.capabilities.adapter.capabilities,
        expectedCapabilityStatuses
      );
      expect(normalized.capabilities.adapter.adapterId).toBe(adapter.descriptor.id);

      assertHarnessCapabilities(
        normalized.capabilities.source.capabilities,
        expectedCapabilityStatuses
      );
      expect(normalized.capabilities.source.adapterId).toBe(adapter.descriptor.id);
      expect(normalized.capabilities.source.sourceId).toBe(source.id);

      expect(normalized.capabilities.sessions.length).toBeGreaterThan(0);

      for (const sessionSnapshot of normalized.capabilities.sessions) {
        expect(normalized.sessions.some((session) => session.id === sessionSnapshot.sessionId)).toBe(
          true
        );
        assertHarnessCapabilities(sessionSnapshot.capabilities, expectedCapabilityStatuses);
      }

      normalized.diagnostics.forEach((diagnostic) =>
        assertDiagnosticShape(diagnostic, adapter.descriptor.id, source.id)
      );

      for (const diagnosticCode of expectedDiagnosticCodes) {
        expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          diagnosticCode
        );
      }

      assertNormalizedRelationships(normalized);
      expect(findForbiddenKeys(normalized)).toEqual([]);

      assertExercisedAdapter?.(adapterRun);
      assertNormalized?.(normalized, adapterRun);
    });
  });
}
