import path from "node:path";

import {
  getSessionByIdRequestSchema,
  sessionDetailViewModelSchema,
  type GetSessionByIdRequest,
  type SessionDetailViewModel
} from "../ipc/view-models.js";
import type { OutputArtifact } from "../core/model/entities.js";
import {
  buildSessionPreviewViewModel,
  getDerivedSession,
  loadTriageData
} from "./triage-view-model-service.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

export interface SessionDetailViewModelService {
  getSessionDetail(
    request: GetSessionByIdRequest
  ): Promise<SessionDetailViewModel | null>;
}

export interface SessionDetailViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createSessionDetailViewModelService(
  options: SessionDetailViewModelServiceOptions = {}
): SessionDetailViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    async getSessionDetail(request) {
      const parsed = getSessionByIdRequestSchema.parse(request);
      const data = await loadTriageData(runtime);
      const session = data.sessionsById.get(parsed.sessionId);

      if (!session) {
        return null;
      }

      const sessionEvents = (data.eventsBySessionId.get(session.id) ?? [])
        .slice()
        .sort(compareEventsForTimeline);
      const sessionMessages = data.messagesBySessionId.get(session.id) ?? [];
      const sessionToolCalls = data.toolCallsBySessionId.get(session.id) ?? [];
      const sessionShellCommands = data.shellCommandsBySessionId.get(session.id) ?? [];
      const sessionOutputArtifacts = data.outputArtifactsBySessionId.get(session.id) ?? [];
      const sessionFileMutations = data.fileMutationsBySessionId.get(session.id) ?? [];
      const messagesByEventId = buildEntityByEventId(sessionMessages, (message) => message.eventIds ?? []);
      const toolCallsByEventId = buildFirstEntityBySourceEventId(sessionToolCalls);
      const shellCommandsByEventId = buildFirstEntityBySourceEventId(sessionShellCommands);
      const outputArtifactsByEventId = buildEntitiesBySourceEventId(sessionOutputArtifacts);
      const fileMutationsByEventId = buildFirstEntityBySourceEventId(sessionFileMutations);

      const detail = {
        session: buildSessionPreviewViewModel(data, session),
        timeline: sessionEvents.flatMap<SessionDetailViewModel["timeline"][number]>((event) => {
            const message = messagesByEventId.get(event.id);
            const toolCall = toolCallsByEventId.get(event.id);
            const shellCommand = shellCommandsByEventId.get(event.id);
            const derivedCommand = shellCommand
              ? getDerivedSession(data, session.id)?.shellCommands.find(
                  (candidate) => candidate.shellCommandId === shellCommand.id
                )
              : undefined;
            const outputArtifacts = getOutputArtifactsForEvent(
              sessionOutputArtifacts,
              outputArtifactsByEventId,
              event
            );
            const fileMutation = fileMutationsByEventId.get(event.id);

            switch (event.kind) {
              case "message":
                return [{
                  id: event.id,
                  kind: "message" as const,
                  timestamp: event.timestamp,
                  title: `${humanizeMessageRole(message?.role)} message`,
                  summary: truncate(message?.text ?? event.text ?? event.title ?? "", 220),
                  metadata: [
                    { label: "Role", value: humanizeMessageRole(message?.role) },
                    { label: "Order Key", value: event.orderKey ?? "Unknown" }
                  ]
                }];
              case "lifecycle":
                return [{
                  id: event.id,
                  kind: "lifecycle" as const,
                  timestamp: event.timestamp,
                  title: event.title ?? "Lifecycle event",
                  summary: event.text ?? "Chronological lifecycle evidence",
                  metadata: [{ label: "Order Key", value: event.orderKey ?? "Unknown" }]
                }];
              case "tool-call":
                return [{
                  id: event.id,
                  kind: "tool-call" as const,
                  timestamp: event.timestamp,
                  title: toolCall?.name ?? event.title ?? "Tool call",
                  summary: toolCall?.resultPreview ?? toolCall?.argsPreview ?? event.text,
                  metadata: [
                    {
                      label: "Status",
                      value: humanizeToolCallStatus(toolCall)
                    },
                    {
                      label: "Artifacts",
                      value: String(toolCall?.outputArtifactIds?.length ?? 0)
                    }
                  ]
                }];
              case "shell-command":
                return [{
                  id: event.id,
                  kind: "shell-command" as const,
                  timestamp: event.timestamp,
                  title: shellCommand?.command ?? event.title ?? "Shell command",
                  summary: shellCommand?.outputInline ?? event.text,
                  metadata: [
                    {
                      label: "Intent",
                      value: humanizeIntent(derivedCommand?.intent)
                    },
                    {
                      label: "Result",
                      value: humanizeCommandResult(derivedCommand?.result)
                    },
                    {
                      label: "Exit Code",
                      value:
                        shellCommand?.rawExitCode !== undefined
                          ? String(shellCommand.rawExitCode)
                          : "Unknown"
                    }
                  ]
                }];
              case "tool-result":
                if (outputArtifacts.length === 0) {
                  return [{
                    id: event.id,
                    kind: "output-artifact" as const,
                    timestamp: event.timestamp,
                    title: "Output artifact",
                    summary: event.text ?? "Output artifact",
                    metadata: [
                      {
                        label: "Kind",
                        value: "unknown"
                      },
                      {
                        label: "Reference",
                        value: event.text ?? event.title ?? "Unknown"
                      }
                    ]
                  }];
                }

                return outputArtifacts.map((artifact) => ({
                  id: artifact.id,
                  kind: "output-artifact" as const,
                  timestamp: event.timestamp,
                  title: "Output artifact",
                  summary: summarizeArtifact(artifact) ?? event.text ?? "Output artifact",
                  metadata: [
                    {
                      label: "Kind",
                      value: summarizeArtifactKind(artifact)
                    },
                    {
                      label: "Reference",
                      value: summarizeArtifact(artifact) ?? "Unknown"
                    }
                  ]
                }));
              case "file-event":
                return [{
                  id: event.id,
                  kind: "file-mutation" as const,
                  timestamp: event.timestamp,
                  title: summarizeFileMutation(fileMutation),
                  summary: fileMutation?.path ?? event.text,
                  metadata: [
                    {
                      label: "Mutation",
                      value: humanizeMutationKind(fileMutation?.mutationKind)
                    }
                  ]
                }];
              case "metadata":
                return [{
                  id: event.id,
                  kind: "unknown" as const,
                  timestamp: event.timestamp,
                  title: "Unknown evidence marker",
                  summary: event.text ?? "Metadata evidence is available only as a safe marker.",
                  metadata: [{ label: "Order Key", value: event.orderKey ?? "Unknown" }]
                }];
              default:
                return [{
                  id: event.id,
                  kind: "unknown" as const,
                  timestamp: event.timestamp,
                  title: event.title ?? "Unknown evidence marker",
                  summary: event.text ?? "Timeline evidence is available as a safe marker.",
                  metadata: [{ label: "Order Key", value: event.orderKey ?? "Unknown" }]
                }];
            }
          })
      };

      return sessionDetailViewModelSchema.parse(detail);
    }
  };
}

