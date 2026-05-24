import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { SourceRecord } from "./source-registry.js";

const importedArchiveMetadataSchema = z
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
  .strict();

const confidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    normalizedLevel: z.enum(["confirmed", "observed", "inferred", "unknown"]).optional(),
    reason: z.string().optional(),
    evidence: z.array(z.string()).optional()
  })
  .strict();

export const persistedDiagnosticSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(["info", "warning", "error"]),
    scope: z.enum([
      "adapter",
      "source",
      "artifact",
      "project",
      "session",
      "event",
      "message",
      "tool-call",
      "shell-command",
      "output-artifact",
      "file-mutation"
    ]),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    relatedEntityIds: z.array(z.string()).optional(),
    confidence: confidenceSchema,
    metadata: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.null()]))
      .optional()
  })
  .strict();

const validationSummarySchema = z
  .object({
    status: z.enum([
      "not-validated",
      "validating",
      "valid",
      "validation-failed",
      "unsupported",
      "unknown"
    ]),
    diagnostics: z.array(persistedDiagnosticSchema),
    normalizedPath: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional()
  })
  .strict();

const operationalSummarySchema = z
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
    diagnostics: z.array(persistedDiagnosticSchema),
    artifactCount: z.number().int().nonnegative().optional(),
    sessionCount: z.number().int().nonnegative().optional(),
    updatedAt: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    cacheKey: z.string().min(1).optional()
  })
  .strict();

const watchSummarySchema = z
  .object({
    status: z.enum(["supported", "unsupported", "unknown"]),
    reason: z.string().min(1).optional(),
    strategy: z.string().min(1).optional(),
    scopePaths: z.array(z.string().min(1)).optional(),
    plannedAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional()
  })
  .strict();

const sourceRecordSchema = z
  .object({
    sourceId: z.string().min(1),
    adapterId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    rootPath: z.string().min(1),
    enabled: z.boolean(),
    sourceKind: z.enum(["local-root", "imported-archive"]).default("local-root"),
    addedBy: z.enum(["user", "import"]).default("user"),
    readOnly: z.boolean().default(false),
    validation: validationSummarySchema,
    scan: operationalSummarySchema,
    cache: operationalSummarySchema,
    watch: watchSummarySchema,
    diagnostics: z.array(persistedDiagnosticSchema),
    archive: importedArchiveMetadataSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

const sourceRegistryFileSchemaV2 = z
  .object({
    version: z.literal(2),
    records: z.array(sourceRecordSchema)
  })
  .strict();

const watchSummarySchemaV1 = z
  .object({
    status: z.enum(["supported", "unsupported", "unknown"]),
    reason: z.string().min(1).optional(),
    strategy: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional()
  })
  .strict();

const sourceRecordSchemaV1 = sourceRecordSchema.extend({
  watch: watchSummarySchemaV1
});

const sourceRegistryFileSchemaV1 = z
  .object({
    version: z.literal(1),
    records: z.array(sourceRecordSchemaV1)
  })
  .strict();

export interface SourceRegistryStore {
  getFilePath(): string;
  load(): Promise<SourceRecord[]>;
  save(records: SourceRecord[]): Promise<void>;
}

export class FileBackedSourceRegistryStore implements SourceRegistryStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  getFilePath(): string {
    return this.#filePath;
  }

  async load(): Promise<SourceRecord[]> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const parsed = parseSourceRegistryFile(JSON.parse(source));

      return parsed.records;
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  async save(records: SourceRecord[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const payload = sourceRegistryFileSchemaV2.parse({
      version: 2,
      records
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function parseSourceRegistryFile(input: unknown): { records: SourceRecord[] } {
  const parsedV2 = sourceRegistryFileSchemaV2.safeParse(input);

  if (parsedV2.success) {
    return {
      records: parsedV2.data.records as SourceRecord[]
    };
  }

  const parsedV1 = sourceRegistryFileSchemaV1.parse(input);

  return {
    records: parsedV1.records.map((record) => ({
      ...record,
      watch: {
        ...record.watch,
        scopePaths: []
      }
    })) as SourceRecord[]
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
