import { z } from "zod";

import { buildDiagnostic } from "../diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../model/confidence.js";
import type { AdapterNormalizationResult } from "../adapter-contract/types.js";

export const NORMALIZATION_SCHEMA_VERSION = "2";

const normalizedConfidenceSchema = z.enum(["confirmed", "observed", "inferred", "unknown"]);
const legacyDiagnosticConfidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"])
  })
  .passthrough();

const diagnosticSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(["info", "warning", "error"]),
    scope: z.enum([
      "adapter",
      "source",
      "artifact",
      "project",
      "session",
      "event",
      "message",
      "tool-call",
      "shell-command",
      "output-artifact",
      "file-mutation"
    ]),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    relatedEntityIds: z.array(z.string().min(1)).optional(),
    confidence: z.union([normalizedConfidenceSchema, legacyDiagnosticConfidenceSchema]).optional()
  })
  .passthrough();

const rawEventPointerSchema = z
  .object({
    artifactId: z.string().min(1).optional(),
    eventId: z.string().min(1).optional(),
    pointer: z.string().min(1).optional(),
    nativeId: z.string().min(1).optional(),
    path: z.string().min(1).optional()
  })
  .passthrough()
  .refine(
    (pointer) =>
      Boolean(
        pointer.artifactId || pointer.eventId || pointer.pointer || pointer.nativeId || pointer.path
      ),
    "Raw event pointers must carry at least one stable locator."
  );

const groupedHarnessCapabilitiesSchema = z
  .object({
    discovery: z
      .object({
        defaultRoots: z.boolean(),
        projectRootMapping: z.enum(["native", "inferred", "none"]),
        stableProjectId: z.boolean(),
        stableSessionId: z.boolean()
      })
      .strict(),
    replay: z
      .object({
        transcriptReplay: z.boolean(),
        messageRoles: z.boolean(),
        assistantMessages: z.boolean(),
        lifecycleEvents: z.boolean(),
        cancellationEvents: z.boolean(),
        topicEvents: z.boolean(),
        rawEventPointers: z.boolean()
      })
      .strict(),
    tools: z
      .object({
        toolCalls: z.boolean(),
        toolResults: z.boolean(),
        fileReads: z.boolean(),
        fileSearches: z.boolean(),
        fileMutations: z.boolean(),
        diffStats: z.boolean(),
        shellCommands: z.boolean(),
        shellOutputs: z.boolean(),
        sidecarOutputs: z.boolean()
      })
      .strict(),
    usage: z
      .object({
        modelNames: z.boolean(),
        tokenCounts: z.boolean(),
        costEstimates: z.boolean()
      })
      .strict(),
    live: z
      .object({
        activeSessionDetection: z.enum(["mtime", "process", "hook", "native", "none"]),
        watchableArtifacts: z.boolean(),
        incrementalParsing: z.boolean()
      })
      .strict(),
    audit: z
      .object({
        agentClaimDetection: z.boolean(),
        finalAnswerDetection: z.boolean(),
        shellExitCodeEvidence: z.boolean(),
        verificationCommandEvidence: z.boolean()
      })
      .strict(),
    export: z
      .object({
        rawArtifactExport: z.boolean(),
        normalizedExport: z.boolean()
      })
      .strict()
  })
  .strict();

export const rawArtifactRefSchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
	    path: z.string().min(1).optional(),
	    nativeRef: z.string().min(1).optional(),
	    nativeId: z.string().min(1).optional(),
	    artifactKind: z.enum([
      "session-log",
      "message-index",
      "project-root-map",
      "output-artifact",
      "history",
      "metadata",
      "unknown"
    ]),
    sizeBytes: z.number().int().nonnegative().optional(),
    mtime: z.string().min(1).optional(),
	    inode: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
	    parseStrategy: z
	      .enum(["stream-jsonl", "json", "text", "adapter-native", "unknown"])
	      .optional(),
	    artifactType: z.string().min(1).optional(),
	    mediaType: z.string().min(1).optional(),
	    byteLength: z.number().int().nonnegative().optional(),
	    mtimeMs: z.number().nonnegative().optional()
	  })
  .strict()
  .refine((artifact) => Boolean(artifact.path || artifact.nativeRef), {
    message: "Raw artifact refs must carry either a path or nativeRef."
  });

const projectHarnessRefSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    nativeProjectId: z.string().min(1).optional(),
    nativeProjectPath: z.string().min(1).optional(),
    projectRootPath: z.string().min(1).optional(),
    projectRootConfidence: normalizedConfidenceSchema,
    rawArtifactRefs: z.array(rawArtifactRefSchema)
  })
  .strict();

const verificationResultSchema = z
  .object({
    state: z.enum(["not-run", "passed", "failed", "mixed", "unknown"]),
    commandsRun: z.number().int().nonnegative(),
    verificationCommandsRun: z.number().int().nonnegative(),
    buildRan: z.boolean(),
    testsRan: z.boolean(),
    typecheckRan: z.boolean(),
    lintRan: z.boolean(),
    failedCommandIds: z.array(z.string().min(1)),
    passedCommandIds: z.array(z.string().min(1)),
    failedTestsCount: z.number().int().nonnegative().optional(),
    summary: z.string().min(1),
    confidence: normalizedConfidenceSchema,
    diagnostics: z.array(diagnosticSchema)
  })
  .strict();

const runAuditSchema = z
  .object({
    sessionId: z.string().min(1),
    adapterId: z.string().min(1),
    classification: z.enum([
      "clean",
      "incomplete",
      "cancelled",
      "verification-failed",
      "needs-review",
      "unknown"
    ]),
    agentClaimedCompleted: z.union([z.boolean(), z.literal("unknown")]),
    finalAnswerPresent: z.boolean(),
    requestCancelled: z.boolean(),
    verificationCommandsRun: z.boolean(),
    shellExitCodes: z.array(z.number().int()),
    failedTestsDetected: z.boolean(),
    attentionReasons: z.array(
      z.enum([
        "failed-verification",
        "cancelled",
        "no-final-answer",
        "pending-tool-call",
        "dirty-after-claim",
        "sidecar-missing",
        "parser-warning",
        "no-verification",
        "capability-missing",
        "unknown"
      ])
    ),
    summary: z.string().min(1),
    confidence: normalizedConfidenceSchema,
    diagnostics: z.array(diagnosticSchema)
  })
  .strict();

const capabilityEnvelopeSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    capabilities: groupedHarnessCapabilitiesSchema
  })
  .strict();

const outputArtifactSchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    nativeRef: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    kind: z.enum(["sidecar", "inline-large-output", "raw-log", "screenshot", "unknown"]),
    contentKind: z.enum([
      "plain-text",
      "json-output-wrapper",
      "json",
      "binary",
      "unknown"
    ]),
    sizeBytes: z.number().int().nonnegative().optional(),
    mtime: z.string().min(1).optional(),
    preview: z.string().min(1).optional(),
    loaded: z.boolean(),
    source: rawEventPointerSchema,
    diagnostics: z.array(diagnosticSchema)
  })
  .passthrough();

const fileMutationSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    adapterId: z.string().min(1),
    path: z.string().min(1),
    mutationKind: z.enum(["created", "updated", "deleted", "unknown"]),
    toolCallId: z.string().min(1).optional(),
    source: rawEventPointerSchema,
    confidence: normalizedConfidenceSchema,
    diagnostics: z.array(diagnosticSchema)
  })
  .passthrough();

