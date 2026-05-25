import { z } from "zod";

const operationChannelSchema = z.enum([
  "app:getShellState",
  "harnesses:list",
  "harnesses:getCapabilities",
  "sources:list",
  "sources:add",
  "sources:update",
  "sources:disable",
  "sources:validate",
  "sources:rescan",
  "scanner:getStatus",
  "scanner:rescanAll",
  "scanner:rescanSource",
  "export:createArchive",
  "import:openArchive",
  "dashboard:getStats",
  "projects:list",
  "projects:get",
  "sessions:list",
  "sessions:get",
  "sessions:getTimeline",
  "events:get",
  "toolCalls:get",
  "shellCommands:get",
  "outputArtifacts:getPreview",
  "outputArtifacts:load",
  "audit:getRunAudit",
  "sessions:getRunAudit",
  "git:getSnapshot",
  "github:getSnapshot",
  "diagnostics:list",
  "theme:getState",
  "theme:setPreference"
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
  "No Matching PR",
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

export const capabilityGroupKeySchema = z.enum([
  "discovery",
  "replay",
  "tools",
  "usage",
  "live",
  "audit",
  "export"
]);
export type CapabilityGroupKey = z.infer<typeof capabilityGroupKeySchema>;

export const capabilityGroupViewModelSchema = z
  .object({
    key: capabilityGroupKeySchema,
    label: z.string().min(1),
    capabilities: z.array(capabilityBadgeViewModelSchema)
  })
  .strict();
export type CapabilityGroupViewModel = z.infer<typeof capabilityGroupViewModelSchema>;

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

export const evidenceMetricsViewModelSchema = z
  .object({
    messages: metricStateViewModelSchema,
    toolCalls: metricStateViewModelSchema,
    shellCommands: metricStateViewModelSchema,
    outputArtifacts: metricStateViewModelSchema,
    fileMutations: metricStateViewModelSchema,
    diagnostics: metricStateViewModelSchema
  })
  .strict();
export type EvidenceMetricsViewModel = z.infer<typeof evidenceMetricsViewModelSchema>;

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

export const overviewUsageSummaryViewModelSchema = z
  .object({
    models: fieldValueViewModelSchema,
    tokenCount: metricStateViewModelSchema
  })
  .strict();
export type OverviewUsageSummaryViewModel = z.infer<
  typeof overviewUsageSummaryViewModelSchema
>;

export const overviewViewModelSchema = z
  .object({
    metrics: overviewMetricsViewModelSchema,
    usageSummary: overviewUsageSummaryViewModelSchema,
    harnessFilters: z.array(harnessFilterOptionViewModelSchema),
    activity: z.array(overviewActivityPointViewModelSchema)
  })
  .strict();
export type OverviewViewModel = z.infer<typeof overviewViewModelSchema>;

export const archiveExportAvailabilitySchema = z
  .object({
    scopeKind: z.enum(["project", "session"]),
    scopeId: z.string().min(1),
    scopeLabel: z.string().min(1),
    sessionCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    rawArtifactsAvailable: z.boolean(),
    rawArtifactCount: z.number().int().nonnegative(),
    rawArtifactsReason: z.string().min(1).optional()
  })
  .strict();
export type ArchiveExportAvailability = z.infer<typeof archiveExportAvailabilitySchema>;

export const projectSummaryViewModelSchema = z
  .object({
    projectId: z.string().min(1),
    projectDisplayName: z.string().min(1),
    projectName: z.string().min(1).optional(),
    primaryRootPath: fieldValueViewModelSchema,
    validatedRepoRoot: fieldValueViewModelSchema,
    observedHarnesses: z.array(z.string().min(1)),
    latestActivityAt: z.string().min(1).optional(),
    sessionCount: z.number().int().nonnegative(),
    latestVerification: truthStateViewModelSchema,
    latestRunAudit: truthStateViewModelSchema,
    gitStatus: truthStateViewModelSchema,
    githubStatus: truthStateViewModelSchema,
    branch: fieldValueViewModelSchema,
    head: fieldValueViewModelSchema,
    dirtyState: truthStateViewModelSchema,
    changedFiles: metricStateViewModelSchema,
    untrackedFiles: metricStateViewModelSchema,
    additions: metricStateViewModelSchema,
    deletions: metricStateViewModelSchema,
    remoteUrl: fieldValueViewModelSchema,
    pullRequest: fieldValueViewModelSchema,
    checks: fieldValueViewModelSchema,
    reviewStatus: fieldValueViewModelSchema,
    archiveExport: archiveExportAvailabilitySchema
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

export const sessionUsageSummaryViewModelSchema = z
  .object({
    models: fieldValueViewModelSchema,
    tokenCount: metricStateViewModelSchema
  })
  .strict();
export type SessionUsageSummaryViewModel = z.infer<
  typeof sessionUsageSummaryViewModelSchema
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
    projectDisplayName: z.string().min(1).optional(),
    firstUserPrompt: z.string().min(1).optional(),
    capabilityGroups: z.array(capabilityGroupViewModelSchema),
    diagnosticWarningCount: z.number().int().nonnegative(),
    verificationState: truthStateViewModelSchema,
    runAuditState: truthStateViewModelSchema,
    attentionReasons: z.array(z.string().min(1)),
    evidenceSummary: evidenceSummaryViewModelSchema,
    evidenceMetrics: evidenceMetricsViewModelSchema,
    usageSummary: sessionUsageSummaryViewModelSchema,
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
      "metadata",
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
    sections: z.array(runAuditSectionViewModelSchema),
    archiveExport: archiveExportAvailabilitySchema
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
    projectDisplayName: z.string().min(1).optional(),
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

export const createArchiveRequestSchema = z
  .object({
    scope: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("project"),
          projectId: z.string().min(1)
        })
        .strict(),
      z
        .object({
          kind: z.literal("session"),
          sessionId: z.string().min(1)
        })
        .strict()
    ]),
    includeRawArtifacts: z.boolean().default(false),
    privacyWarningAcknowledged: z.boolean()
  })
  .strict();
