import path from "node:path";

import { z } from "zod";

import { ArchiveExporter, type ArchiveExportScope } from "../core/archive/archive-exporter.js";
import {
  createArchiveRequestSchema,
  type CreateArchiveRequest,
  type CreateArchiveResult
} from "../ipc/view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";

export interface ArchiveExportService {
  createArchive(request: CreateArchiveRequest): Promise<CreateArchiveResult>;
}

export interface ArchiveExportServiceOptions extends WorkbenchRuntimeOptions {
  now?: () => Date;
  runtime?: WorkbenchRuntime;
  selectDestination?: (input: {
    defaultPath: string;
    includeRawArtifacts: boolean;
    scope: ArchiveExportScope;
  }) => Promise<string | null>;
}

export function createArchiveExportService(
  options: ArchiveExportServiceOptions = {}
): ArchiveExportService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const now = options.now ?? (() => new Date());
  const exporter = new ArchiveExporter({
    cacheStore: runtime.cacheStore,
    rawArtifactIndex: runtime.rawArtifactIndex,
    sourceRegistry: runtime.sourceRegistry,
    now
  });

  return {
    async createArchive(request) {
      const parsed = createArchiveRequestSchema.parse(request);
      const scope =
        parsed.scope.kind === "project"
          ? ({ kind: "project", projectId: parsed.scope.projectId } as const)
          : ({ kind: "session", sessionId: parsed.scope.sessionId } as const);
      const destinationPath = await (options.selectDestination ?? selectDefaultDestination)({
        defaultPath: buildDefaultArchivePath(runtime, parsed, now),
        includeRawArtifacts: parsed.includeRawArtifacts,
        scope
      });

      if (!destinationPath) {
        return createArchiveResultSchema.parse({
          status: "cancelled",
          rawArtifactsIncluded: parsed.includeRawArtifacts,
          rawArtifactCount: 0
        });
      }

      const result = await exporter.createArchive({
        destinationPath,
        includeRawArtifacts: parsed.includeRawArtifacts,
        privacyWarningAcknowledged: parsed.privacyWarningAcknowledged,
        scope
      });

      return createArchiveResultSchema.parse({
        status: "exported",
        archivePath: result.archivePath,
        manifestVersion: result.manifest.manifestVersion,
        rawArtifactsIncluded: result.manifest.includes.rawArtifacts,
        rawArtifactCount: result.rawArtifactCount
      });
    }
  };
}

const createArchiveResultSchema = z.discriminatedUnion("status", [
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

function buildDefaultArchivePath(
  runtime: WorkbenchRuntime,
  request: CreateArchiveRequest,
  now: () => Date
): string {
  const timestamp = now()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
    .toLowerCase();
  const slug =
    request.scope.kind === "project"
      ? request.scope.projectId
      : request.scope.sessionId;

  return path.join(runtime.appDataDir, "exports", `${slug}-${timestamp}.awb-archive.json`);
}

async function selectDefaultDestination(input: {
  defaultPath: string;
  includeRawArtifacts: boolean;
  scope: ArchiveExportScope;
}): Promise<string | null> {
  return input.defaultPath;
}
