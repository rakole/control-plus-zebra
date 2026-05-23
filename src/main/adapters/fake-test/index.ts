import type { SessionSourceAdapter } from "../../core/adapter-contract/session-source-adapter.js";

import { fakeTestDescriptor } from "./descriptor.js";
import {
  discoverFakeTestArtifacts,
  discoverFakeTestSources,
  validateFakeTestSourceRoot
} from "./discovery.js";
import { normalizeFakeTestEvents } from "./normalize.js";
import { parseFakeTestArtifact, type FakeRawEvent } from "./parse.js";

export const fakeTestAdapter: SessionSourceAdapter<FakeRawEvent> = {
  descriptor: fakeTestDescriptor,
  validateSourceRoot: validateFakeTestSourceRoot,
  discoverSources: discoverFakeTestSources,
  discoverArtifacts: discoverFakeTestArtifacts,
  parseArtifact: parseFakeTestArtifact,
  normalize: normalizeFakeTestEvents
};

export { fakeTestDescriptor } from "./descriptor.js";
export type { FakeRawEvent } from "./parse.js";
export * from "./types.js";
