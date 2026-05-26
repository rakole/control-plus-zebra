import { z } from "zod";

import { normalizedCacheRecordSchema } from "../cache/file-backed-cache-store.js";
import { getUtf8ByteLength } from "../ingestion/bounded-ingestion.js";
import { persistedDiagnosticSchema } from "../registry/source-registry-store.js";

export const ARCHIVE_FORMAT = "agent-workbench-archive";
export const ARCHIVE_V2_MANIFEST_VERSION = 2;
export const ARCHIVE_V3_MANIFEST_VERSION = 3;
export const ARCHIVE_MANIFEST_VERSION = ARCHIVE_V2_MANIFEST_VERSION;

export const ARCHIVE_V3_ENTITY_SECTION_NAMES = [
  "sources",
  "projects",
  "sessions",
  "timeline-events",
  "messages",
  "tool-calls",
  "shell-commands",
  "output-artifacts",
  "file-mutations",
  "diagnostics",
  "verification-snapshots",
  "run-audit-snapshots",
  "git-snapshots",
  "github-snapshots",
  "overview-rollups",
  "project-rollups",
  "session-rollups",
  "raw-artifact-entries"
] as const;
export type ArchiveV3EntitySectionName = (typeof ARCHIVE_V3_ENTITY_SECTION_NAMES)[number];

const archiveV3SectionCountShape = Object.fromEntries(
  ARCHIVE_V3_ENTITY_SECTION_NAMES.map((sectionName) => [
    sectionName,
    z.number().int().nonnegative()
  ])
) as Record<ArchiveV3EntitySectionName, z.ZodNumber>;

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

const archiveManifestBaseSchema = z
  .object({
    format: z.literal(ARCHIVE_FORMAT),
    exportedAt: z.string().min(1),
    scope: archiveExportScopeSchema,
    includes: archiveExportIncludesSchema,
    adapters: z.array(z.string().min(1)),
    sourceIds: z.array(z.string().min(1)),
    sessionIds: z.array(z.string().min(1)),
    projectIds: z.array(z.string().min(1))
  })
  .strict();

const archiveV2ManifestCountsSchema = z
  .object({
    sources: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    cacheRecords: z.number().int().nonnegative(),
    sourceDiagnostics: z.number().int().nonnegative(),
    rawArtifacts: z.number().int().nonnegative()
  })
  .strict();

export const archiveV3EntitySectionNameSchema = z.enum(ARCHIVE_V3_ENTITY_SECTION_NAMES);

export const archiveV3SectionEntityCountsSchema = z
  .object(archiveV3SectionCountShape)
  .strict();
export type ArchiveV3SectionEntityCounts = z.infer<typeof archiveV3SectionEntityCountsSchema>;

export function createEmptyArchiveV3SectionEntityCounts(): ArchiveV3SectionEntityCounts {
  return ARCHIVE_V3_ENTITY_SECTION_NAMES.reduce(
    (counts, sectionName) => {
      counts[sectionName] = 0;
      return counts;
    },
    {} as ArchiveV3SectionEntityCounts
  );
}

export const archiveAggregateLimitsSchema = z
  .object({
    maxSectionCount: z.number().int().positive(),
    maxSectionEntityCount: z.number().int().positive(),
    maxTotalEntityCount: z.number().int().positive(),
    maxRawArtifactChunkCountPerArtifact: z.number().int().positive(),
    maxRawArtifactBytes: z.number().int().positive(),
    maxSourceDiagnosticCount: z.number().int().positive()
  })
  .strict();
export type ArchiveAggregateLimits = z.infer<typeof archiveAggregateLimitsSchema>;

export class ArchiveAggregateLimitError extends Error {
  readonly code:
    | "archive.aggregate.raw-artifact-bytes-exceeded"
    | "archive.aggregate.raw-artifact-chunk-count-exceeded"
    | "archive.aggregate.section-count-exceeded"
    | "archive.aggregate.section-entity-count-exceeded"
    | "archive.aggregate.source-diagnostic-count-exceeded"
    | "archive.aggregate.total-entity-count-exceeded";

