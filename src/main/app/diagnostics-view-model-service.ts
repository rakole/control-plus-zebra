import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import type { Session } from "../core/model/entities.js";
import type { SourceRecord } from "../core/registry/source-registry.js";
import {
  diagnosticsViewModelSchema,
  listDiagnosticsRequestSchema,
  type DiagnosticRowViewModel,
  type DiagnosticsSourceArea,
  type DiagnosticsViewModel,
  type ListDiagnosticsRequest,
} from "../ipc/view-models.js";
import {
  getProjectDisplayName,
  sanitizeText,
} from "./triage-view-model-service.js";
import { listProjectRollupsBySourceId } from "./store-session-query.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions,
} from "./workbench-runtime.js";
import { isGithubUiEnabled } from "../../shared/feature-flags.js";
import { isGitHubOnlyDiagnostic } from "../../shared/github-ui.js";

export interface DiagnosticsViewModelService {
  listDiagnostics(
    request?: ListDiagnosticsRequest,
  ): Promise<DiagnosticsViewModel>;
}

export interface DiagnosticsViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
}

export function createDiagnosticsViewModelService(
  options: DiagnosticsViewModelServiceOptions = {},
): DiagnosticsViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);

  return {
    async listDiagnostics(request) {
      const parsed = listDiagnosticsRequestSchema.parse(request ?? {});
      const sources = await runtime.sourceRegistry.listSources();
      const descriptors = new Map(
        runtime.adapterRegistry
          .listDescriptors()
          .map((descriptor) => [descriptor.id, descriptor] as const),
      );
      const storeDiagnosticsBySource = await Promise.all(
        sources.map(async (source) => ({
          source,
          diagnostics: (
            await runtime.entityStore.listDiagnostics({
              sourceId: source.sourceId,
              ...(parsed.severity ? { severity: parsed.severity } : {}),
            })
          ).filter(shouldIncludeDiagnosticInUi),
          projectRollups: await listProjectRollupsBySourceId(
            runtime,
            source.sourceId,
          ),
          sessions: await listAllSourceSessions(
            runtime,
            source.sourceId,
            parsed.adapterId,
          ),
        })),
      );
      const sessionDiagnosticsBySessionId = new Map<string, Diagnostic[]>();
      const sessionDiagnosticIds = new Set<string>();

      for (const sourceContext of storeDiagnosticsBySource) {
        for (const session of sourceContext.sessions) {
          const diagnostics = sourceContext.diagnostics.filter((diagnostic) =>
            isDiagnosticRelatedToSession(diagnostic, session),
          );

          sessionDiagnosticsBySessionId.set(session.id, diagnostics);

          for (const diagnostic of diagnostics) {
            sessionDiagnosticIds.add(diagnostic.id);
          }
        }
      }

      const rows = [
        ...sources.flatMap((source) =>
          collectSourceRows(descriptors, source, sessionDiagnosticIds),
        ),
        ...storeDiagnosticsBySource.flatMap((sourceContext) =>
          sourceContext.sessions.flatMap((session) => {
            const sessionDiagnostics =
              sessionDiagnosticsBySessionId.get(session.id) ?? [];
            const project = session.projectId
              ? sourceContext.projectRollups.get(session.projectId)?.project
              : undefined;

            return sessionDiagnostics.map((diagnostic) =>
              toDiagnosticRow(
                descriptors,
                session.adapterId,
                mapDiagnosticArea(diagnostic),
                diagnostic,
                session.id,
                getSessionDisplayTitle(session),
                getProjectDisplayName(project),
              ),
            );
          }),
        ),
      ]
        .filter(
          (row) => !parsed.adapterId || row.adapterId === parsed.adapterId,
        )
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
          diagnostics: [],
        };

        current.diagnostics.push(row);
        groups.set(groupId, current);
      }

      return diagnosticsViewModelSchema.parse({
        harnessFilters: [...new Set(rows.map((row) => row.adapterId))].map(
          (adapterId) => ({
            adapterId,
            label: descriptors.get(adapterId)?.displayName ?? adapterId,
            sessionCount: rows.filter((row) => row.adapterId === adapterId)
              .length,
          }),
        ),
        severityFilters: ["info", "warning", "error"],
        groups: [...groups.entries()]
          .map(([groupId, group]) => ({
            groupId,
            title: group.title,
            sourceArea: group.sourceArea,
            severity: group.severity,
            count: group.diagnostics.length,
            diagnostics: group.diagnostics,
          }))
          .sort((left, right) => right.count - left.count),
      });
    },
  };
}