export type CreateArchiveRequest = z.infer<typeof createArchiveRequestSchema>;

export const createArchiveResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("cancelled"),
      rawArtifactsIncluded: z.boolean(),
      rawArtifactCount: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      status: z.literal("exported"),
      archivePath: z.string().min(1),
      manifestVersion: z.number().int().positive(),
      rawArtifactsIncluded: z.boolean(),
      rawArtifactCount: z.number().int().nonnegative()
    })
    .strict()
]);
export type CreateArchiveResult = z.infer<typeof createArchiveResultSchema>;

export const createArchiveResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      archive: createArchiveResultSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type CreateArchiveResponse = z.infer<typeof createArchiveResponseSchema>;

export const openArchiveRequestSchema = z
  .object({
    archivePath: z.string().min(1).optional()
  })
  .strict();
export type OpenArchiveRequest = z.infer<typeof openArchiveRequestSchema>;

export const openArchiveResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("cancelled")
    })
    .strict(),
  z
    .object({
      status: z.literal("imported"),
      archivePath: z.string().min(1),
      manifestVersion: z.number().int().positive(),
      sourceId: z.string().min(1)
    })
    .strict()
]);
export type OpenArchiveResult = z.infer<typeof openArchiveResultSchema>;

export const openArchiveResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      archiveImport: openArchiveResultSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type OpenArchiveResponse = z.infer<typeof openArchiveResponseSchema>;

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
    capabilityGroups: z.array(capabilityGroupViewModelSchema),
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
    sourceKind: z.enum(["Local Source", "Imported Archive"]),
    addedBy: z.enum(["Configured", "Import"]),
    readOnly: z.boolean(),
    readOnlyLabel: z.literal("Read Only").optional(),
    readOnlyReason: z.string().min(1).optional(),
    archiveMetadata: z
      .object({
        archivePath: z.string().min(1),
        exportedAt: z.string().min(1),
        importedAt: z.string().min(1),
        manifestVersion: z.number().int().positive(),
        scopeKind: z.enum(["project", "session"]),
        scopeId: z.string().min(1),
        scopeLabel: z.string().min(1),
        sourceCount: z.number().int().nonnegative(),
        sessionCount: z.number().int().nonnegative(),
        projectCount: z.number().int().nonnegative(),
        rawArtifactCount: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
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
    capabilityGroups: z.array(capabilityGroupViewModelSchema),
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
    displayName: z.string().min(1).optional(),
    enabled: z.boolean().optional()
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

export const harnessViewModelSchema = dataSourceAdapterViewModelSchema;
export type HarnessViewModel = z.infer<typeof harnessViewModelSchema>;

export const listHarnessesRequestSchema = z.undefined();
export type ListHarnessesRequest = z.infer<typeof listHarnessesRequestSchema>;

export const listHarnessesResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      harnesses: z.array(harnessViewModelSchema)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ListHarnessesResponse = z.infer<typeof listHarnessesResponseSchema>;

export const getHarnessCapabilitiesRequestSchema = z
  .object({
    adapterId: z.string().min(1).optional()
  })
  .strict();
export type GetHarnessCapabilitiesRequest = z.infer<
  typeof getHarnessCapabilitiesRequestSchema
>;

export const getHarnessCapabilitiesResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      harnesses: z.array(harnessViewModelSchema)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GetHarnessCapabilitiesResponse = z.infer<
  typeof getHarnessCapabilitiesResponseSchema
>;

export const listSourcesRequestSchema = z.undefined();
export type ListSourcesRequest = z.infer<typeof listSourcesRequestSchema>;

export const addSourceRequestSchema = addDataSourceRequestSchema;
export type AddSourceRequest = z.infer<typeof addSourceRequestSchema>;

export const updateSourceRequestSchema = updateDataSourceRequestSchema;
export type UpdateSourceRequest = z.infer<typeof updateSourceRequestSchema>;

export const disableSourceRequestSchema = z
  .object({
    sourceId: z.string().min(1)
  })
  .strict();
export type DisableSourceRequest = z.infer<typeof disableSourceRequestSchema>;

export const validateSourceRequestSchema = validateDataSourceRequestSchema;
export type ValidateSourceRequest = z.infer<typeof validateSourceRequestSchema>;

export const rescanSourceRequestSchema = scanDataSourceRequestSchema;
export type RescanSourceRequest = z.infer<typeof rescanSourceRequestSchema>;

export const sourcesResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      sources: dataSourcesViewModelSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;

export const scannerStatusViewModelSchema = z
  .object({
    status: z.enum(["idle", "scanning", "unknown"]),
    totalSources: z.number().int().nonnegative(),
    enabledSources: z.number().int().nonnegative(),
    activeScans: z.number().int().nonnegative(),
    staleSources: z.number().int().nonnegative(),
    lastUpdatedAt: z.string().min(1).optional()
  })
  .strict();
export type ScannerStatusViewModel = z.infer<typeof scannerStatusViewModelSchema>;

export const getScannerStatusRequestSchema = z.undefined();
export type GetScannerStatusRequest = z.infer<typeof getScannerStatusRequestSchema>;

export const scannerStatusResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      scanner: scannerStatusViewModelSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ScannerStatusResponse = z.infer<typeof scannerStatusResponseSchema>;

export const rescanAllSourcesRequestSchema = z.undefined();
export type RescanAllSourcesRequest = z.infer<typeof rescanAllSourcesRequestSchema>;

export const getProjectRequestSchema = z
  .object({
    projectId: z.string().min(1)
  })
  .strict();
export type GetProjectRequest = z.infer<typeof getProjectRequestSchema>;

export const getProjectResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      project: projectSummaryViewModelSchema.nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GetProjectResponse = z.infer<typeof getProjectResponseSchema>;

export const getSessionRequestSchema = getSessionByIdRequestSchema;
export type GetSessionRequest = z.infer<typeof getSessionRequestSchema>;

export const getSessionResponseSchema = getSessionByIdResponseSchema;
export type GetSessionResponse = z.infer<typeof getSessionResponseSchema>;

export const getSessionTimelineRequestSchema = getSessionByIdRequestSchema;
export type GetSessionTimelineRequest = z.infer<typeof getSessionTimelineRequestSchema>;

export const sessionTimelineResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      timeline: z.array(timelineEventViewModelSchema).nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type SessionTimelineResponse = z.infer<typeof sessionTimelineResponseSchema>;

export const getEventsRequestSchema = getSessionByIdRequestSchema;
export type GetEventsRequest = z.infer<typeof getEventsRequestSchema>;

export const eventsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      events: z.array(timelineEventViewModelSchema).nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

export const getToolCallsRequestSchema = getSessionByIdRequestSchema;
export type GetToolCallsRequest = z.infer<typeof getToolCallsRequestSchema>;

export const toolCallsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      toolCalls: z.array(timelineEventViewModelSchema).nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ToolCallsResponse = z.infer<typeof toolCallsResponseSchema>;

export const getShellCommandsRequestSchema = getSessionByIdRequestSchema;
export type GetShellCommandsRequest = z.infer<typeof getShellCommandsRequestSchema>;

export const shellCommandsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      shellCommands: z.array(timelineEventViewModelSchema).nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type ShellCommandsResponse = z.infer<typeof shellCommandsResponseSchema>;

export const outputArtifactRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    outputArtifactId: z.string().min(1)
  })
  .strict();