export const normalizedResultSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    capabilities: z
      .object({
        adapter: capabilityEnvelopeSchema,
        source: capabilityEnvelopeSchema.extend({
          sourceId: z.string().min(1)
        }),
        sessions: z.array(
          capabilityEnvelopeSchema.extend({
            sourceId: z.string().min(1),
            sessionId: z.string().min(1)
          })
        )
      })
      .strict(),
    projects: z.array(
      z
        .object({
          id: z.string().min(1),
          displayName: z.string().min(1),
          primaryRootPath: z.string().min(1).optional(),
          rootConfidence: normalizedConfidenceSchema,
          harnessRefs: z.array(projectHarnessRefSchema),
          sessionIds: z.array(z.string().min(1)),
          latestActivityAt: z.string().min(1).optional(),
          latestPrompt: z.string().min(1).optional(),
          latestVerificationState: z
            .enum(["not-run", "passed", "failed", "mixed", "unknown"])
            .optional(),
          diagnostics: z.array(diagnosticSchema)
        })
	        .passthrough()
    ),
    sessions: z.array(
      z
        .object({
          id: z.string().min(1),
          adapterId: z.string().min(1),
          sourceId: z.string().min(1),
          nativeSessionId: z.string().min(1).optional(),
          projectId: z.string().min(1).optional(),
          title: z.string().min(1).optional(),
          firstUserPrompt: z.string().min(1).optional(),
          latestUserPrompt: z.string().min(1).optional(),
          startedAt: z.string().min(1).optional(),
          lastUpdatedAt: z.string().min(1).optional(),
          durationMs: z.number().int().nonnegative().optional(),
          lifecycleStatus: z.enum(["active", "completed", "cancelled", "unknown"]),
	          attentionReasons: z.array(
            z.enum([
              "failed-verification",
              "cancelled",
              "no-final-answer",
              "pending-tool-call",
              "dirty-after-claim",
              "sidecar-missing",
              "parser-warning",
              "no-verification",
              "capability-missing",
              "unknown"
            ])
	          ).optional(),
          capabilities: groupedHarnessCapabilitiesSchema,
          parseConfidence: normalizedConfidenceSchema,
          messageIds: z.array(z.string().min(1)),
          eventIds: z.array(z.string().min(1)),
          toolCallIds: z.array(z.string().min(1)),
          fileMutationIds: z.array(z.string().min(1)),
          shellCommandIds: z.array(z.string().min(1)),
          outputArtifactIds: z.array(z.string().min(1)),
          usage: z.record(z.string(), z.unknown()),
	          verification: verificationResultSchema.optional(),
	          runAudit: runAuditSchema.optional(),
          rawArtifactRefs: z.array(rawArtifactRefSchema),
          diagnostics: z.array(diagnosticSchema)
        })
	        .passthrough()
    ),
    events: z.array(
      z
        .object({
          id: z.string().min(1),
          sessionId: z.string().min(1),
          adapterId: z.string().min(1),
          kind: z.enum([
            "message",
            "tool-call",
            "tool-result",
            "file-event",
            "shell-command",
            "lifecycle",
            "metadata",
            "topic",
            "raw-unknown"
          ]),
          timestamp: z.string().min(1).optional(),
          orderKey: z.string().min(1),
          actor: z.enum(["user", "assistant", "system", "tool", "harness", "unknown"]).optional(),
          title: z.string().min(1).optional(),
          text: z.string().min(1).optional(),
          severity: z.enum(["info", "warning", "error"]).optional(),
          raw: rawEventPointerSchema.optional(),
          diagnostics: z.array(diagnosticSchema)
        })
	        .passthrough()
    ),
    messages: z.array(
      z
        .object({
          id: z.string().min(1),
          sessionId: z.string().min(1),
          adapterId: z.string().min(1),
          role: z.enum(["user", "assistant", "system", "tool", "unknown"]),
          timestamp: z.string().min(1).optional(),
          text: z.string().min(1).optional(),
          modelName: z.string().min(1).optional(),
          usage: z.record(z.string(), z.unknown()).optional(),
          toolCallIds: z.array(z.string().min(1)),
          eventIds: z.array(z.string().min(1)),
          source: rawEventPointerSchema,
          confidence: normalizedConfidenceSchema
        })
	        .passthrough()
    ),
    toolCalls: z.array(
      z
        .object({
          id: z.string().min(1),
          sessionId: z.string().min(1),
          adapterId: z.string().min(1),
          nativeToolCallId: z.string().min(1).optional(),
          name: z.string().min(1),
          normalizedKind: z.enum([
            "read",
            "search",
            "write",
            "replace",
            "shell",
            "topic",
            "network",
            "mcp",
            "unknown"
          ]),
          statusRaw: z.string().min(1).optional(),
          statusNormalized: z.enum(["pending", "completed", "failed", "unknown"]).optional(),
          argsPreview: z.string().min(1).optional(),
          resultPreview: z.string().min(1).optional(),
          outputArtifactIds: z.array(z.string().min(1)),
          fileMutationId: z.string().min(1).optional(),
          shellCommandId: z.string().min(1).optional(),
          source: rawEventPointerSchema,
          confidence: normalizedConfidenceSchema,
          diagnostics: z.array(diagnosticSchema)
        })
	        .passthrough()
    ),
    shellCommands: z.array(
      z
        .object({
          id: z.string().min(1),
          sessionId: z.string().min(1),
          adapterId: z.string().min(1),
          toolCallId: z.string().min(1).optional(),
          command: z.string().min(1).optional(),
          cwd: z.string().min(1).optional(),
          outputInline: z.string().min(1).optional(),
          outputArtifactIds: z.array(z.string().min(1)),
          rawStatus: z.string().min(1).optional(),
          rawExitCode: z.number().int().optional(),
          source: rawEventPointerSchema,
          confidence: normalizedConfidenceSchema
        })
	        .passthrough()
    ),
    outputArtifacts: z.array(outputArtifactSchema),
    fileMutations: z.array(fileMutationSchema),
    diagnostics: z.array(diagnosticSchema)
  })
  .strict();

