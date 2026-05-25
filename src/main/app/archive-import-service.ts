import { z } from "zod";

import { ArchiveImporter } from "../core/archive/archive-importer.js";
import {
  openArchiveRequestSchema,
  type OpenArchiveRequest,
  type OpenArchiveResult
} from "../ipc/view-models.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";
import { syncLatestSourceCacheRecordToEntityStore } from "./workbench-entity-store-sync.js";

export interface ArchiveImportService {
  openArchive(request?: OpenArchiveRequest): Promise<OpenArchiveResult>;
}

export interface ArchiveImportServiceOptions extends WorkbenchRuntimeOptions {
  now?: () => Date;
  runtime?: WorkbenchRuntime;
  selectArchivePath?: (input: { suggestedPath?: string }) => Promise<string | null>;
}

export function createArchiveImportService(
  options: ArchiveImportServiceOptions = {}
): ArchiveImportService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const importer = new ArchiveImporter({
    appDataDir: runtime.appDataDir,
    cacheStore: runtime.cacheStore,
    ...(options.now ? { now: options.now } : {}),
    rawArtifactIndex: runtime.rawArtifactIndex,
    sourceRegistry: runtime.sourceRegistry
  });

  return {
    async openArchive(request = {}) {
      const parsed = openArchiveRequestSchema.parse(request);
      const archivePath =
        parsed.archivePath ??
        (await (options.selectArchivePath ?? selectNoArchivePath)({
          ...(parsed.archivePath ? { suggestedPath: parsed.archivePath } : {})
        }));

      if (!archivePath) {
        return openArchiveResultSchema.parse({
          status: "cancelled"
        });
      }

      const result = await importer.importArchive({
        archivePath
      });
      await syncLatestSourceCacheRecordToEntityStore(runtime, result.sourceId);

      return openArchiveResultSchema.parse({
        status: "imported",
        archivePath: result.archivePath,
        manifestVersion: result.manifest.manifestVersion,
        sourceId: result.sourceId
      });
    }
  };
}

const openArchiveResultSchema = z.discriminatedUnion("status", [
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

async function selectNoArchivePath(_input: {
  suggestedPath?: string;
}): Promise<string | null> {
  return null;
}