function collectSourceRows(
  descriptors: Map<string, { displayName: string }>,
  source: SourceRecord,
  sessionDiagnosticIds: Set<string>,
): DiagnosticRowViewModel[] {
  const rows = [
    ...source.validation.diagnostics
      .filter(shouldIncludeDiagnosticInUi)
      .map((diagnostic) =>
        toDiagnosticRow(descriptors, source.adapterId, "source", diagnostic),
      ),
    ...source.scan.diagnostics
      .filter(shouldIncludeDiagnosticInUi)
      .filter((diagnostic) => !sessionDiagnosticIds.has(diagnostic.id))
      .map((diagnostic) =>
        toDiagnosticRow(
          descriptors,
          source.adapterId,
          mapDiagnosticArea(diagnostic),
          diagnostic,
        ),
      ),
    ...source.cache.diagnostics
      .filter(shouldIncludeDiagnosticInUi)
      .filter((diagnostic) => !sessionDiagnosticIds.has(diagnostic.id))
      .map((diagnostic) =>
        toDiagnosticRow(descriptors, source.adapterId, "cache", diagnostic),
      ),
  ];

  return dedupeRows(rows);
}

async function listAllSourceSessions(
  runtime: WorkbenchRuntime,
  sourceId: string,
  adapterId?: string,
): Promise<Session[]> {
  const sessions: Session[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await runtime.entityStore.listSessionsPage({
      sourceId,
      ...(adapterId ? { adapterId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 100,
    });

    sessions.push(...page.items.map((item) => item.session));

    if (!page.pageInfo.nextCursor) {
      return sessions;
    }

    cursor = page.pageInfo.nextCursor;
  }
}

function dedupeRows(rows: DiagnosticRowViewModel[]): DiagnosticRowViewModel[] {
  const seen = new Set<string>();
  const deduped: DiagnosticRowViewModel[] = [];

  for (const row of rows) {
    const key = [
      row.adapterId,
      row.code,
      row.severity,
      row.message,
      row.sessionId ?? "",
      row.sessionTitle ?? "",
      row.projectDisplayName ?? "",
    ].join("\0");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
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
  descriptors: Map<string, { displayName: string }>,
  adapterId: string,
  sourceArea: DiagnosticsSourceArea,
  diagnostic: Diagnostic,
  sessionId?: string,
  sessionTitle?: string,
  projectDisplayName?: string,
): DiagnosticRowViewModel {
  return {
    code: diagnostic.code,
    severity: resolveDiagnosticSeverity(diagnostic),
    sourceArea,
    adapterId,
    adapterDisplayName: descriptors.get(adapterId)?.displayName ?? adapterId,
    ...(sessionId ? { sessionId } : {}),
    ...(sessionTitle ? { sessionTitle } : {}),
    ...(projectDisplayName ? { projectDisplayName } : {}),
    message: sanitizeText(diagnostic.message),
  };
}

function getSessionDisplayTitle(session: Session): string {
  return session.title ?? session.nativeSessionId ?? session.id;
}

function isDiagnosticRelatedToSession(
  diagnostic: Diagnostic,
  session: Session,
): boolean {
  const relatedEntityIds = new Set([
    session.id,
    ...(session.eventIds ?? []),
    ...(session.messageIds ?? []),
    ...(session.toolCallIds ?? []),
    ...(session.fileMutationIds ?? []),
    ...(session.outputArtifactIds ?? []),
    ...(session.shellCommandIds ?? []),
    ...(session.diagnosticIds ?? []),
  ]);

  if (relatedEntityIds.has(diagnostic.id)) {
    return true;
  }

  if (
    diagnostic.relatedEntityIds?.some((entityId) =>
      relatedEntityIds.has(entityId),
    )
  ) {
    return true;
  }

  return (
    typeof diagnostic.metadata?.sessionId === "string" &&
    diagnostic.metadata.sessionId === session.nativeSessionId
  );
}

function resolveDiagnosticSeverity(
  diagnostic: Diagnostic,
): DiagnosticRowViewModel["severity"] {
  if (diagnostic.code === "github.pr.no-match") {
    return "info";
  }

  return diagnostic.severity;
}

function shouldIncludeDiagnosticInUi(diagnostic: Diagnostic): boolean {
  if (isGithubUiEnabled()) {
    return true;
  }

  return !isGitHubOnlyDiagnostic(diagnostic);
}
