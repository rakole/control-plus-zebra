import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HarnessCapabilities } from "../../src/main/core/model/capabilities.js";
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
import { normalizeSessionSource } from "../../src/main/core/adapter-contract/index.js";
import type { Diagnostic } from "../../src/main/core/diagnostics/diagnostic.js";
import { createSafeFilesystem } from "../../src/main/core/security/index.js";
import {
  normalizedResultSchema,
  rawArtifactRefSchema,
  validateNormalizedResult
} from "../../src/main/core/ingestion/normalization-validator.js";

const FORBIDDEN_CONCLUSION_KEYS = [
  "verificationState",
  "verificationStatus",
  "runAuditStatus",
  "runAuditClassification",
  "attentionReason"
] as const;

export type AdapterScenarioStatus = "supported" | "unsupported" | "unknown";

export type AdapterScenarioName =
  | "active-changing-artifact"
  | "assistant-final-answer"
  | "basic-session"
  | "cancellation-lifecycle"
  | "cost-estimates"
  | "diagnostics"
  | "duplicate-intermediate-raw-records"
  | "file-mutation"
  | "file-read"
  | "file-search"
  | "model-name"
  | "multi-message-session"
  | "partial-corrupt-raw-data"
  | "raw-pointers"
  | "shell-command"
  | "shell-command-failure"
  | "sidecar-output-artifact"
  | "token-usage"
  | "tool-call";

export interface AdapterScenarioManifestEntry<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
  name: AdapterScenarioName;
  status: AdapterScenarioStatus;
  capability?: {
    group: keyof HarnessCapabilities;
    key: string;
  };
  reason?: string;
  assertSupported?(
    adapterRun: ExercisedAdapter<TRawEvent>
  ): void;
  assertNotFabricated?(
    adapterRun: ExercisedAdapter<TRawEvent>
  ): void;
}

export interface ExercisedAdapter<TRawEvent extends RawHarnessEvent = RawHarnessEvent> {
  context: AdapterContext;
  root: SourceRootConfig;
  validation: SourceRootValidation;
  sources: DiscoveredHarnessSource[];
  sourceRuns: ExercisedAdapterSourceRun<TRawEvent>[];
  source: DiscoveredHarnessSource;
  artifacts: RawArtifactRef[];
  rawEvents: TRawEvent[];
  normalized: AdapterNormalizationResult;
  defaultRoots: unknown[];
  watchPlan: unknown;
}

export interface ExercisedAdapterSourceRun<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
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
  expectedDiagnosticCodes?: string[];
  scenarios: AdapterScenarioManifestEntry<TRawEvent>[];
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

function assertDiagnosticShape(
  diagnostic: Diagnostic,
  adapterId: string,
  sourceId: string | undefined
) {
  expect(diagnostic.id).toEqual(expect.any(String));
  expect(diagnostic.code).toEqual(expect.any(String));
  expect(diagnostic.message).toEqual(expect.any(String));
  expect(["info", "warning", "error"]).toContain(diagnostic.severity);
  expect(diagnostic.adapterId).toBe(adapterId);

  if (sourceId !== undefined && diagnostic.sourceId !== undefined) {
    expect(diagnostic.sourceId).toBe(sourceId);
  }
}

function readCapabilityValue(
  capabilities: HarnessCapabilities,
  capability: AdapterScenarioManifestEntry["capability"]
): unknown {
  if (!capability) {
    return undefined;
  }

  const group = capabilities[capability.group] as Record<string, unknown>;
  return group[capability.key];
}

function capabilityValueToScenarioStatus(value: unknown): AdapterScenarioStatus {
  if (value === undefined) {
    return "unknown";
  }

  if (typeof value === "boolean") {
    return value ? "supported" : "unsupported";
  }

  if (value === "none") {
    return "unsupported";
  }

  if (typeof value === "string") {
    return value.length > 0 ? "supported" : "unknown";
  }

  return "unknown";
}

