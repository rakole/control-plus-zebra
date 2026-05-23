import { z } from "zod";

export const capabilityBadgeLabelSchema = z.enum(["Supported", "Unsupported", "Unknown"]);
export type CapabilityBadgeLabel = z.infer<typeof capabilityBadgeLabelSchema>;

export const capabilityBadgeViewModelSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    state: capabilityBadgeLabelSchema,
    reason: z.string().min(1).optional()
  })
  .strict();
export type CapabilityBadgeViewModel = z.infer<typeof capabilityBadgeViewModelSchema>;

export const evidenceSummaryViewModelSchema = z
  .object({
    messages: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    shellCommands: z.number().int().nonnegative(),
    outputArtifacts: z.number().int().nonnegative(),
    fileMutations: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative()
  })
  .strict();
export type EvidenceSummaryViewModel = z.infer<typeof evidenceSummaryViewModelSchema>;

export const sanitizedErrorViewModelSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();
export type SanitizedErrorViewModel = z.infer<typeof sanitizedErrorViewModelSchema>;

const sessionBaseViewModelSchema = z
  .object({
    adapterId: z.string().min(1),
    adapterDisplayName: z.string().min(1),
    sourceId: z.string().min(1),
    sessionId: z.string().min(1),
    nativeSessionId: z.string().min(1).optional(),
    title: z.string().min(1),
    lifecycleStatus: z.enum(["active", "completed", "cancelled", "unknown"]),
    startedAt: z.string().min(1).optional(),
    endedAt: z.string().min(1).optional(),
    capabilityBadges: z.array(capabilityBadgeViewModelSchema),
    diagnosticWarningCount: z.number().int().nonnegative(),
    evidenceSummary: evidenceSummaryViewModelSchema
  })
  .strict();

export const sessionSummaryViewModelSchema = sessionBaseViewModelSchema;
export type SessionSummaryViewModel = z.infer<typeof sessionSummaryViewModelSchema>;

export const sessionPreviewViewModelSchema = sessionBaseViewModelSchema
  .extend({
    projectName: z.string().min(1).optional(),
    diagnostics: z.array(
      z
        .object({
          code: z.string().min(1),
          severity: z.enum(["info", "warning", "error"]),
          message: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();
export type SessionPreviewViewModel = z.infer<typeof sessionPreviewViewModelSchema>;

export const shellStateViewModelSchema = z
  .object({
    appName: z.literal("Agent Workbench"),
    readOnly: z.literal(true),
    allowedOperations: z.tuple([
      z.literal("app:getShellState"),
      z.literal("sessions:list"),
      z.literal("sessions:getById")
    ]),
    adapters: z.array(
      z
        .object({
          adapterId: z.string().min(1),
          displayName: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();
export type ShellStateViewModel = z.infer<typeof shellStateViewModelSchema>;

export const listSessionsRequestSchema = z
  .object({
    adapterId: z.string().min(1).optional()
  })
  .strict();
export type ListSessionsRequest = z.infer<typeof listSessionsRequestSchema>;

export const listSessionsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      sessions: z.array(sessionSummaryViewModelSchema)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

export const getSessionByIdRequestSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict();
export type GetSessionByIdRequest = z.infer<typeof getSessionByIdRequestSchema>;

export const getSessionByIdResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      session: sessionPreviewViewModelSchema.nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GetSessionByIdResponse = z.infer<typeof getSessionByIdResponseSchema>;
