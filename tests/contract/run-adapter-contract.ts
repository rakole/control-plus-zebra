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
  defaultRoots: unknown[];
  watchPlan: unknown;
}

export interface RunAdapterContractSuiteOptions<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
  name: string;
  adapter: SessionSourceAdapter<TRawEvent>;
	  root: SourceRootConfig | string;
	  expectedCapabilityStatuses?: Record<string, "supported" | "unsupported" | "unknown">;
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
  const defaultRoots = await adapter.getDefaultSourceRoots(runtimeContext);
  const watchPlan = await adapter.getWatchPlan(source, runtimeContext);

  return {
    context: runtimeContext,
    root: resolvedRoot,
    validation,
    sources,
    source,
    artifacts,
    rawEvents,
    normalized,
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
  minimums,
  assertExercisedAdapter,
  assertNormalized
}: RunAdapterContractSuiteOptions<TRawEvent>) {
  const expectedMinimums = buildMinimums(minimums);

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

      expect(sources).toHaveLength(expectedMinimums.sources);
      expect(artifacts.length).toBeGreaterThanOrEqual(expectedMinimums.artifacts);
      expect(rawEvents.length).toBeGreaterThanOrEqual(expectedMinimums.rawEvents);

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

      assertExercisedAdapter?.(adapterRun);
      assertNormalized?.(normalized, adapterRun);
    });
  });
}