function assertRawPointers(normalized: AdapterNormalizationResult) {
  const pointerlessEvents = normalized.events.filter((event) => !event.raw);
  const pointerlessMessages = normalized.messages.filter((message) => !message.source);
  const pointerlessToolCalls = normalized.toolCalls.filter((toolCall) => !toolCall.source);
  const pointerlessShellCommands = normalized.shellCommands.filter((command) => !command.source);
  const pointerlessArtifacts = normalized.outputArtifacts.filter((artifact) => !artifact.source);
  const pointerlessMutations = normalized.fileMutations.filter((mutation) => !mutation.source);

  expect({
    events: pointerlessEvents.map((event) => event.id),
    messages: pointerlessMessages.map((message) => message.id),
    toolCalls: pointerlessToolCalls.map((toolCall) => toolCall.id),
    shellCommands: pointerlessShellCommands.map((command) => command.id),
    outputArtifacts: pointerlessArtifacts.map((artifact) => artifact.id),
    fileMutations: pointerlessMutations.map((mutation) => mutation.id)
  }).toEqual({
    events: [],
    messages: [],
    toolCalls: [],
    shellCommands: [],
    outputArtifacts: [],
    fileMutations: []
  });
}

function defaultAssertSupported<TRawEvent extends RawHarnessEvent>(
  scenario: AdapterScenarioManifestEntry<TRawEvent>,
  adapterRun: ExercisedAdapter<TRawEvent>
) {
  const { normalized, rawEvents } = adapterRun;

  switch (scenario.name) {
    case "assistant-final-answer":
      expect(normalized.messages.some((message) => message.role === "assistant" && message.text)).toBe(true);
      return;
    case "basic-session":
      expect(normalized.projects.length).toBeGreaterThan(0);
      expect(normalized.sessions.length).toBeGreaterThan(0);
      expect(normalized.events.length).toBeGreaterThan(0);
      return;
    case "cancellation-lifecycle":
      expect(normalized.sessions.some((session) => session.lifecycleStatus === "cancelled")).toBe(true);
      return;
    case "diagnostics":
      expect(normalized.diagnostics.length).toBeGreaterThan(0);
      return;
    case "duplicate-intermediate-raw-records":
      expect(rawEvents.length).toBeGreaterThan(normalized.toolCalls.length);
      return;
    case "file-mutation":
      expect(normalized.fileMutations.length).toBeGreaterThan(0);
      return;
    case "file-read":
      expect(normalized.toolCalls.some((toolCall) => toolCall.normalizedKind === "read")).toBe(true);
      return;
    case "file-search":
      expect(normalized.toolCalls.some((toolCall) => toolCall.normalizedKind === "search")).toBe(true);
      return;
    case "model-name":
      expect(normalized.messages.some((message) => Boolean(message.modelName))).toBe(true);
      return;
    case "multi-message-session":
      expect(normalized.messages.length).toBeGreaterThanOrEqual(2);
      return;
    case "partial-corrupt-raw-data":
      expect(normalized.diagnostics.some((diagnostic) => diagnostic.severity !== "info")).toBe(true);
      return;
    case "raw-pointers":
      assertRawPointers(normalized);
      return;
    case "shell-command":
      expect(normalized.shellCommands.length).toBeGreaterThan(0);
      return;
    case "shell-command-failure":
      expect(
        normalized.shellCommands.some(
          (command) =>
            (typeof command.rawExitCode === "number" && command.rawExitCode !== 0) ||
            /fail|failed|error/iu.test(command.outputInline ?? "")
        )
      ).toBe(true);
      return;
    case "sidecar-output-artifact":
      expect(normalized.outputArtifacts.length).toBeGreaterThan(0);
      expect(normalized.outputArtifacts.every((artifact) => Boolean(artifact.contentKind))).toBe(true);
      return;
    case "token-usage":
      expect(
        normalized.sessions.some((session) => typeof session.usage?.totalTokens === "number") ||
          normalized.messages.some((message) => typeof message.usage?.totalTokens === "number")
      ).toBe(true);
      return;
    case "tool-call":
      expect(normalized.toolCalls.length).toBeGreaterThan(0);
      return;
    case "active-changing-artifact":
    case "cost-estimates":
      throw new Error(`Scenario '${scenario.name}' needs an explicit supported assertion.`);
  }
}

