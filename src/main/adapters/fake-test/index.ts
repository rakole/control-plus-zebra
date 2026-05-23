import type { SessionSourceAdapter } from "../../core/adapter-contract/session-source-adapter.js";

import { fakeTestDescriptor } from "./descriptor.js";
import {
  discoverFakeTestArtifacts,
  discoverFakeTestSources,
  validateFakeTestSourceRoot
} from "./discovery.js";
import { normalizeFakeTestEvents } from "./normalize.js";
import { parseFakeTestArtifact, type FakeRawEvent } from "./parse.js";
import type { WatchPlan } from "../../core/watcher/watch-plan.js";

export const fakeTestAdapter: SessionSourceAdapter<FakeRawEvent> = {
  descriptor: fakeTestDescriptor,
  validateSourceRoot: validateFakeTestSourceRoot,
  discoverSources: discoverFakeTestSources,
  discoverArtifacts: discoverFakeTestArtifacts,
  parseArtifact: parseFakeTestArtifact,
  normalize: normalizeFakeTestEvents,
  async getWatchPlan(source): Promise<WatchPlan> {
    return {
      adapterId: fakeTestDescriptor.id,
      sourceId: source.id,
      status: fakeTestDescriptor.capabilities.watchPlans.status,
      scopePaths: [],
      strategy: "none",
      ...(fakeTestDescriptor.capabilities.watchPlans.reason
        ? { reason: fakeTestDescriptor.capabilities.watchPlans.reason }
        : {})
    };
  }
};

export { fakeTestDescriptor } from "./descriptor.js";
export type { FakeRawEvent } from "./parse.js";
export * from "./types.js";
