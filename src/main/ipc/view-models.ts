import { z } from "zod";

const operationChannelSchema = z.enum([
  "app:getShellState",
  "overview:get",
  "projects:list",
  "sessions:list",
  "sessions:getById",
  "sessions:getDetail",
  "sessions:getRunAudit",
  "diagnostics:list",
  "dataSources:list",
  "dataSources:add",
  "dataSources:update",
  "dataSources:setEnabled",
  "dataSources:validate",
  "dataSources:scan"
]);

export const capabilityBadgeLabelSchema = z.enum(["Supported", "Unsupported", "Unknown"]);
export type CapabilityBadgeLabel = z.infer<typeof capabilityBadgeLabelSchema>;

export const truthStateLabelSchema = z.enum([
  "Available",
  "Active",
  "Cancelled",
  "Clean",
  "Completed",
  "Dirty",
  "Failed",
  "Failed Verification",
  "Incomplete",
  "Needs Review",
  "Not Run",
  "Passed",
  "Supported",
  "Unknown",
  "Unsupported"
]);
export type TruthStateLabel = z.infer<typeof truthStateLabelSchema>;

export const truthStateToneSchema = z.enum([
  "neutral",
  "positive",
  "warning",
  "danger",
  "info"
]);
export type TruthStateTone = z.infer<typeof truthStateToneSchema>;

export const truthStateViewModelSchema = z
  .object({
    label: truthStateLabelSchema,
    tone: truthStateToneSchema,
    reason: z.string().min(1).optional()
  })
  .strict();
export type TruthStateViewModel = z.infer<typeof truthStateViewModelSchema>;

export const metricStateViewModelSchema = z
  .object({
    status: z.enum(["value", "unknown", "unsupported", "not-run"]),
    displayValue: z.string().min(1),
    numericValue: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).optional()
  })
  .strict();
export type MetricStateViewModel = z.infer<typeof metricStateViewModelSchema>;

export const fieldValueViewModelSchema = z
  .object({
    status: z.enum(["value", "unknown", "unsupported"]),
    displayValue: z.string().min(1),
    rawValue: z.string().min(1).optional(),
    reason: z.string().min(1).optional()
  })
  .strict();
export type FieldValueViewModel = z.infer<typeof fieldValueViewModelSchema>;

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

export const harnessFilterOptionViewModelSchema = z
  .object({
    adapterId: z.string().min(1),
    label: z.string().min(1),
    sessionCount: z.number().int().nonnegative()
  })
  .strict();
export type HarnessFilterOptionViewModel = z.infer<
  typeof harnessFilterOptionViewModelSchema
>;

export const overviewActivityPointViewModelSchema = z
  .object({
    day: z.string().min(1),
    sessionCount: z.number().int().nonnegative(),
    needsAttentionCount: z.number().int().nonnegative()
  })
  .strict();
export type OverviewActivityPointViewModel = z.infer<
  typeof overviewActivityPointViewModelSchema
>;

export const overviewMetricsViewModelSchema = z
  .object({
    totalProjects: metricStateViewModelSchema,
    totalSessions: metricStateViewModelSchema,
    activeOrRecentSessions: metricStateViewModelSchema,
    failedVerification: metricStateViewModelSchema,
    cancelledSessions: metricStateViewModelSchema,
    needsAttentionSessions: metricStateViewModelSchema,
    toolActivity: metricStateViewModelSchema
  })
  .strict();
export type OverviewMetricsViewModel = z.infer<typeof overviewMetricsViewModelSchema>;

export const overviewViewModelSchema = z
  .object({
    metrics: overviewMetricsViewModelSchema,
    harnessFilters: z.array(harnessFilterOptionViewModelSchema),
    activity: z.array(overviewActivityPointViewModelSchema)
  })
  .strict();
export type OverviewViewModel = z.infer<typeof overviewViewModelSchema>;

