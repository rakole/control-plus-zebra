import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { AdapterNormalizationResult } from "../adapter-contract/types.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";
import type { RunAuditResult } from "../audit/types.js";
import type { ProjectGitHubSnapshot } from "../github/github-snapshot-provider.js";
import type { ParsedShellCommand } from "../shell/types.js";
import type { VerificationResult } from "../verification/types.js";
import type { ProjectGitSnapshot } from "../git/git-snapshot-provider.js";
import { normalizedResultSchema } from "../ingestion/normalization-validator.js";

const CACHE_FILE_VERSION = 2;
const DERIVED_CACHE_VERSION = 1;

const confidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    normalizedLevel: z.enum(["confirmed", "observed", "inferred", "unknown"]).optional(),
    reason: z.string().optional(),
    evidence: z.array(z.string()).optional()
  })
  .strict();

const parsedShellCommandSchema = z
  .object({
    shellCommandId: z.string().min(1),
    command: z.string().min(1),
    cwd: z.string().min(1).optional(),
    intent: z.enum(["test", "build", "typecheck", "lint", "install", "git", "other", "unknown"]),
    result: z.enum(["passed", "failed", "unknown"]),
    outputSource: z.enum(["stdout", "stderr", "combined", "unknown"]),
    outputTextSource: z.enum(["artifact", "summary", "artifact+summary", "missing"]),
    exitCode: z.number().int().optional(),
    exitCodeSource: z.enum(["evidence", "artifact", "summary", "artifact+summary", "unknown"]),
    rawToolStatus: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]).optional(),
    toolCallId: z.string().min(1).optional(),
    artifactIds: z.array(z.string().min(1)).optional(),
    failureMarkers: z.array(z.string().min(1)),
    confidence: confidenceSchema,
    diagnosticIds: z.array(z.string().min(1)).optional()
  })
  .strict();

const verificationResultSchema = z
  .object({
    status: z.enum(["passed", "failed", "not-run", "unknown", "unsupported"]),
    confidence: confidenceSchema,
    commandIds: z.array(z.string().min(1)),
    intentResults: z.array(
      z
        .object({
          intent: z.enum(["test", "build", "typecheck", "lint"]),
          latestCommandId: z.string().min(1),
          latestStatus: z.enum(["passed", "failed", "unknown"]),
          commandIds: z.array(z.string().min(1)),
          confidence: confidenceSchema,
          diagnosticIds: z.array(z.string().min(1)).optional()
        })
        .strict()
    ),
    reasonCodes: z.array(
      z.enum([
        "capability-unknown",
        "capability-unsupported",
        "no-qualifying-commands",
        "output-missing",
        "parser-warning"
      ])
    ),
    diagnosticIds: z.array(z.string().min(1)).optional()
  })
  .strict();

const runAuditSchema = z
  .object({
    status: z.enum([
      "active",
      "cancelled",
      "verification-failed",
      "incomplete",
      "needs-review",
      "clean",
      "unknown"
    ]),
    attentionReasons: z.array(
      z.enum([
        "failed-verification",
        "no-verification",
        "pending-tool-calls",
        "post-claim-activity",
        "dirty-after-claim",
        "missing-sidecar",
        "parser-warning",
        "capability-missing",
        "claim-uncertain"
      ])
    ),
    confidence: confidenceSchema,
    completionClaim: z.enum(["claimed", "not-claimed", "unknown"]),
    supportingCommandIds: z.array(z.string().min(1)),
    supportingToolCallIds: z.array(z.string().min(1)),
    supportingMessageIds: z.array(z.string().min(1)),
    diagnosticIds: z.array(z.string().min(1)).optional()
  })
  .strict();