function humanizeCommandResult(result?: string): string {
  switch (result) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    default:
      return "Unknown";
  }
}

function humanizeIntent(intent?: string): string {
  if (!intent) {
    return "Unknown";
  }

  return intent.replace(/^./u, (letter) => letter.toUpperCase());
}

function humanizeMessageRole(role?: string): string {
  if (!role) {
    return "Unknown";
  }

  return role.replace(/^./u, (letter) => letter.toUpperCase());
}

function humanizeMutationKind(kind?: string): string {
  if (!kind) {
    return "Unknown";
  }

  return kind.replace(/^./u, (letter) => letter.toUpperCase());
}

function humanizeToolCallStatus(
  toolCall?: {
    statusNormalized?: string;
    statusRaw?: string;
  }
): string {
  const status = toolCall?.statusNormalized ?? toolCall?.statusRaw;

  if (!status) {
    return "Unknown";
  }

  return status.replace(/-/gu, " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function summarizeArtifact(
  artifact?: {
    path?: string;
    nativeRef?: string;
    kind?: string;
    contentKind?: string;
    mediaType?: string;
  }
): string | undefined {
  if (!artifact) {
    return undefined;
  }

  if (artifact.path) {
    return path.basename(artifact.path);
  }

  return artifact.nativeRef ?? artifact.mediaType ?? artifact.contentKind ?? artifact.kind;
}

function summarizeArtifactKind(
  artifact?: { kind?: string; contentKind?: string }
): string {
  if (!artifact) {
    return "unknown";
  }

  return artifact.contentKind ?? artifact.kind ?? "unknown";
}

function summarizeFileMutation(
  mutation?: { mutationKind?: string; path?: string }
): string {
  if (!mutation) {
    return "File mutation";
  }

  return `${humanizeMutationKind(mutation.mutationKind)} ${mutation.path ?? "file"}`;
}

function truncate(value: string, limit: number): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();

  if (collapsed.length <= limit) {
    return collapsed;
  }

  return `${collapsed.slice(0, limit - 1)}...`;
}

