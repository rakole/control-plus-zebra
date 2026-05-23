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

export interface HarnessDescriptor {
  id: AdapterId;
  displayName: string;
  vendor?: string;
  adapterVersion: string;
  supportedPlatforms: SupportedPlatform[];
  defaultRoots: SourceRootHint[];
  capabilities: HarnessCapabilities;
}

export interface SessionSourceAdapter<
  TRawEvent extends RawHarnessEvent = RawHarnessEvent
> {
  descriptor: HarnessDescriptor;
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
    artifact: OutputArtifact,
    context: AdapterContext
  ): Promise<LoadedOutputArtifact>;
}