export const projectSummaryViewModelSchema = z
  .object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    repoPath: fieldValueViewModelSchema,
    validatedRepoRoot: fieldValueViewModelSchema,
    observedHarnesses: z.array(z.string().min(1)),
    latestActivityAt: z.string().min(1).optional(),
    sessionCount: z.number().int().nonnegative(),
    latestVerification: truthStateViewModelSchema,
    latestRunAudit: truthStateViewModelSchema,
    gitStatus: truthStateViewModelSchema,
    branch: fieldValueViewModelSchema,
    head: fieldValueViewModelSchema,
    dirtyState: truthStateViewModelSchema,
    changedFiles: metricStateViewModelSchema,
    untrackedFiles: metricStateViewModelSchema,
    additions: metricStateViewModelSchema,
    deletions: metricStateViewModelSchema,
    remoteUrl: fieldValueViewModelSchema,
    pullRequest: fieldValueViewModelSchema
  })
  .strict();
export type ProjectSummaryViewModel = z.infer<typeof projectSummaryViewModelSchema>;

const sessionTriageMetricsViewModelSchema = z
  .object({
    toolCalls: metricStateViewModelSchema,
    fileMutations: metricStateViewModelSchema,
    commands: metricStateViewModelSchema,
    failedCommands: metricStateViewModelSchema,
    tokenCount: metricStateViewModelSchema
  })
  .strict();
export type SessionTriageMetricsViewModel = z.infer<
  typeof sessionTriageMetricsViewModelSchema
>;

const sessionBaseViewModelSchema = z
  .object({
    adapterId: z.string().min(1),
    adapterDisplayName: z.string().min(1),
    sourceId: z.string().min(1),
    sessionId: z.string().min(1),
    nativeSessionId: z.string().min(1).optional(),
    title: z.string().min(1),
    lifecycleStatus: z.enum(["active", "completed", "cancelled", "unknown"]),
    lifecycleState: truthStateViewModelSchema,
    startedAt: z.string().min(1).optional(),
    endedAt: z.string().min(1).optional(),
    projectName: z.string().min(1).optional(),
    firstPrompt: z.string().min(1).optional(),
    capabilityBadges: z.array(capabilityBadgeViewModelSchema),
    diagnosticWarningCount: z.number().int().nonnegative(),
    verificationState: truthStateViewModelSchema,
    runAuditState: truthStateViewModelSchema,
    attentionReasons: z.array(z.string().min(1)),
    evidenceSummary: evidenceSummaryViewModelSchema,
    triageMetrics: sessionTriageMetricsViewModelSchema
  })
  .strict();

export const sessionSummaryViewModelSchema = sessionBaseViewModelSchema;
export type SessionSummaryViewModel = z.infer<typeof sessionSummaryViewModelSchema>;

export const sessionPreviewViewModelSchema = sessionBaseViewModelSchema
  .extend({
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

export const sessionDetailMetadataEntrySchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1)
  })
  .strict();
export type SessionDetailMetadataEntry = z.infer<
  typeof sessionDetailMetadataEntrySchema
>;

export const timelineEventViewModelSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "message",
      "lifecycle",
      "tool-call",
      "shell-command",
      "output-artifact",
      "file-mutation",
      "unknown"
    ]),
    timestamp: z.string().min(1).optional(),
    title: z.string().min(1),
    summary: z.string().min(1).optional(),
    metadata: z.array(sessionDetailMetadataEntrySchema)
  })
  .strict();
export type TimelineEventViewModel = z.infer<typeof timelineEventViewModelSchema>;

export const sessionDetailViewModelSchema = z
  .object({
    session: sessionPreviewViewModelSchema,
    timeline: z.array(timelineEventViewModelSchema)
  })
  .strict();
export type SessionDetailViewModel = z.infer<typeof sessionDetailViewModelSchema>;

export const runAuditItemViewModelSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
    tone: truthStateToneSchema.optional(),
    hint: z.string().min(1).optional()
  })
  .strict();
export type RunAuditItemViewModel = z.infer<typeof runAuditItemViewModelSchema>;

export const runAuditSectionViewModelSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1).optional(),
    items: z.array(runAuditItemViewModelSchema)
  })
  .strict();
export type RunAuditSectionViewModel = z.infer<typeof runAuditSectionViewModelSchema>;

export const runAuditViewModelSchema = z
  .object({
    session: sessionPreviewViewModelSchema,
    sections: z.array(runAuditSectionViewModelSchema)
  })
  .strict();
export type RunAuditViewModel = z.infer<typeof runAuditViewModelSchema>;

