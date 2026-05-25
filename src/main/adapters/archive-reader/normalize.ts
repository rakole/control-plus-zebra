import type {
  AdapterNormalizationInput,
  AdapterNormalizationResult,
  RawHarnessEvent
} from "../../core/adapter-contract/index.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../core/model/confidence.js";
import type { WatchPlan } from "../../core/watcher/watch-plan.js";
import { archiveReaderCapabilities, archiveReaderDescriptor } from "./descriptor.js";

export interface ArchiveReaderRawEvent extends RawHarnessEvent<{
  kind: "archive-document";
  document: unknown;
}> {}

export async function* parseArchiveReaderArtifact(): AsyncIterable<ArchiveReaderRawEvent> {
  return;
}

export async function normalizeArchiveReaderEvents(
  input: AdapterNormalizationInput<ArchiveReaderRawEvent>
): Promise<AdapterNormalizationResult> {
  const archiveEvent = input.rawEvents.find(
    (event) => event.payload.kind === "archive-document"
  );
  const diagnostics = archiveEvent
    ? []
    : [
        buildDiagnostic(
          archiveReaderDescriptor.id,
          "archive-reader.normalize.archive-missing",
          "Imported archives are hydrated at import time and do not support live rescans.",
          "warning",
          "source",
          HIGH_CONFIDENCE,
          {
            sourceId: input.source.id,
            nativeId: input.source.nativeId
          }
        )
      ];

  return {
    adapterId: archiveReaderDescriptor.id,
    sourceId: input.source.id,
    capabilities: {
      adapter: {
        adapterId: archiveReaderDescriptor.id,
        capabilities: archiveReaderCapabilities
      },
      source: {
        adapterId: archiveReaderDescriptor.id,
        sourceId: input.source.id,
        capabilities: archiveReaderCapabilities
      },
      sessions: []
    },
    projects: [],
    sessions: [],
    events: [],
    messages: [],
    toolCalls: [],
    shellCommands: [],
    outputArtifacts: [],
    fileMutations: [],
    diagnostics
  };
}

export async function getArchiveReaderWatchPlan(sourceId: string): Promise<WatchPlan> {
  return {
    adapterId: archiveReaderDescriptor.id,
    sourceId,
    status: "unsupported",
    scopePaths: [],
    strategy: "none",
    reason: "Imported archives are read-only snapshots and are not watchable sources."
  };
}
