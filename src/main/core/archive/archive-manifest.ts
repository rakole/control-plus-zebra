import { z } from "zod";

import { normalizedCacheRecordSchema } from "../cache/file-backed-cache-store.js";
import { persistedDiagnosticSchema } from "../registry/source-registry-store.js";

export const ARCHIVE_FORMAT = "agent-workbench-archive";
export const ARCHIVE_MANIFEST_VERSION = 1;

export const archiveExportScopeSchema = z
  .object({
    kind: z.enum(["project", "session"]),
    id: z.string().min(1),
    label: z.string().min(1)
  })
  .strict();
export type ArchiveExportScopeManifest = z.infer<typeof archiveExportScopeSchema>;

export const archiveExportIncludesSchema = z
  .object({
    normalizedData: z.literal(true),
    diagnostics: z.literal(true),
    rawArtifacts: z.boolean(),
    privacyWarningAcknowledged: z.boolean()
  })
  .strict();
export type ArchiveExportIncludes = z.infer<typeof archiveExportIncludesSchema>;

export const archiveManifestSchema = z
  .object({
    format: z.literal(ARCHIVE_FORMAT),
    manifestVersion: z.literal(ARCHIVE_MANIFEST_VERSION),
    exportedAt: z.string().min(1),
    scope: archiveExportScopeSchema,
    includes: archiveExportIncludesSchema,
    adapters: z.array(z.string().min(1)),
    sourceIds: z.array(z.string().min(1)),
    sessionIds: z.array(z.string().min(1)),
    projectIds: z.array(z.string().min(1)),
    counts: z
      .object({
        sources: z.number().int().nonnegative(),
        sessions: z.number().int().nonnegative(),
        projects: z.number().int().nonnegative(),
        cacheRecords: z.number().int().nonnegative(),
        sourceDiagnostics: z.number().int().nonnegative(),
        rawArtifacts: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

export const archivedSourceRecordSchema = z
  .object({
    sourceId: z.string().min(1),
    adapterId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    rootPath: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    validation: z
      .object({
        status: z.enum([
          "not-validated",
          "validating",
          "valid",
          "validation-failed",
          "unsupported",
          "unknown"
        ]),
        normalizedPath: z.string().min(1).optional(),
        updatedAt: z.string().min(1).optional()
      })
      .strict(),
    scan: z
      .object({
        status: z.enum([
          "cached",
          "never-scanned",
          "scan-failed",
          "scanned-with-diagnostics",
          "scanning",
          "stale",
          "unsupported",
          "unknown"
        ]),
        artifactCount: z.number().int().nonnegative().optional(),
        sessionCount: z.number().int().nonnegative().optional(),
        updatedAt: z.string().min(1).optional(),
        reason: z.string().min(1).optional()
      })
      .strict(),
    cache: z
      .object({
        status: z.enum([
          "cached",
          "never-scanned",
          "scan-failed",
          "scanned-with-diagnostics",
          "scanning",
          "stale",
          "unsupported",
          "unknown"
        ]),
        cacheKey: z.string().min(1).optional(),
        updatedAt: z.string().min(1).optional(),
        reason: z.string().min(1).optional()
      })
      .strict()
  })
  .strict();
export type ArchivedSourceRecord = z.infer<typeof archivedSourceRecordSchema>;

export const archivedRawArtifactSchema = z
  .object({
    artifactId: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    nativeRef: z.string().min(1).optional(),
    nativeId: z.string().min(1),
    artifactKind: z.enum([
      "session-log",
      "message-index",
      "project-root-map",
      "output-artifact",
      "history",
      "metadata",
      "unknown"
    ]),
    artifactType: z.string().min(1),
    mediaType: z.string().min(1).optional(),
    originalPath: z.string().min(1).optional(),
    byteLength: z.number().int().nonnegative().optional(),
    mtimeMs: z.number().nonnegative().optional(),
    parseStrategy: z.enum(["stream-jsonl", "json", "text", "adapter-native", "unknown"]),
    content: z.string()
  })
  .strict();
export type ArchivedRawArtifact = z.infer<typeof archivedRawArtifactSchema>;

export const archiveDocumentSchema = z
  .object({
    manifest: archiveManifestSchema,
    payload: z
      .object({
        sources: z.array(archivedSourceRecordSchema),
        cacheRecords: z.array(normalizedCacheRecordSchema),
        sourceDiagnostics: z.array(persistedDiagnosticSchema),
        rawArtifacts: z.array(archivedRawArtifactSchema).optional()
      })
      .strict()
  })
  .strict();
export type ArchiveDocument = z.infer<typeof archiveDocumentSchema>;
