import type { AdapterId } from "../model/identifiers.js";
import type { WatchPlan } from "../watcher/watch-plan.js";
import type {
  AdapterBatchStreamingNormalizationInput,
  AdapterCapabilities,
  AdapterContext,
  AdapterNormalizationInput,
  AdapterNormalizationResult,
  AdapterStreamingNormalizationInput,
  DiscoveredHarnessSource,
  LoadedOutputArtifact,
  LoadableOutputArtifact,
  OutputArtifactRef,
  RawArtifactRef,
  RawHarnessEvent,
  SourceRootConfig,
  SourceRootHint,
  SourceRootValidation,
  SupportedPlatform
} from "./types.js";

export interface HarnessDescriptor {
  id: AdapterId;
  displayName: string;
  vendor?: string;
  adapterVersion: string;
  parserVersion?: string;
  supportedPlatforms: SupportedPlatform[];
  defaultRoots: SourceRootHint[];
  capabilities: AdapterCapabilities;
}

export interface SessionSourceAdapter<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
  descriptor: HarnessDescriptor;
  getDefaultSourceRoots(
    context: AdapterContext
  ): Promise<SourceRootHint[]>;
  validateSourceRoot(
    root: SourceRootConfig,
    context: AdapterContext
  ): Promise<SourceRootValidation>;
  discoverSources(
    root: SourceRootConfig,
    context: AdapterContext
  ): AsyncIterable<DiscoveredHarnessSource>;
  discoverArtifacts(
    source: DiscoveredHarnessSource,
    context: AdapterContext
  ): AsyncIterable<RawArtifactRef>;
  parseArtifact(
    artifact: RawArtifactRef,
    context: AdapterContext
  ): AsyncIterable<TRawEvent>;
  normalize(
    input: AdapterNormalizationInput<TRawEvent>,
    context: AdapterContext
  ): Promise<AdapterNormalizationResult>;
  normalizeStream?(
    input: AdapterStreamingNormalizationInput<TRawEvent>,
    context: AdapterContext
  ): Promise<AdapterNormalizationResult>;
  normalizeBatches?(
    input: AdapterBatchStreamingNormalizationInput<TRawEvent>,
    context: AdapterContext
  ): AsyncIterable<AdapterNormalizationResult>;
  loadOutputArtifact?(
    artifact: LoadableOutputArtifact,
    context: AdapterContext
  ): Promise<LoadedOutputArtifact>;
  getWatchPlan(
    source: DiscoveredHarnessSource,
    context: AdapterContext
  ): Promise<WatchPlan>;
}

export async function normalizeSessionSource<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
>(
  adapter: SessionSourceAdapter<TRawEvent>,
  input: AdapterStreamingNormalizationInput<TRawEvent>,
  context: AdapterContext
): Promise<AdapterNormalizationResult> {
  if (adapter.normalizeStream) {
    return adapter.normalizeStream(input, context);
  }

  return adapter.normalize(input, context);
}

export async function* streamNormalizedSessionSource<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
>(
  adapter: SessionSourceAdapter<TRawEvent>,
  input: AdapterBatchStreamingNormalizationInput<TRawEvent>,
  context: AdapterContext
): AsyncIterable<AdapterNormalizationResult> {
  if (adapter.normalizeBatches) {
    yield* adapter.normalizeBatches(input, context);
    return;
  }

  const rawEvents = await collectAsync(input.rawEvents);

  yield await normalizeSessionSource(
    adapter,
    {
      ...input,
      rawEvents
    },
    context
  );
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}