  constructor(code: ArchiveAggregateLimitError["code"], message: string) {
    super(message);
    this.name = "ArchiveAggregateLimitError";
    this.code = code;
  }
}

export class ArchiveAggregateTracker {
  readonly #limits: ArchiveAggregateLimits;
  readonly #rawArtifactChunkCounts = new Map<string, number>();
  readonly #sectionEntityCounts = createEmptyArchiveV3SectionEntityCounts();
  #rawArtifactBytes = 0;
  #sectionCount = 0;
  #sourceDiagnosticCount = 0;
  #totalEntityCount = 0;

  constructor(limits: ArchiveAggregateLimits) {
    this.#limits = archiveAggregateLimitsSchema.parse(limits);
  }

  recordEntity(sectionName: ArchiveV3EntitySectionName): void {
    this.recordSection(sectionName);
    this.#sectionEntityCounts[sectionName] += 1;

    if (this.#sectionEntityCounts[sectionName] > this.#limits.maxSectionEntityCount) {
      throw new ArchiveAggregateLimitError(
        "archive.aggregate.section-entity-count-exceeded",
        `Archive section ${sectionName} exceeds the ${this.#limits.maxSectionEntityCount}-entity limit.`
      );
    }

    this.#totalEntityCount += 1;

    if (this.#totalEntityCount > this.#limits.maxTotalEntityCount) {
      throw new ArchiveAggregateLimitError(
        "archive.aggregate.total-entity-count-exceeded",
        `Archive exceeds the ${this.#limits.maxTotalEntityCount}-entity aggregate limit.`
      );
    }
  }