const gitSnapshotSchema = z
  .object({
    status: z.enum(["available", "unknown", "unsupported"]),
    rootConfidence: z.enum(["confirmed", "observed", "inferred", "unknown"]),
    candidateRootPath: z.string().min(1).optional(),
    validatedRootPath: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    remoteReason: z.string().min(1).optional(),
    snapshot: z
      .object({
        additions: z.number().int().nonnegative(),
        branch: z.string().min(1),
        changedFiles: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        dirty: z.boolean(),
        headSha: z.string().min(1),
        remoteUrl: z.string().min(1).optional(),
        untrackedFiles: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    diagnosticIds: z.array(z.string().min(1))
  })
  .strict();

const githubSnapshotSchema = z
  .object({
    status: z.enum(["available", "no-matching-pr", "unknown", "unsupported"]),
    pullRequestNumber: z.number().int().positive().optional(),
    pullRequestTitle: z.string().min(1).optional(),
    pullRequestUrl: z.string().min(1).optional(),
    checksSummary: z.string().min(1).optional(),
    reviewSummary: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    diagnosticIds: z.array(z.string().min(1))
  })
  .strict();

const derivedCacheRecordSchema = z
  .object({
    version: z.literal(DERIVED_CACHE_VERSION).default(DERIVED_CACHE_VERSION),
    sessions: z.array(
      z
        .object({
          sessionId: z.string().min(1),
          shellCommands: z.array(parsedShellCommandSchema),
          verification: verificationResultSchema.optional(),
          audit: runAuditSchema.optional()
        })
        .strict()
    ),
    projects: z
      .array(
        z
          .object({
            projectId: z.string().min(1),
            git: gitSnapshotSchema,
            github: githubSnapshotSchema.optional()
          })
          .strict()
      )
      .optional()
  })
  .strict();

export const normalizedCacheRecordSchema = z
  .object({
    cacheKey: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    artifactFingerprint: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    normalized: normalizedResultSchema,
    derived: derivedCacheRecordSchema.optional()
  })
  .strict();

const cacheFileSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(CACHE_FILE_VERSION)]),
    records: z.array(normalizedCacheRecordSchema)
  })
  .strict()
  .transform((payload) => ({
    version: CACHE_FILE_VERSION,
    records: payload.records
  }));

export interface NormalizedCacheRecord {
  cacheKey: string;
  adapterId: AdapterId;
  sourceId: SourceId;
  artifactFingerprint: string;
  createdAt: string;
  updatedAt: string;
  normalized: AdapterNormalizationResult;
  derived?: DerivedCacheRecord;
}

export interface DerivedSessionCacheRecord {
  sessionId: string;
  shellCommands: ParsedShellCommand[];
  verification?: VerificationResult;
  audit?: RunAuditResult;
}

export interface DerivedProjectCacheRecord {
  projectId: string;
  git: ProjectGitSnapshot;
  github?: ProjectGitHubSnapshot;
}

export interface DerivedCacheRecord {
  version?: 1;
  sessions: DerivedSessionCacheRecord[];
  projects?: DerivedProjectCacheRecord[];
}

export class FileBackedCacheStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<NormalizedCacheRecord[]> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const parsed = cacheFileSchema.parse(JSON.parse(source));

      return parsed.records as unknown as NormalizedCacheRecord[];
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  async listSourceRecords(sourceId: SourceId): Promise<NormalizedCacheRecord[]> {
    return (await this.load()).filter((record) => record.sourceId === sourceId);
  }

  async getLatestSourceRecord(sourceId: SourceId): Promise<NormalizedCacheRecord | undefined> {
    const records = await this.listSourceRecords(sourceId);

    return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async listLatestRecords(): Promise<NormalizedCacheRecord[]> {
    const records = await this.load();
    const latestBySource = new Map<SourceId, NormalizedCacheRecord>();

    for (const record of records) {
      const current = latestBySource.get(record.sourceId);

      if (!current || current.updatedAt < record.updatedAt) {
        latestBySource.set(record.sourceId, record);
      }
    }

    return [...latestBySource.values()];
  }

  async writeRecord(record: NormalizedCacheRecord): Promise<void> {
    const currentRecords = await this.load();
    const nextRecords = currentRecords.filter(
      (current) =>
        !(current.sourceId === record.sourceId && current.cacheKey === record.cacheKey)
    );

    nextRecords.push(record);
    await this.save(nextRecords);
  }

  async save(records: NormalizedCacheRecord[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const payload = cacheFileSchema.parse({
      version: CACHE_FILE_VERSION,
      records: records.map((record) => ({
        ...record,
        ...(record.derived
          ? {
              derived: {
                version: DERIVED_CACHE_VERSION,
                ...record.derived
              }
            }
          : {})
      }))
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
