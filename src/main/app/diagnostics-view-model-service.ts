import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import type { SourceRecord } from "../core/registry/source-registry.js";
import {
  diagnosticsViewModelSchema,
  listDiagnosticsRequestSchema,
  type DiagnosticRowViewModel,
  type DiagnosticsSourceArea,
  type DiagnosticsViewModel,
  type ListDiagnosticsRequest
} from "../ipc/view-models.js";
import {
  buildSessionPreviewViewModel,
  filterSessions,
  getDiagnosticsForSession,
  getProjectForSession,
  loadTriageData,
  sanitizeText
} from "./triage-view-model-service.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

export interface DiagnosticsViewModelService {
  listDiagnostics(request?: ListDiagnosticsRequest): Promise<DiagnosticsViewModel>;
}

export interface DiagnosticsViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createDiagnosticsViewModelService(
  options: DiagnosticsViewModelServiceOptions = {}
): DiagnosticsViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    async listDiagnostics(request) {
      const parsed = listDiagnosticsRequestSchema.parse(request ?? {});
      const data = await loadTriageData(runtime);
      const sources = await runtime.sourceRegistry.listSources();
      const sessions = filterSessions(data, parsed.adapterId);
      const rows = [
        ...sources.flatMap((source) => collectSourceRows(data, source)),
        ...sessions.flatMap((session) => {
          const preview = buildSessionPreviewViewModel(data, session);
          const project = getProjectForSession(data, session);
          const diagnostics = getDiagnosticsForSession(data, session).map((diagnostic) =>
            toDiagnosticRow(
              data,
              session.adapterId,
              mapDiagnosticArea(diagnostic),
              diagnostic,
              session.id,
              preview.title,
              project?.name
            )
          );
          const capabilityRows = preview.capabilityBadges
            .filter((badge) => badge.state !== "Supported")
            .map((badge) => ({
              code: `capability.${badge.key}`,
              severity: "warning" as const,
              sourceArea: "capability" as const,
              adapterId: session.adapterId,
              adapterDisplayName:
                data.descriptors.get(session.adapterId)?.displayName ?? session.adapterId,
              sessionId: session.id,
              sessionTitle: preview.title,
              ...(project?.name ? { projectName: project.name } : {}),
              message: badge.reason
                ? `${badge.label} is ${badge.state}. ${sanitizeText(badge.reason)}`
                : `${badge.label} is ${badge.state}.`
            }));

          return [...diagnostics, ...capabilityRows];
        })
      ]
        .filter((row) => !parsed.adapterId || row.adapterId === parsed.adapterId)
        .filter((row) => !parsed.severity || row.severity === parsed.severity);

      const groups = new Map<
        string,
        {
          title: string;
          sourceArea: DiagnosticsSourceArea;
          severity: DiagnosticRowViewModel["severity"];
          diagnostics: DiagnosticRowViewModel[];
        }
      >();

      for (const row of rows) {
        const groupId = `${row.sourceArea}:${row.severity}`;
        const current = groups.get(groupId) ?? {
          title: `${humanizeSourceArea(row.sourceArea)} ${humanizeSeverity(row.severity)}`,
          sourceArea: row.sourceArea,
          severity: row.severity,
          diagnostics: []
        };

        current.diagnostics.push(row);
        groups.set(groupId, current);
      }

      return diagnosticsViewModelSchema.parse({
        harnessFilters: [...new Set(rows.map((row) => row.adapterId))].map((adapterId) => ({
          adapterId,
          label: data.descriptors.get(adapterId)?.displayName ?? adapterId,
          sessionCount: rows.filter((row) => row.adapterId === adapterId).length
        })),
        severityFilters: ["info", "warning", "error"],
        groups: [...groups.entries()]
          .map(([groupId, group]) => ({
            groupId,
            title: group.title,
            sourceArea: group.sourceArea,
            severity: group.severity,
            count: group.diagnostics.length,
            diagnostics: group.diagnostics
          }))
          .sort((left, right) => right.count - left.count)
      });
    }
  };
}

function collectSourceRows(
  data: Awaited<ReturnType<typeof loadTriageData>>,
  source: SourceRecord
): DiagnosticRowViewModel[] {
  return [
    ...source.validation.diagnostics.map((diagnostic) =>
      toDiagnosticRow(data, source.adapterId, "source", diagnostic)
    ),
    ...source.scan.diagnostics.map((diagnostic) =>
      toDiagnosticRow(data, source.adapterId, mapDiagnosticArea(diagnostic), diagnostic)
    ),
    ...source.cache.diagnostics.map((diagnostic) =>
      toDiagnosticRow(data, source.adapterId, "cache", diagnostic)
    )
  ];
}

function humanizeSeverity(severity: "info" | "warning" | "error"): string {
  switch (severity) {
    case "info":
      return "Info";
    case "warning":
      return "Warnings";
    case "error":
      return "Errors";
  }
}

function humanizeSourceArea(sourceArea: DiagnosticsSourceArea): string {
  switch (sourceArea) {
    case "adapter":
      return "Adapter";
    case "source":
      return "Source";
    case "normalization":
      return "Normalization";
    case "cache":
      return "Cache";
    case "capability":
      return "Capability";
  }
}

function mapDiagnosticArea(diagnostic: Diagnostic): DiagnosticsSourceArea {
  if (diagnostic.scope === "adapter") {
    return "adapter";
  }

  if (
    diagnostic.code.startsWith("normalization.") ||
    diagnostic.code.includes(".normalize.") ||
    diagnostic.code.includes("parser")
  ) {
    return "normalization";
  }

  return "source";
}

function toDiagnosticRow(
  data: Awaited<ReturnType<typeof loadTriageData>>,
  adapterId: string,
  sourceArea: DiagnosticsSourceArea,
  diagnostic: Diagnostic,
  sessionId?: string,
  sessionTitle?: string,
  projectName?: string
): DiagnosticRowViewModel {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    sourceArea,
    adapterId,
    adapterDisplayName: data.descriptors.get(adapterId)?.displayName ?? adapterId,
    ...(sessionId ? { sessionId } : {}),
    ...(sessionTitle ? { sessionTitle } : {}),
    ...(projectName ? { projectName } : {}),
    message: sanitizeText(diagnostic.message)
  };
}