export const diagnosticsSeveritySchema = z.enum(["info", "warning", "error"]);
export type DiagnosticsSeverity = z.infer<typeof diagnosticsSeveritySchema>;

export const diagnosticsSourceAreaSchema = z.enum([
  "adapter",
  "source",
  "normalization",
  "cache",
  "capability"
]);
export type DiagnosticsSourceArea = z.infer<typeof diagnosticsSourceAreaSchema>;

export const diagnosticRowViewModelSchema = z
  .object({
    code: z.string().min(1),
    severity: diagnosticsSeveritySchema,
    sourceArea: diagnosticsSourceAreaSchema,
    adapterId: z.string().min(1),
    adapterDisplayName: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    sessionTitle: z.string().min(1).optional(),
    projectName: z.string().min(1).optional(),
    message: z.string().min(1)
  })
  .strict();
export type DiagnosticRowViewModel = z.infer<typeof diagnosticRowViewModelSchema>;

export const diagnosticGroupViewModelSchema = z
  .object({
    groupId: z.string().min(1),
    title: z.string().min(1),
    sourceArea: diagnosticsSourceAreaSchema,
    severity: diagnosticsSeveritySchema,
    count: z.number().int().nonnegative(),
    diagnostics: z.array(diagnosticRowViewModelSchema)
  })
  .strict();
export type DiagnosticGroupViewModel = z.infer<
  typeof diagnosticGroupViewModelSchema
>;

export const diagnosticsViewModelSchema = z
  .object({
    harnessFilters: z.array(harnessFilterOptionViewModelSchema),
    severityFilters: z.array(diagnosticsSeveritySchema),
    groups: z.array(diagnosticGroupViewModelSchema)
  })
  .strict();
export type DiagnosticsViewModel = z.infer<typeof diagnosticsViewModelSchema>;

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

export const getOverviewRequestSchema = z
  .object({
    adapterId: z.string().min(1).optional()
  })
  .strict();
export type GetOverviewRequest = z.infer<typeof getOverviewRequestSchema>;

export const getOverviewResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      overview: overviewViewModelSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GetOverviewResponse = z.infer<typeof getOverviewResponseSchema>;

export const listProjectsRequestSchema = z
  .object({
    adapterId: z.string().min(1).optional()
  })
  .strict();
export type ListProjectsRequest = z.infer<typeof listProjectsRequestSchema>;

export const listProjectsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      projects: z.array(projectSummaryViewModelSchema)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;

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

export const getSessionDetailResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      detail: sessionDetailViewModelSchema.nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GetSessionDetailResponse = z.infer<typeof getSessionDetailResponseSchema>;

export const getRunAuditResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      runAudit: runAuditViewModelSchema.nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GetRunAuditResponse = z.infer<typeof getRunAuditResponseSchema>;

export const listDiagnosticsRequestSchema = z
  .object({
    adapterId: z.string().min(1).optional(),
    severity: diagnosticsSeveritySchema.optional()
  })
  .strict();
export type ListDiagnosticsRequest = z.infer<typeof listDiagnosticsRequestSchema>;

export const listDiagnosticsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      diagnostics: diagnosticsViewModelSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ListDiagnosticsResponse = z.infer<typeof listDiagnosticsResponseSchema>;

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
export type DataSourceOperationalStatus = z.infer<
  typeof dataSourceOperationalStatusSchema
>;

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
export type DataSourceDiagnosticViewModel = z.infer<
  typeof dataSourceDiagnosticViewModelSchema
>;

export const dataSourceCapabilityViewModelSchema = capabilityBadgeViewModelSchema;
export type DataSourceCapabilityViewModel = z.infer<
  typeof dataSourceCapabilityViewModelSchema
>;

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
export type DataSourceAdapterViewModel = z.infer<
  typeof dataSourceAdapterViewModelSchema
>;

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
export type SetDataSourceEnabledRequest = z.infer<
  typeof setDataSourceEnabledRequestSchema
>;

export const validateDataSourceRequestSchema = z
  .object({
    sourceId: z.string().min(1)
  })
  .strict();
export type ValidateDataSourceRequest = z.infer<
  typeof validateDataSourceRequestSchema
>;

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
