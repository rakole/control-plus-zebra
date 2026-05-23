import type { AdapterNormalizationResult } from "../adapter-contract/types.js";

export function mergeNormalizedResults(
  results: AdapterNormalizationResult[]
): AdapterNormalizationResult | null {
  if (results.length === 0) {
    return null;
  }

  const [first] = results;

  if (!first) {
    return null;
  }

  const projects = dedupeEntities(results.flatMap((result) => result.projects));
  const sessions = dedupeEntities(results.flatMap((result) => result.sessions));
  const events = dedupeEntities(results.flatMap((result) => result.events));
  const messages = dedupeEntities(results.flatMap((result) => result.messages));
  const toolCalls = dedupeEntities(results.flatMap((result) => result.toolCalls));
  const shellCommands = dedupeEntities(results.flatMap((result) => result.shellCommands));
  const outputArtifacts = dedupeEntities(results.flatMap((result) => result.outputArtifacts));
  const fileMutations = dedupeEntities(results.flatMap((result) => result.fileMutations));
  const diagnostics = dedupeEntities(results.flatMap((result) => result.diagnostics));
  const sessionCapabilities = dedupeEntities(
    results.flatMap((result) => result.capabilities.sessions)
  );

  return {
    adapterId: first.adapterId,
    sourceId: first.sourceId,
    capabilities: {
      adapter: first.capabilities.adapter,
      source: first.capabilities.source,
      sessions: sessionCapabilities
    },
    projects,
    sessions,
    events,
    messages,
    toolCalls,
    shellCommands,
    outputArtifacts,
    fileMutations,
    diagnostics
  };
}

function dedupeEntities<T extends { id?: string; sessionId?: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();

  for (const item of items) {
    const key =
      "id" in item && typeof item.id === "string"
        ? item.id
        : "sessionId" in item && typeof item.sessionId === "string"
          ? item.sessionId
          : JSON.stringify(item);

    seen.set(key, item);
  }

  return [...seen.values()];
}

