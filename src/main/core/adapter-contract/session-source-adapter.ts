import type { AdapterId } from "../model/identifiers.js";
import type { WatchPlan } from "../watcher/watch-plan.js";
import type {
  AdapterCapabilities,
  AdapterContext,
  AdapterNormalizationInput,
  AdapterNormalizationResult,
  DiscoveredHarnessSource,
  LoadedOutputArtifact,
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
  loadOutputArtifact?(
    artifact: OutputArtifactRef,
    context: AdapterContext
  ): Promise<LoadedOutputArtifact>;
  getWatchPlan(
    source: DiscoveredHarnessSource,
    context: AdapterContext
  ): Promise<WatchPlan>;
}