function defaultAssertNotFabricated<TRawEvent extends RawHarnessEvent>(
  scenario: AdapterScenarioManifestEntry<TRawEvent>,
  adapterRun: ExercisedAdapter<TRawEvent>
) {
  const { normalized } = adapterRun;

  switch (scenario.name) {
    case "active-changing-artifact":
      expect(normalized.sessions.every((session) => session.lifecycleStatus !== "active")).toBe(true);
      return;
    case "cost-estimates":
      expect(
        normalized.sessions.every((session) => session.usage?.estimatedCostUsd === undefined) &&
          normalized.messages.every((message) => message.usage?.estimatedCostUsd === undefined)
      ).toBe(true);
      return;
    case "file-read":
      expect(normalized.toolCalls.some((toolCall) => toolCall.normalizedKind === "read")).toBe(false);
      return;
    case "file-search":
      expect(normalized.toolCalls.some((toolCall) => toolCall.normalizedKind === "search")).toBe(false);
      return;
    case "model-name":
      expect(normalized.messages.some((message) => Boolean(message.modelName))).toBe(false);
      return;
    case "shell-command-failure":
      expect(
        normalized.shellCommands.some(
          (command) => typeof command.rawExitCode === "number" && command.rawExitCode !== 0
        )
      ).toBe(false);
      return;
    case "token-usage":
      expect(
        normalized.sessions.some((session) => Object.keys(session.usage ?? {}).length > 0) ||
          normalized.messages.some((message) => Boolean(message.usage))
      ).toBe(false);
      return;
    default:
      return;
  }
}

function assertScenarioManifest<TRawEvent extends RawHarnessEvent>(
  adapterRun: ExercisedAdapter<TRawEvent>,
  scenarios: AdapterScenarioManifestEntry<TRawEvent>[]
) {
  expect(scenarios.length).toBeGreaterThan(0);

  const seen = new Set<AdapterScenarioName>();

  for (const scenario of scenarios) {
    expect(seen.has(scenario.name), `duplicate scenario '${scenario.name}'`).toBe(false);
    seen.add(scenario.name);

    const capabilityStatus = capabilityValueToScenarioStatus(
      readCapabilityValue(adapterRun.normalized.capabilities.adapter.capabilities, scenario.capability)
    );

    if (scenario.capability) {
      expect(capabilityStatus).toBe(scenario.status);
    }

    if (scenario.status === "supported") {
      if (scenario.assertSupported) {
        scenario.assertSupported(adapterRun);
      } else {
        defaultAssertSupported(scenario, adapterRun);
      }
    } else {
      if (scenario.assertNotFabricated) {
        scenario.assertNotFabricated(adapterRun);
      } else {
        defaultAssertNotFabricated(scenario, adapterRun);
      }
    }
  }
}

function combineSourceRuns<TRawEvent extends RawHarnessEvent>(
  adapterRun: ExercisedAdapter<TRawEvent>
): ExercisedAdapter<TRawEvent> {
  const [primaryRun] = adapterRun.sourceRuns;

  if (!primaryRun) {
    return adapterRun;
  }

  return {
    ...adapterRun,
    artifacts: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.artifacts),
    rawEvents: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.rawEvents),
    normalized: {
      ...primaryRun.normalized,
      projects: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.normalized.projects),
      sessions: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.normalized.sessions),
      events: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.normalized.events),
      messages: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.normalized.messages),
      toolCalls: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.normalized.toolCalls),
      shellCommands: adapterRun.sourceRuns.flatMap(
        (sourceRun) => sourceRun.normalized.shellCommands
      ),
      fileMutations: adapterRun.sourceRuns.flatMap(
        (sourceRun) => sourceRun.normalized.fileMutations
      ),
      outputArtifacts: adapterRun.sourceRuns.flatMap(
        (sourceRun) => sourceRun.normalized.outputArtifacts
      ),
      diagnostics: adapterRun.sourceRuns.flatMap((sourceRun) => sourceRun.normalized.diagnostics)
    }
  };
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
  const sourceRuns: ExercisedAdapterSourceRun<TRawEvent>[] = [];

  if (!sources[0]) {
    throw new Error(`Adapter '${adapter.descriptor.id}' did not discover any sources.`);
  }

  for (const discoveredSource of sources) {
    const artifacts = await collectAsync(adapter.discoverArtifacts(discoveredSource, runtimeContext));
    const rawEvents = (
      await Promise.all(
        artifacts.map((artifact) => collectAsync(adapter.parseArtifact(artifact, runtimeContext)))
      )
    ).flat();
    const normalized = await normalizeSessionSource(
      adapter,
      {
        source: discoveredSource,
        artifacts,
        rawEvents
      },
      runtimeContext
    );

    sourceRuns.push({
      source: discoveredSource,
      artifacts,
      rawEvents,
      normalized
    });
  }

  const primaryRun = sourceRuns[0];

  if (!primaryRun) {
    throw new Error(`Adapter '${adapter.descriptor.id}' did not exercise any sources.`);
  }

  const defaultRoots = await adapter.getDefaultSourceRoots(runtimeContext);
  const watchPlan = await adapter.getWatchPlan(primaryRun.source, runtimeContext);

  if (sourceRuns.length > 1) {
    await normalizeSessionSource(
      adapter,
      {
        source: primaryRun.source,
        artifacts: primaryRun.artifacts,
        rawEvents: primaryRun.rawEvents
      },
      runtimeContext
    );
  }

  return {
    context: runtimeContext,
    root: resolvedRoot,
    validation,
    sources,
    sourceRuns,
    source: primaryRun.source,
    artifacts: primaryRun.artifacts,
    rawEvents: primaryRun.rawEvents,
    normalized: primaryRun.normalized,
    defaultRoots,
    watchPlan
  };
}

