import path from "node:path";

import {
  getSessionByIdRequestSchema,
  sessionDetailViewModelSchema,
  type GetSessionByIdRequest,
  type SessionDetailViewModel
} from "../ipc/view-models.js";
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

      const detail = {
        session: buildSessionPreviewViewModel(data, session),
        timeline: (data.eventsBySessionId.get(session.id) ?? [])
          .slice()
          .sort((left, right) => {
            const leftStamp = left.timestamp ?? "";
            const rightStamp = right.timestamp ?? "";

            if (leftStamp !== rightStamp) {
              return leftStamp.localeCompare(rightStamp);
            }

            return left.ordinal - right.ordinal;
          })
          .map((event) => {
            const message = event.messageId
              ? (data.messagesBySessionId.get(session.id) ?? []).find(
                  (candidate) => candidate.id === event.messageId
                )
              : undefined;
            const toolCall = event.toolCallId
              ? (data.toolCallsBySessionId.get(session.id) ?? []).find(
                  (candidate) => candidate.id === event.toolCallId
                )
              : undefined;
            const shellCommand = event.shellCommandId
              ? (data.shellCommandsBySessionId.get(session.id) ?? []).find(
                  (candidate) => candidate.id === event.shellCommandId
                )
              : undefined;
            const derivedCommand = event.shellCommandId
              ? getDerivedSession(data, session.id)?.shellCommands.find(
                  (candidate) => candidate.shellCommandId === event.shellCommandId
                )
              : undefined;
            const outputArtifact = event.outputArtifactId
              ? (data.outputArtifactsBySessionId.get(session.id) ?? []).find(
                  (candidate) => candidate.id === event.outputArtifactId
                )
              : undefined;
            const fileMutation = event.fileMutationId
              ? (data.fileMutationsBySessionId.get(session.id) ?? []).find(
                  (candidate) => candidate.id === event.fileMutationId
                )
              : undefined;

            switch (event.eventKind) {
              case "message":
                return {
                  id: event.id,
                  kind: "message" as const,
                  timestamp: event.timestamp,
                  title: `${humanizeMessageRole(message?.role)} message`,
                  summary: message ? truncate(message.content, 220) : event.summary,
                  metadata: [
                    { label: "Role", value: humanizeMessageRole(message?.role) },
                    { label: "Ordinal", value: String(message?.ordinal ?? event.ordinal) }
                  ]
                };
              case "lifecycle":
                return {
                  id: event.id,
                  kind: "lifecycle" as const,
                  timestamp: event.timestamp,
                  title: event.summary ?? "Lifecycle event",
                  summary: "Chronological lifecycle evidence",
                  metadata: [{ label: "Ordinal", value: String(event.ordinal) }]
                };
              case "tool-call":
                return {
                  id: event.id,
                  kind: "tool-call" as const,
                  timestamp: event.timestamp,
                  title: toolCall?.toolName ?? "Tool call",
                  summary: toolCall?.outputSummary ?? toolCall?.inputSummary ?? event.summary,
                  metadata: [
                    {
                      label: "Status",
                      value: humanizeToolStatus(toolCall?.status)
                    },
                    {
                      label: "Artifacts",
                      value: String(toolCall?.artifactIds?.length ?? 0)
                    }
                  ]
                };
              case "shell-command":
                return {
                  id: event.id,
                  kind: "shell-command" as const,
                  timestamp: event.timestamp,
                  title: shellCommand?.command ?? event.summary ?? "Shell command",
                  summary: shellCommand?.outputSummary ?? undefined,
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
                        shellCommand?.exitCode !== undefined
                          ? String(shellCommand.exitCode)
                          : "Unknown"
                    }
                  ]
                };
              case "output-artifact":
                return {
                  id: event.id,
                  kind: "output-artifact" as const,
                  timestamp: event.timestamp,
                  title: "Output artifact",
                  summary: event.summary ?? summarizeArtifact(outputArtifact),
                  metadata: [
                    {
                      label: "Kind",
                      value: outputArtifact?.artifactKind ?? "unknown"
                    },
                    {
                      label: "Reference",
                      value: summarizeArtifact(outputArtifact)
                    }
                  ]
                };
              case "file-mutation":
                return {
                  id: event.id,
                  kind: "file-mutation" as const,
                  timestamp: event.timestamp,
                  title: summarizeFileMutation(fileMutation),
                  summary: fileMutation?.path ?? event.summary,
                  metadata: [
                    {
                      label: "Mutation",
                      value: humanizeMutationKind(fileMutation?.mutationKind)
                    }
                  ]
                };
              case "metadata":
                return {
                  id: event.id,
                  kind: "unknown" as const,
                  timestamp: event.timestamp,
                  title: "Unknown evidence marker",
                  summary: event.summary ?? "Metadata evidence is available only as a safe marker.",
                  metadata: [{ label: "Ordinal", value: String(event.ordinal) }]
                };
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

function humanizeToolStatus(status?: string): string {
  if (!status) {
    return "Unknown";
  }

  return status.replace(/-/gu, " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function summarizeArtifact(
  artifact?: { path?: string; artifactKind?: string; mediaType?: string }
): string {
  if (!artifact) {
    return "Unknown";
  }

  if (artifact.path) {
    return path.basename(artifact.path);
  }

  return artifact.mediaType ?? artifact.artifactKind ?? "Unknown";
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