type SpecNormalizedResult = z.infer<typeof normalizedResultSchema>;

export interface NormalizationValidationResult {
  ok: boolean;
  diagnostics: ReturnType<typeof buildDiagnostic>[];
}

export function validateNormalizedResult(
  result: AdapterNormalizationResult
): NormalizationValidationResult {
  const parsed = normalizedResultSchema.safeParse(result);

  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map((issue, index) =>
        buildDiagnostic(
          result.adapterId ?? "unknown-adapter",
          "normalization.invalid-shape",
          `Normalized result does not match the Wave 2 schema at ${issue.path.join(".") || "$"}: ${issue.message}`,
          "error",
          "adapter",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: `normalization-shape-${index + 1}`
          }
        )
      )
    };
  }

  const diagnostics = [
    ...validateCapabilityOwnership(parsed.data),
    ...validateRelationshipIntegrity(parsed.data),
    ...validateNoLegacyAliases(parsed.data)
  ];

  return {
    ok: diagnostics.length === 0,
    diagnostics
  };
}

function validateCapabilityOwnership(result: SpecNormalizedResult) {
  const diagnostics: ReturnType<typeof buildDiagnostic>[] = [];

  if (result.capabilities.adapter.adapterId !== result.adapterId) {
    diagnostics.push(
      buildDiagnostic(
        result.adapterId,
        "normalization.capabilities.adapter-mismatch",
        "Adapter capability snapshots must retain the normalized adapter identity.",
        "error",
        "adapter",
        HIGH_CONFIDENCE,
        {
          sourceId: result.sourceId,
          nativeId: result.capabilities.adapter.adapterId
        }
      )
    );
  }

  if (
    result.capabilities.source.adapterId !== result.adapterId ||
    result.capabilities.source.sourceId !== result.sourceId
  ) {
    diagnostics.push(
      buildDiagnostic(
        result.adapterId,
        "normalization.capabilities.source-mismatch",
        "Source capability snapshots must retain the normalized adapter and source identity.",
        "error",
        "source",
        HIGH_CONFIDENCE,
        {
          sourceId: result.sourceId,
          nativeId: result.capabilities.source.sourceId
        }
      )
    );
  }

  for (const sessionSnapshot of result.capabilities.sessions) {
    if (
      sessionSnapshot.adapterId !== result.adapterId ||
      sessionSnapshot.sourceId !== result.sourceId
    ) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.capabilities.session-mismatch",
          "Session capability snapshots must retain the normalized adapter and source identity.",
          "error",
          "session",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: sessionSnapshot.sessionId,
            relatedEntityIds: [sessionSnapshot.sessionId]
          }
        )
      );
    }
  }

  for (const session of result.sessions) {
    if (session.adapterId !== result.adapterId || session.sourceId !== result.sourceId) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.invalid-source-ownership",
          "Normalized sessions must retain the parent adapter and source identity.",
          "error",
          "session",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: session.id,
            relatedEntityIds: [session.id]
          }
        )
      );
    }
  }

  for (const artifact of collectRawArtifactRefs(result)) {
    if (artifact.adapterId !== result.adapterId || artifact.sourceId !== result.sourceId) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.raw-artifact-source-mismatch",
          "Raw artifact references must retain the parent adapter and source identity.",
          "error",
          "artifact",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: artifact.id,
            relatedEntityIds: [artifact.id]
          }
        )
      );
    }
  }

  for (const artifact of result.outputArtifacts) {
    if (artifact.adapterId !== result.adapterId || artifact.sourceId !== result.sourceId) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.output-artifact-source-mismatch",
          "Output artifact refs must retain the parent adapter and source identity.",
          "error",
          "output-artifact",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: artifact.id,
            relatedEntityIds: [artifact.id]
          }
        )
      );
    }
  }

  return diagnostics;
}