export function runAdapterContractSuite<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
>({
  name,
  adapter,
  root,
  expectedDiagnosticCodes = [],
  scenarios,
  assertExercisedAdapter,
  assertNormalized
}: RunAdapterContractSuiteOptions<TRawEvent>) {
  describe(`${name} adapter contract`, () => {
    it("exposes reusable descriptor metadata", () => {
      expect(adapter.descriptor.id).toEqual(expect.any(String));
      expect(adapter.descriptor.displayName).toEqual(expect.any(String));
      expect(adapter.descriptor.adapterVersion).toEqual(expect.any(String));
      expect(adapter.descriptor.supportedPlatforms.length).toBeGreaterThan(0);
      expect(adapter.descriptor.defaultRoots.length).toBeGreaterThan(0);
    });

    it("runs validation, discovery, parsing, normalization, and diagnostics through one harness", async () => {
      const adapterRun = await exerciseAdapter(adapter, root);
      const { validation, sources, source, artifacts, rawEvents, normalized, defaultRoots, watchPlan } =
        adapterRun;

      expect(validation.ok).toBe(true);
      expect(validation.normalizedPath).toEqual(expect.any(String));
      expect(Array.isArray(validation.diagnostics)).toBe(true);

      expect(sources.length).toBeGreaterThan(0);
      expect(artifacts.length).toBeGreaterThan(0);
      expect(rawEvents.length).toBeGreaterThan(0);

      expect(defaultRoots.length).toBeGreaterThan(0);
      expect(watchPlan).toBeDefined();

      for (const artifact of artifacts) {
        expect(() => rawArtifactRefSchema.parse(artifact)).not.toThrow();
        expect(artifact.adapterId).toBe(adapter.descriptor.id);
        expect(artifact.sourceId).toBe(source.id);
      }

      for (const rawEvent of rawEvents) {
        expect(rawEvent.adapterId).toBe(adapter.descriptor.id);
        expect(rawEvent.sourceId).toBe(source.id);
      }

      expect(normalized.adapterId).toBe(adapter.descriptor.id);
      expect(normalized.sourceId).toBe(source.id);
      expect(() => normalizedResultSchema.parse(normalized)).not.toThrow();

      const validationResult = validateNormalizedResult(normalized);
      expect(validationResult.ok).toBe(true);
      expect(validationResult.diagnostics).toEqual([]);

      normalized.diagnostics.forEach((diagnostic) =>
        assertDiagnosticShape(diagnostic, adapter.descriptor.id, source.id)
      );

      for (const diagnosticCode of expectedDiagnosticCodes) {
        expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          diagnosticCode
        );
      }

      expect(findForbiddenKeys(normalized)).toEqual([]);
      assertScenarioManifest(combineSourceRuns(adapterRun), scenarios);

      assertExercisedAdapter?.(adapterRun);
      assertNormalized?.(normalized, adapterRun);
    });
  });
}
