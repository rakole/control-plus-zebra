import type { SessionSourceAdapter } from "../../core/adapter-contract/session-source-adapter.js";

import { archiveReaderDescriptor } from "./descriptor.js";
import {
  discoverArchiveReaderArtifacts,
  discoverArchiveReaderSources,
  validateArchiveReaderSourceRoot
} from "./discovery.js";
import {
  getArchiveReaderWatchPlan,
  normalizeArchiveReaderEvents,
  parseArchiveReaderArtifact,
  type ArchiveReaderRawEvent
} from "./normalize.js";

export const archiveReaderAdapter: SessionSourceAdapter<ArchiveReaderRawEvent> = {
  descriptor: archiveReaderDescriptor,
  async getDefaultSourceRoots() {
    return archiveReaderDescriptor.defaultRoots;
  },
  validateSourceRoot: validateArchiveReaderSourceRoot,
  discoverSources: discoverArchiveReaderSources,
  discoverArtifacts: discoverArchiveReaderArtifacts,
  parseArtifact: parseArchiveReaderArtifact,
  normalize: normalizeArchiveReaderEvents,
  async getWatchPlan(source) {
    return getArchiveReaderWatchPlan(source.id);
  }
};

export { archiveReaderDescriptor } from "./descriptor.js";
