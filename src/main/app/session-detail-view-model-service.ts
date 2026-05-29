import path from "node:path";

import {
  getSessionByIdRequestSchema,
  getSessionTimelineRequestSchema,
  sessionDetailViewModelSchema,
  type GetSessionByIdRequest,
  type GetSessionTimelineRequest,
  type SessionDetailViewModel
} from "../ipc/view-models.js";
import type { WorkbenchTimelineRecord } from "../core/store/workbench-entity-store.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";
import { createSessionViewModelService } from "./session-view-model-service.js";
import {
  collectAllSessionTimelineRecords,
  collectSessionTimelineRecords,
  findStoreSessionLocation
} from "./store-session-query.js";

const TIMELINE_SUMMARY_MAX_LENGTH = 2_000;

export interface SessionDetailViewModelService {
  getSessionDetail(
    request: GetSessionByIdRequest
  ): Promise<SessionDetailViewModel | null>;
  getSessionTimeline?(request: GetSessionTimelineRequest): Promise<{
    pageInfo: { hasMore: boolean; nextCursor?: string; totalCount: number };
    timeline: SessionDetailViewModel["timeline"] | null;
  }>;
}

export interface SessionDetailViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createSessionDetailViewModelService(
  options: SessionDetailViewModelServiceOptions = {}
): SessionDetailViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const sessionService = createSessionViewModelService({ runtime });

  return {
    async getSessionDetail(request) {
      const parsed = getSessionByIdRequestSchema.parse(request);
      const location = await findStoreSessionLocation(runtime, parsed.sessionId);

      if (!location) {
        return null;
      }

      const [preview, timelineRecords] = await Promise.all([
        sessionService.getSessionById({ sessionId: parsed.sessionId }),
        collectAllSessionTimelineRecords(runtime, location.source.sourceId, parsed.sessionId)
      ]);

      if (!preview) {
        return null;
      }

      return sessionDetailViewModelSchema.parse({
        session: preview,
        timeline: buildTimelineEventsFromStore(timelineRecords)
      });
    },

    async getSessionTimeline(request) {
      const parsed = getSessionTimelineRequestSchema.parse(request);
      const location = await findStoreSessionLocation(runtime, parsed.sessionId);

      if (!location) {
        return {
          timeline: null,
          pageInfo: {
            hasMore: false,
            totalCount: 0
          }
        };
      }

      const page = await collectSessionTimelineRecords(runtime, {
        sourceId: location.source.sourceId,
        sessionId: parsed.sessionId,
        ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {})
      });

      return {
        timeline: buildTimelineEventsFromStore(page.items),
        pageInfo: {
          hasMore: page.pageInfo.hasMore,
          ...(page.pageInfo.nextCursor ? { nextCursor: page.pageInfo.nextCursor } : {}),
          totalCount: page.pageInfo.totalCount ?? page.items.length
        }
      };
    }
  };
}

export function buildTimelineEventsFromStore(
  records: WorkbenchTimelineRecord[]
): SessionDetailViewModel["timeline"] {
  return records.flatMap<SessionDetailViewModel["timeline"][number]>((record) => {
    const event = record.event;
    const message = record.message;
    const toolCall = record.toolCall;
    const shellCommand = record.shellCommand;
    const outputArtifacts = record.outputArtifacts ?? [];
    const fileMutation = record.fileMutation;

    switch (event.kind) {
      case "message":
        return [{
          id: event.id,
          kind: "message" as const,
          timestamp: event.timestamp,
          title: `${humanizeMessageRole(message?.role)} message`,
          ...(truncateNonEmpty(message?.text, event.text, event.title, 220)
            ? { summary: truncateNonEmpty(message?.text, event.text, event.title, 220) }
            : {}),
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
          title: firstNonEmpty(event.title) ?? "Lifecycle event",
          summary: firstNonEmpty(event.text) ?? "Chronological lifecycle evidence",
          metadata: [{ label: "Order Key", value: event.orderKey ?? "Unknown" }]
        }];
      case "tool-call":
        return [{
          id: event.id,
          kind: "tool-call" as const,
          timestamp: event.timestamp,
          title: firstNonEmpty(toolCall?.name, event.title) ?? "Tool call",
          ...(firstNonEmpty(toolCall?.resultPreview, toolCall?.argsPreview, event.text)
            ? {
                summary: truncateNonEmpty(
                  toolCall?.resultPreview,
                  toolCall?.argsPreview,
                  event.text,
                  TIMELINE_SUMMARY_MAX_LENGTH
                )
              }
            : {}),
          metadata: [
            { label: "Status", value: humanizeToolCallStatus(toolCall) },
            { label: "Artifacts", value: String(toolCall?.outputArtifactIds?.length ?? 0) }
          ]
        }];
      case "shell-command":
        return [{
          id: event.id,
          kind: "shell-command" as const,
          timestamp: event.timestamp,
          title: firstNonEmpty(shellCommand?.command, event.title) ?? "Shell command",
          ...(firstNonEmpty(shellCommand?.outputInline, event.text)
            ? {
                summary: truncateNonEmpty(
                  shellCommand?.outputInline,
                  event.text,
                  undefined,
                  TIMELINE_SUMMARY_MAX_LENGTH
                )
              }
            : {}),
          metadata: [
            { label: "Intent", value: "Unknown" },
            { label: "Result", value: "Unknown" },
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
            summary: firstNonEmpty(event.text) ?? "Output artifact",
            metadata: [
              { label: "Kind", value: "unknown" },
              { label: "Reference", value: firstNonEmpty(event.text, event.title) ?? "Unknown" }
            ]
          }];
        }

        return outputArtifacts.map((artifact) => ({
          id: artifact.id,
          kind: "output-artifact" as const,
          timestamp: event.timestamp,
          title: "Output artifact",
          summary: firstNonEmpty(summarizeArtifact(artifact), event.text) ?? "Output artifact",
          metadata: [
            { label: "Kind", value: summarizeArtifactKind(artifact) },
            { label: "Reference", value: firstNonEmpty(summarizeArtifact(artifact)) ?? "Unknown" }
          ]
        }));
      case "file-event":
        return [{
          id: event.id,
          kind: "file-mutation" as const,
          timestamp: event.timestamp,
          title: summarizeFileMutation(fileMutation),
          ...(firstNonEmpty(fileMutation?.path, event.text)
            ? { summary: firstNonEmpty(fileMutation?.path, event.text) }
            : {}),
          metadata: [
            { label: "Mutation", value: humanizeMutationKind(fileMutation?.mutationKind) }
          ]
        }];
      case "metadata":
        return [{
          id: event.id,
          kind: "metadata" as const,
          timestamp: event.timestamp,
          title: "Session metadata",
          summary: firstNonEmpty(event.text, event.title) ?? "Session metadata is available as a safe marker.",
          metadata: [{ label: "Order Key", value: event.orderKey ?? "Unknown" }]
        }];
      default:
        return [{
          id: event.id,
          kind: "unknown" as const,
          timestamp: event.timestamp,
          title: firstNonEmpty(event.title) ?? "Unknown evidence marker",
          summary: firstNonEmpty(event.text) ?? "Timeline evidence is available as a safe marker.",
          metadata: [{ label: "Order Key", value: event.orderKey ?? "Unknown" }]
        }];
    }
  });
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
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

  return `${collapsed.slice(0, Math.max(0, limit - 3))}...`;
}

function truncateNonEmpty(
  first: string | undefined,
  second: string | undefined,
  third: string | undefined,
  limit: number
): string | undefined {
  const value = firstNonEmpty(first, second, third);
  return value ? truncate(value, limit) : undefined;
}