function validateRelationshipIntegrity(result: SpecNormalizedResult) {
  const diagnostics: ReturnType<typeof buildDiagnostic>[] = [];
  const projectIds = new Set(result.projects.map((project) => project.id));
  const sessionIds = new Set(result.sessions.map((session) => session.id));
  const eventIds = new Set(result.events.map((event) => event.id));
  const messageIds = new Set(result.messages.map((message) => message.id));
  const toolCallIds = new Set(result.toolCalls.map((toolCall) => toolCall.id));
  const shellCommandIds = new Set(result.shellCommands.map((shellCommand) => shellCommand.id));
  const outputArtifactIds = new Set(result.outputArtifacts.map((artifact) => artifact.id));
  const fileMutationIds = new Set(result.fileMutations.map((mutation) => mutation.id));

  for (const project of result.projects) {
    for (const sessionId of project.sessionIds) {
      if (!sessionIds.has(sessionId)) {
        diagnostics.push(
          buildDiagnostic(
            result.adapterId,
            "normalization.project-missing-session",
            "A normalized project referenced a session that was not present in the same result.",
            "error",
            "project",
            HIGH_CONFIDENCE,
            {
              sourceId: result.sourceId,
              nativeId: project.id,
              relatedEntityIds: [project.id, sessionId]
            }
          )
        );
      }
    }
  }

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

    validateReferenceList(
      diagnostics,
      result,
      session.id,
      "session",
      session.messageIds,
      messageIds,
      "normalization.session-missing-message",
      "A normalized session referenced a missing message."
    );
    validateReferenceList(
      diagnostics,
      result,
      session.id,
      "session",
      session.eventIds,
      eventIds,
      "normalization.session-missing-event",
      "A normalized session referenced a missing event."
    );
    validateReferenceList(
      diagnostics,
      result,
      session.id,
      "session",
      session.toolCallIds,
      toolCallIds,
      "normalization.session-missing-tool-call",
      "A normalized session referenced a missing tool call."
    );
    validateReferenceList(
      diagnostics,
      result,
      session.id,
      "session",
      session.fileMutationIds,
      fileMutationIds,
      "normalization.session-missing-file-mutation",
      "A normalized session referenced a missing file mutation."
    );
    validateReferenceList(
      diagnostics,
      result,
      session.id,
      "session",
      session.shellCommandIds,
      shellCommandIds,
      "normalization.session-missing-shell-command",
      "A normalized session referenced a missing shell command."
    );
    validateReferenceList(
      diagnostics,
      result,
      session.id,
      "session",
      session.outputArtifactIds,
      outputArtifactIds,
      "normalization.session-missing-output-artifact",
      "A normalized session referenced a missing output artifact."
    );
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

    validateReferenceList(
      diagnostics,
      result,
      message.id,
      "message",
      message.eventIds,
      eventIds,
      "normalization.message-missing-event",
      "A normalized message referenced a missing event."
    );
    validateReferenceList(
      diagnostics,
      result,
      message.id,
      "message",
      message.toolCallIds,
      toolCallIds,
      "normalization.message-missing-tool-call",
      "A normalized message referenced a missing tool call."
    );
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

    validateReferenceList(
      diagnostics,
      result,
      toolCall.id,
      "tool-call",
      toolCall.outputArtifactIds,
      outputArtifactIds,
      "normalization.tool-call-missing-output-artifact",
      "A normalized tool call referenced a missing output artifact."
    );

    if (toolCall.fileMutationId && !fileMutationIds.has(toolCall.fileMutationId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.tool-call-missing-file-mutation",
          "A normalized tool call referenced a missing file mutation.",
          "error",
          "tool-call",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: toolCall.id,
            relatedEntityIds: [toolCall.id, toolCall.fileMutationId]
          }
        )
      );
    }

    if (toolCall.shellCommandId && !shellCommandIds.has(toolCall.shellCommandId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.tool-call-missing-shell-command",
          "A normalized tool call referenced a missing shell command.",
          "error",
          "tool-call",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: toolCall.id,
            relatedEntityIds: [toolCall.id, toolCall.shellCommandId]
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

    validateReferenceList(
      diagnostics,
      result,
      shellCommand.id,
      "shell-command",
      shellCommand.outputArtifactIds,
      outputArtifactIds,
      "normalization.shell-command-missing-output-artifact",
      "A normalized shell command referenced a missing output artifact."
    );
  }

  for (const artifact of result.outputArtifacts) {
    if (artifact.sessionId && !sessionIds.has(artifact.sessionId)) {
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

  for (const sessionSnapshot of result.capabilities.sessions) {
    if (!sessionIds.has(sessionSnapshot.sessionId)) {
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.capabilities-missing-session",
          "A session capability snapshot referenced a missing session.",
          "error",
          "session",
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: sessionSnapshot.sessionId,
            relatedEntityIds: [sessionSnapshot.sessionId]
          }
        )
      );
    }
  }

  return diagnostics;
}