  recordRawArtifactChunk(input: { artifactId: string; byteLength?: number; content?: string }): void {
    const chunkByteLength =
      input.byteLength ?? getUtf8ByteLength(input.content ?? "");
    const chunkCount = (this.#rawArtifactChunkCounts.get(input.artifactId) ?? 0) + 1;

    this.#rawArtifactChunkCounts.set(input.artifactId, chunkCount);

    if (chunkCount > this.#limits.maxRawArtifactChunkCountPerArtifact) {
      throw new ArchiveAggregateLimitError(
        "archive.aggregate.raw-artifact-chunk-count-exceeded",
        `Raw artifact ${input.artifactId} exceeds the ${this.#limits.maxRawArtifactChunkCountPerArtifact}-chunk aggregate limit.`
      );
    }

    this.#rawArtifactBytes += chunkByteLength;

    if (this.#rawArtifactBytes > this.#limits.maxRawArtifactBytes) {
      throw new ArchiveAggregateLimitError(
        "archive.aggregate.raw-artifact-bytes-exceeded",
        `Archive exceeds the ${this.#limits.maxRawArtifactBytes}-byte raw artifact aggregate limit.`
      );
    }
  }

  recordSection(sectionName: ArchiveV3EntitySectionName): void {
    if (this.#sectionEntityCounts[sectionName] > 0) {
      return;
    }

    this.#sectionCount += 1;

    if (this.#sectionCount > this.#limits.maxSectionCount) {
      throw new ArchiveAggregateLimitError(
        "archive.aggregate.section-count-exceeded",
        `Archive exceeds the ${this.#limits.maxSectionCount}-section aggregate limit.`
      );
    }
  }

  recordSourceDiagnostic(): void {
    this.#sourceDiagnosticCount += 1;

    if (this.#sourceDiagnosticCount > this.#limits.maxSourceDiagnosticCount) {
      throw new ArchiveAggregateLimitError(
        "archive.aggregate.source-diagnostic-count-exceeded",
        `Archive exceeds the ${this.#limits.maxSourceDiagnosticCount}-diagnostic aggregate limit.`
      );
    }
  }

  snapshot(): {
    rawArtifactBytes: number;
    rawArtifactChunkCounts: Record<string, number>;
    sectionCount: number;
    sectionEntityCounts: ArchiveV3SectionEntityCounts;
    sourceDiagnosticCount: number;
    totalEntityCount: number;
  } {
    return {
      rawArtifactBytes: this.#rawArtifactBytes,
      rawArtifactChunkCounts: Object.fromEntries(this.#rawArtifactChunkCounts),
      sectionCount: this.#sectionCount,
      sectionEntityCounts: { ...this.#sectionEntityCounts },
      sourceDiagnosticCount: this.#sourceDiagnosticCount,
      totalEntityCount: this.#totalEntityCount
    };
  }
}

export const archiveManifestSchema = archiveManifestBaseSchema
  .extend({
    manifestVersion: z.literal(ARCHIVE_MANIFEST_VERSION),
    counts: z
      .object(archiveV2ManifestCountsSchema.shape)
      .strict()
  })
  .strict();
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

export const archiveV3ManifestSchema = archiveManifestBaseSchema
  .extend({
    manifestVersion: z.literal(ARCHIVE_V3_MANIFEST_VERSION),
    counts: z
      .object({
        sources: z.number().int().nonnegative(),
        sessions: z.number().int().nonnegative(),
        projects: z.number().int().nonnegative(),
        sourceDiagnostics: z.number().int().nonnegative(),
        rawArtifacts: z.number().int().nonnegative(),
        totalEntities: z.number().int().nonnegative()
      })
      .strict(),
    sectionEntityCounts: archiveV3SectionEntityCountsSchema,
    aggregateLimits: archiveAggregateLimitsSchema
  })
  .strict();
export type ArchiveV3Manifest = z.infer<typeof archiveV3ManifestSchema>;

export const archiveVersionedManifestSchema = z.union([
  archiveManifestSchema,
  archiveV3ManifestSchema
]);
export type VersionedArchiveManifest = z.infer<typeof archiveVersionedManifestSchema>;

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

export const archivedRawArtifactMetadataSchema = archivedRawArtifactSchema.omit({
  content: true
});
export type ArchivedRawArtifactMetadata = z.infer<typeof archivedRawArtifactMetadataSchema>;

export const archivedRawArtifactChunkSchema = z
  .object({
    artifactId: z.string().min(1),
    chunkIndex: z.number().int().nonnegative(),
    content: z.string()
  })
  .strict();
export type ArchivedRawArtifactChunk = z.infer<typeof archivedRawArtifactChunkSchema>;

export const archiveV3EntitySectionSchema = z
  .object({
    entityCount: z.number().int().nonnegative(),
    name: archiveV3EntitySectionNameSchema,
    sequence: z.number().int().nonnegative()
  })
  .strict();
export type ArchiveV3EntitySection = z.infer<typeof archiveV3EntitySectionSchema>;

export const archiveV3LineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("manifest"),
      manifest: archiveV3ManifestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("entity-section"),
      manifestVersion: z.literal(ARCHIVE_V3_MANIFEST_VERSION),
      section: archiveV3EntitySectionSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("entity"),
      entityId: z.string().min(1),
      manifestVersion: z.literal(ARCHIVE_V3_MANIFEST_VERSION),
      payload: z.record(z.string(), z.unknown()),
      section: archiveV3EntitySectionNameSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("raw-artifact-chunk"),
      chunk: archivedRawArtifactChunkSchema,
      manifestVersion: z.literal(ARCHIVE_V3_MANIFEST_VERSION)
    })
    .strict()
]);
export type ArchiveV3Line = z.infer<typeof archiveV3LineSchema>;

export const archiveLineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("manifest"),
      manifest: archiveManifestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("source"),
      source: archivedSourceRecordSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("cache-record"),
      record: normalizedCacheRecordSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("source-diagnostic"),
      diagnostic: persistedDiagnosticSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("raw-artifact"),
      artifact: archivedRawArtifactMetadataSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("raw-artifact-chunk"),
      chunk: archivedRawArtifactChunkSchema
    })
    .strict()
]);
export type ArchiveLine = z.infer<typeof archiveLineSchema>;

export const archiveVersionedLineSchema = z.union([archiveLineSchema, archiveV3LineSchema]);
export type VersionedArchiveLine = z.infer<typeof archiveVersionedLineSchema>;
