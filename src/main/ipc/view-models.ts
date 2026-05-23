import { z } from "zod";

const operationChannelSchema = z.enum([
  "app:getShellState",
  "sessions:list",
  "sessions:getById",
  "dataSources:list",
  "dataSources:add",
  "dataSources:update",
  "dataSources:setEnabled",
  "dataSources:validate",
  "dataSources:scan"
]);

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
    allowedOperations: z.array(operationChannelSchema).min(1),
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

export const dataSourceValidationStatusSchema = z.enum([
  "Not Validated",
  "Validating",
  "Valid",
  "Validation Failed",
  "Unsupported",
  "Unknown"
]);
export type DataSourceValidationStatus = z.infer<typeof dataSourceValidationStatusSchema>;

export const dataSourceOperationalStatusSchema = z.enum([
  "Never Scanned",
  "Scanning",
  "Scan Failed",
  "Scanned with Diagnostics",
  "Cached",
  "Stale",
  "Unsupported",
  "Unknown"
]);
export type DataSourceOperationalStatus = z.infer<typeof dataSourceOperationalStatusSchema>;

export const watchSupportStatusSchema = z.enum([
  "Watch Supported",
  "Watch Unsupported",
  "Watch Unknown"
]);
export type WatchSupportStatus = z.infer<typeof watchSupportStatusSchema>;

export const dataSourceDiagnosticViewModelSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1),
    sourceArea: z.enum(["adapter", "cache", "normalization", "source"])
  })
  .strict();
export type DataSourceDiagnosticViewModel = z.infer<typeof dataSourceDiagnosticViewModelSchema>;

export const dataSourceCapabilityViewModelSchema = capabilityBadgeViewModelSchema;
export type DataSourceCapabilityViewModel = z.infer<typeof dataSourceCapabilityViewModelSchema>;

export const adapterRootHintViewModelSchema = z
  .object({
    path: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(["directory", "file"])
  })
  .strict();
export type AdapterRootHintViewModel = z.infer<typeof adapterRootHintViewModelSchema>;

export const dataSourceAdapterViewModelSchema = z
  .object({
    adapterId: z.string().min(1),
    displayName: z.string().min(1),
    capabilityBadges: z.array(dataSourceCapabilityViewModelSchema),
    defaultRoots: z.array(adapterRootHintViewModelSchema)
  })
  .strict();
export type DataSourceAdapterViewModel = z.infer<typeof dataSourceAdapterViewModelSchema>;

export const dataSourceViewModelSchema = z
  .object({
    sourceId: z.string().min(1),
    adapterId: z.string().min(1),
    adapterDisplayName: z.string().min(1),
    sourceName: z.string().min(1).optional(),
    rootPath: z.string().min(1),
    enabled: z.boolean(),
    enabledLabel: z.enum(["Enabled", "Disabled"]),
    validationStatus: dataSourceValidationStatusSchema,
    validationUpdatedAt: z.string().min(1).optional(),
    validationPath: z.string().min(1).optional(),
    scanStatus: dataSourceOperationalStatusSchema,
    scanUpdatedAt: z.string().min(1).optional(),
    scanReason: z.string().min(1).optional(),
    artifactCount: z.number().int().nonnegative().optional(),
    sessionCount: z.number().int().nonnegative().optional(),
    cacheStatus: dataSourceOperationalStatusSchema,
    cacheUpdatedAt: z.string().min(1).optional(),
    cacheReason: z.string().min(1).optional(),
    cacheKey: z.string().min(1).optional(),
    watchSupport: watchSupportStatusSchema,
    watchStrategy: z.string().min(1).optional(),
    watchReason: z.string().min(1).optional(),
    diagnosticCount: z.number().int().nonnegative(),
    capabilityBadges: z.array(dataSourceCapabilityViewModelSchema),
    diagnostics: z.array(dataSourceDiagnosticViewModelSchema)
  })
  .strict();
export type DataSourceViewModel = z.infer<typeof dataSourceViewModelSchema>;

export const dataSourcesViewModelSchema = z
  .object({
    adapters: z.array(dataSourceAdapterViewModelSchema),
    sources: z.array(dataSourceViewModelSchema)
  })
  .strict();
export type DataSourcesViewModel = z.infer<typeof dataSourcesViewModelSchema>;

export const listDataSourcesRequestSchema = z.undefined();
export type ListDataSourcesRequest = z.infer<typeof listDataSourcesRequestSchema>;

export const addDataSourceRequestSchema = z
  .object({
    adapterId: z.string().min(1),
    rootPath: z.string().min(1),
    displayName: z.string().min(1).optional(),
    enabled: z.boolean().optional()
  })
  .strict();
export type AddDataSourceRequest = z.infer<typeof addDataSourceRequestSchema>;

export const updateDataSourceRequestSchema = z
  .object({
    sourceId: z.string().min(1),
    adapterId: z.string().min(1).optional(),
    rootPath: z.string().min(1).optional(),
    displayName: z.string().min(1).optional()
  })
  .strict();
export type UpdateDataSourceRequest = z.infer<typeof updateDataSourceRequestSchema>;

export const setDataSourceEnabledRequestSchema = z
  .object({
    sourceId: z.string().min(1),
    enabled: z.boolean()
  })
  .strict();
export type SetDataSourceEnabledRequest = z.infer<typeof setDataSourceEnabledRequestSchema>;

export const validateDataSourceRequestSchema = z
  .object({
    sourceId: z.string().min(1)
  })
  .strict();
export type ValidateDataSourceRequest = z.infer<typeof validateDataSourceRequestSchema>;

export const scanDataSourceRequestSchema = z
  .object({
    sourceId: z.string().min(1)
  })
  .strict();
export type ScanDataSourceRequest = z.infer<typeof scanDataSourceRequestSchema>;

export const dataSourcesResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      dataSources: dataSourcesViewModelSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type DataSourcesResponse = z.infer<typeof dataSourcesResponseSchema>;