const LEGACY_ALIAS_KEYS = {
  sessions: ["lifecycleState", "endedAt"],
  events: [
    "eventKind",
    "ordinal",
    "messageId",
    "toolCallId",
    "shellCommandId",
    "outputArtifactId",
    "fileMutationId"
  ],
  messages: ["content", "ordinal", "eventId"],
  toolCalls: [
    "toolName",
    "status",
    "inputSummary",
    "outputSummary",
    "artifactIds",
    "fileMutationIds",
    "shellCommandIds",
    "eventIds",
    "eventId"
  ],
  shellCommands: [
    "outputSummary",
    "outputSource",
    "artifactIds",
    "rawToolStatus",
    "exitCode",
    "startedAt",
    "endedAt",
    "eventId"
  ],
  outputArtifacts: ["artifactKind", "eventId"],
  fileMutations: ["eventIds", "eventId", "toolCallIds"]
} as const satisfies Partial<Record<keyof SpecNormalizedResult, readonly string[]>>;

function validateNoLegacyAliases(result: SpecNormalizedResult) {
  const diagnostics: ReturnType<typeof buildDiagnostic>[] = [];

  for (const [collectionKey, aliasKeys] of Object.entries(LEGACY_ALIAS_KEYS)) {
    const items = result[collectionKey as keyof SpecNormalizedResult];

    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const presentAliases = aliasKeys.filter((aliasKey) => aliasKey in item);

      if (presentAliases.length === 0) {
        continue;
      }

      const scope = toLegacyAliasScope(collectionKey);
      const entityId = typeof item.id === "string" ? item.id : collectionKey;
      diagnostics.push(
        buildDiagnostic(
          result.adapterId,
          "normalization.legacy-alias-field",
          `Normalized ${scope} entities must not include legacy alias fields: ${presentAliases.join(", ")}.`,
          "error",
          scope,
          HIGH_CONFIDENCE,
          {
            sourceId: result.sourceId,
            nativeId: entityId,
            ...(typeof item.id === "string" ? { relatedEntityIds: [item.id] } : {})
          }
        )
      );
    }
  }

  return diagnostics;
}

function toLegacyAliasScope(
  key: string
): "session" | "event" | "message" | "tool-call" | "shell-command" | "output-artifact" | "file-mutation" {
  switch (key) {
    case "sessions":
      return "session";
    case "events":
      return "event";
    case "messages":
      return "message";
    case "toolCalls":
      return "tool-call";
    case "shellCommands":
      return "shell-command";
    case "outputArtifacts":
      return "output-artifact";
    case "fileMutations":
      return "file-mutation";
    default:
      throw new Error(`Unsupported alias validation scope '${key}'.`);
  }
}

function validateReferenceList(
  diagnostics: ReturnType<typeof buildDiagnostic>[],
  result: SpecNormalizedResult,
  ownerId: string,
  scope: "message" | "project" | "session" | "shell-command" | "tool-call",
  values: string[],
  knownIds: Set<string>,
  code: string,
  message: string
) {
  for (const value of values) {
    if (knownIds.has(value)) {
      continue;
    }

    diagnostics.push(
      buildDiagnostic(result.adapterId, code, message, "error", scope, HIGH_CONFIDENCE, {
        sourceId: result.sourceId,
        nativeId: ownerId,
        relatedEntityIds: [ownerId, value]
      })
    );
  }
}

function collectRawArtifactRefs(result: SpecNormalizedResult) {
  return [
    ...result.projects.flatMap((project) => project.harnessRefs.flatMap((ref) => ref.rawArtifactRefs)),
    ...result.sessions.flatMap((session) => session.rawArtifactRefs)
  ];
}
