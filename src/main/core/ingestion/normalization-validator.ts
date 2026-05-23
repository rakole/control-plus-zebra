import { buildDiagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../model/confidence.js";
import type { AdapterNormalizationResult } from "../adapter-contract/types.js";

export const NORMALIZATION_SCHEMA_VERSION = "1";

export interface NormalizationValidationResult {
  ok: boolean;
  diagnostics: ReturnType<typeof buildDiagnostic>[];
}

export function validateNormalizedResult(
  result: AdapterNormalizationResult
): NormalizationValidationResult {
  const diagnostics = [
    ...validateSourceOwnership(result),
    ...validateRelationships(result)
  ];

  return {
    ok: diagnostics.length === 0,
    diagnostics
  };
}

function validateSourceOwnership(result: AdapterNormalizationResult) {
  const diagnostics = [];
  const collections = [
    ...result.projects,
    ...result.sessions,
    ...result.events,
    ...result.messages,
    ...result.toolCalls,
    ...result.shellCommands,
    ...result.outputArtifacts,
    ...result.fileMutations
  ];

  for (const entity of collections) {
    if (entity.adapterId !== result.adapterId || entity.sourceId !== result.sourceId) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.invalid-source-ownership",
          "Normalized entities must retain the parent adapter and source identity.",
          "error",
          "source",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: entity.id,
            relatedEntityIds: [entity.id]
          }
        )
      );
    }
  }

  return diagnostics;
}

function validateRelationships(result: AdapterNormalizationResult) {
  const diagnostics = [];
  const projectIds = new Set(result.projects.map((project) => project.id));
  const sessionIds = new Set(result.sessions.map((session) => session.id));
  const eventIds = new Set(result.events.map((event) => event.id));
  const toolCallIds = new Set(result.toolCalls.map((toolCall) => toolCall.id));
  const outputArtifactIds = new Set(result.outputArtifacts.map((artifact) => artifact.id));
  const fileMutationIds = new Set(result.fileMutations.map((mutation) => mutation.id));

  for (const session of result.sessions) {
    if (session.projectId && !projectIds.has(session.projectId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.missing-project",
          "A normalized session referenced a project that was not present in the same result.",
          "error",
          "session",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: session.id,
            relatedEntityIds: [session.id, session.projectId]
          }
        )
      );
    }
  }

  for (const event of result.events) {
    if (!sessionIds.has(event.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.missing-session",
          "A normalized event referenced a session that was not present in the same result.",
          "error",
          "event",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: event.id,
            relatedEntityIds: [event.id, event.sessionId]
          }
        )
      );
    }
  }

  for (const message of result.messages) {
    if (!sessionIds.has(message.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.message-missing-session",
          "A normalized message referenced a missing session.",
          "error",
          "message",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: message.id,
            relatedEntityIds: [message.id, message.sessionId]
          }
        )
      );
    }

    if (message.eventId && !eventIds.has(message.eventId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.message-missing-event",
          "A normalized message referenced a missing session event.",
          "error",
          "message",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: message.id,
            relatedEntityIds: [message.id, message.eventId]
          }
        )
      );
    }
  }

  for (const toolCall of result.toolCalls) {
    if (!sessionIds.has(toolCall.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.tool-call-missing-session",
          "A normalized tool call referenced a missing session.",
          "error",
          "tool-call",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: toolCall.id,
            relatedEntityIds: [toolCall.id, toolCall.sessionId]
          }
        )
      );
    }
  }

  for (const shellCommand of result.shellCommands) {
    if (!sessionIds.has(shellCommand.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.shell-command-missing-session",
          "A normalized shell command referenced a missing session.",
          "error",
          "shell-command",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: shellCommand.id,
            relatedEntityIds: [shellCommand.id, shellCommand.sessionId]
          }
        )
      );
    }

    if (shellCommand.toolCallId && !toolCallIds.has(shellCommand.toolCallId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.shell-command-missing-tool-call",
          "A normalized shell command referenced a missing tool call.",
          "error",
          "shell-command",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: shellCommand.id,
            relatedEntityIds: [shellCommand.id, shellCommand.toolCallId]
          }
        )
      );
    }

    if (
      shellCommand.artifactIds &&
      !shellCommand.artifactIds.every((artifactId) => outputArtifactIds.has(artifactId))
    ) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.shell-command-missing-output-artifact",
          "A normalized shell command referenced a missing output artifact.",
          "error",
          "shell-command",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: shellCommand.id,
            relatedEntityIds: [shellCommand.id, ...(shellCommand.artifactIds ?? [])]
          }
        )
      );
    }
  }

  for (const artifact of result.outputArtifacts) {
    if (!sessionIds.has(artifact.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.output-artifact-missing-session",
          "A normalized output artifact referenced a missing session.",
          "error",
          "output-artifact",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: artifact.id,
            relatedEntityIds: [artifact.id, artifact.sessionId]
          }
        )
      );
    }
  }

  for (const mutation of result.fileMutations) {
    if (!sessionIds.has(mutation.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.file-mutation-missing-session",
          "A normalized file mutation referenced a missing session.",
          "error",
          "file-mutation",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: mutation.id,
            relatedEntityIds: [mutation.id, mutation.sessionId]
          }
        )
      );
    }

    if (mutation.toolCallId && !toolCallIds.has(mutation.toolCallId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.file-mutation-missing-tool-call",
          "A normalized file mutation referenced a missing tool call.",
          "error",
          "file-mutation",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: mutation.id,
            relatedEntityIds: [mutation.id, mutation.toolCallId]
          }
        )
      );
    }
  }

  for (const event of result.events) {
    if (event.messageId && !result.messages.some((message) => message.id === event.messageId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.event-missing-message",
          "A normalized event referenced a missing message.",
          "error",
          "event",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: event.id,
            relatedEntityIds: [event.id, event.messageId]
          }
        )
      );
    }

    if (event.toolCallId && !toolCallIds.has(event.toolCallId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.event-missing-tool-call",
          "A normalized event referenced a missing tool call.",
          "error",
          "event",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: event.id,
            relatedEntityIds: [event.id, event.toolCallId]
          }
        )
      );
    }

    if (event.outputArtifactId && !outputArtifactIds.has(event.outputArtifactId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.event-missing-output-artifact",
          "A normalized event referenced a missing output artifact.",
          "error",
          "event",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: event.id,
            relatedEntityIds: [event.id, event.outputArtifactId]
          }
        )
      );
    }

    if (event.fileMutationId && !fileMutationIds.has(event.fileMutationId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.event-missing-file-mutation",
          "A normalized event referenced a missing file mutation.",
          "error",
          "event",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: event.id,
            relatedEntityIds: [event.id, event.fileMutationId]
          }
        )
      );
    }
  }

  return diagnostics;
}