function compareEventsForTimeline(
  left: { orderKey?: string; timestamp?: string },
  right: { orderKey?: string; timestamp?: string }
): number {
  const leftOrder = left.orderKey ?? "";
  const rightOrder = right.orderKey ?? "";

  if (leftOrder !== rightOrder) {
    return leftOrder.localeCompare(rightOrder);
  }

  return (left.timestamp ?? "").localeCompare(right.timestamp ?? "");
}

function buildEntityByEventId<TItem extends { id: string }>(
  items: readonly TItem[],
  selectEventIds: (item: TItem) => readonly string[]
): Map<string, TItem> {
  const map = new Map<string, TItem>();

  for (const item of items) {
    for (const eventId of selectEventIds(item)) {
      if (!map.has(eventId)) {
        map.set(eventId, item);
      }
    }
  }

  return map;
}

function buildFirstEntityBySourceEventId<
  TItem extends {
    source?:
      | { eventId?: string | undefined; rawEvent?: { eventId?: string | undefined } | undefined }
      | undefined;
  }
>(
  items: readonly TItem[]
): Map<string, TItem> {
  const map = new Map<string, TItem>();

  for (const item of items) {
    const eventId = item.source?.eventId ?? item.source?.rawEvent?.eventId;

    if (eventId && !map.has(eventId)) {
      map.set(eventId, item);
    }
  }

  return map;
}

function buildEntitiesBySourceEventId<
  TItem extends {
    source?:
      | { eventId?: string | undefined; rawEvent?: { eventId?: string | undefined } | undefined }
      | undefined;
  }
>(
  items: readonly TItem[]
): Map<string, TItem[]> {
  const map = new Map<string, TItem[]>();

  for (const item of items) {
    const eventId = item.source?.eventId ?? item.source?.rawEvent?.eventId;

    if (!eventId) {
      continue;
    }

    const current = map.get(eventId) ?? [];

    current.push(item);
    map.set(eventId, current);
  }

  return map;
}

function getOutputArtifactsForEvent(
  artifacts: readonly OutputArtifact[],
  artifactsByEventId: Map<string, readonly OutputArtifact[]>,
  event: {
    id: string;
    nativeId?: string;
    title?: string;
    text?: string;
  }
): readonly OutputArtifact[] {
  const directMatches = artifactsByEventId.get(event.id) ?? [];

  if (directMatches.length > 0) {
    return directMatches;
  }

  const eventReferences = new Set(
    [event.id, event.nativeId, event.title, event.text]
      .flatMap((value) => normalizeArtifactReference(value))
  );

  if (eventReferences.size === 0) {
    return [];
  }

  return artifacts.filter((artifact) =>
    [artifact.nativeRef, artifact.nativeId, artifact.path]
      .flatMap((value) => normalizeArtifactReference(value))
      .some((reference) => eventReferences.has(reference))
  );
}

function normalizeArtifactReference(value?: string): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const normalizedValues = new Set<string>();
  const prefixes = ["session-event:", "artifact:"];
  const queue = [trimmed];

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current) {
      continue;
    }

    const normalized = path.normalize(current).replace(/\\/gu, "/");

    if (normalized.length > 0) {
      normalizedValues.add(normalized);
    }

    for (const prefix of prefixes) {
      if (current.startsWith(prefix)) {
        queue.push(current.slice(prefix.length));
      }
    }
  }

  return [...normalizedValues];
}