export type OutputArtifactRequest = z.infer<typeof outputArtifactRequestSchema>;

const outputArtifactUnavailableStateSchema = z
  .object({
    status: z.enum(["missing", "unavailable", "unsupported", "unreadable"]),
    outputArtifactId: z.string().min(1),
    contentKind: z
      .enum(["plain-text", "json-output-wrapper", "json", "binary", "unknown"])
      .optional(),
    mediaType: z.string().min(1).optional(),
    reason: z.string().min(1),
    timelineEntry: timelineEventViewModelSchema.nullable()
  })
  .strict();

const outputArtifactPreviewReadyStateSchema = z
  .object({
    status: z.literal("preview-ready"),
    outputArtifactId: z.string().min(1),
    contentKind: z.enum(["plain-text", "json-output-wrapper", "json", "binary", "unknown"]),
    mediaType: z.string().min(1).optional(),
    text: z.string(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative().optional(),
    timelineEntry: timelineEventViewModelSchema.nullable()
  })
  .strict();

export const outputArtifactPreviewResultSchema = z.discriminatedUnion("status", [
  outputArtifactPreviewReadyStateSchema,
  outputArtifactUnavailableStateSchema
]);
export type OutputArtifactPreviewResult = z.infer<
  typeof outputArtifactPreviewResultSchema
>;

export const outputArtifactPreviewResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      preview: outputArtifactPreviewResultSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type OutputArtifactPreviewResponse = z.infer<
  typeof outputArtifactPreviewResponseSchema
>;

const outputArtifactLoadedStateSchema = z
  .object({
    status: z.literal("loaded"),
    outputArtifactId: z.string().min(1),
    contentKind: z.enum(["plain-text", "json-output-wrapper", "json", "binary", "unknown"]),
    mediaType: z.string().min(1).optional(),
    text: z.string(),
    byteLength: z.number().int().nonnegative().optional(),
    timelineEntry: timelineEventViewModelSchema.nullable()
  })
  .strict();

export const outputArtifactLoadResultSchema = z.discriminatedUnion("status", [
  outputArtifactLoadedStateSchema,
  outputArtifactUnavailableStateSchema
]);
export type OutputArtifactLoadResult = z.infer<typeof outputArtifactLoadResultSchema>;

export const outputArtifactLoadResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      artifact: outputArtifactLoadResultSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type OutputArtifactLoadResponse = z.infer<
  typeof outputArtifactLoadResponseSchema
>;

export const dashboardStatsRequestSchema = getOverviewRequestSchema;
export type DashboardStatsRequest = z.infer<typeof dashboardStatsRequestSchema>;

export const dashboardStatsResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      stats: overviewViewModelSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type DashboardStatsResponse = z.infer<typeof dashboardStatsResponseSchema>;

export const gitSnapshotViewModelSchema = z
  .object({
    projectId: z.string().min(1),
    validatedRepoRoot: fieldValueViewModelSchema,
    remoteUrl: fieldValueViewModelSchema,
    status: truthStateViewModelSchema,
    branch: fieldValueViewModelSchema,
    head: fieldValueViewModelSchema,
    dirtyState: truthStateViewModelSchema,
    changedFiles: metricStateViewModelSchema,
    untrackedFiles: metricStateViewModelSchema,
    additions: metricStateViewModelSchema,
    deletions: metricStateViewModelSchema
  })
  .strict();
export type GitSnapshotViewModel = z.infer<typeof gitSnapshotViewModelSchema>;

export const gitSnapshotRequestSchema = getProjectRequestSchema;
export type GitSnapshotRequest = z.infer<typeof gitSnapshotRequestSchema>;

export const gitSnapshotResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      snapshot: gitSnapshotViewModelSchema.nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GitSnapshotResponse = z.infer<typeof gitSnapshotResponseSchema>;

export const githubSnapshotViewModelSchema = z
  .object({
    projectId: z.string().min(1),
    remoteUrl: fieldValueViewModelSchema,
    status: truthStateViewModelSchema,
    pullRequest: fieldValueViewModelSchema,
    checks: fieldValueViewModelSchema,
    reviewStatus: fieldValueViewModelSchema
  })
  .strict();
export type GitHubSnapshotViewModel = z.infer<typeof githubSnapshotViewModelSchema>;

export const githubSnapshotRequestSchema = getProjectRequestSchema;
export type GitHubSnapshotRequest = z.infer<typeof githubSnapshotRequestSchema>;

export const githubSnapshotResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      snapshot: githubSnapshotViewModelSchema.nullable()
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: sanitizedErrorViewModelSchema
    })
    .strict()
]);
export type GitHubSnapshotResponse = z.infer<typeof githubSnapshotResponseSchema>;
