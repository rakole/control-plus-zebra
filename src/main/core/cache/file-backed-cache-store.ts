import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type {
  AdapterCapabilityEnvelope,
  AdapterCapabilitySnapshots,
  AdapterNormalizationResult
} from "../adapter-contract/types.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";
import type { RunAuditResult } from "../audit/types.js";
import type { ProjectGitHubSnapshot } from "../github/github-snapshot-provider.js";
import type { ParsedShellCommand } from "../shell/types.js";
import type { VerificationResult } from "../verification/types.js";
import type { ProjectGitSnapshot } from "../git/git-snapshot-provider.js";
import {
  createRawArtifactIndexEntries,
  RAW_ARTIFACT_SCHEMA_VERSION,
  type RawArtifactIndexEntry
} from "../ingestion/raw-artifact-index.js";
import { normalizedResultSchema } from "../ingestion/normalization-validator.js";

const CACHE_FILE_VERSION = 4;
const MONOLITHIC_CACHE_FILE_VERSION = 3;
const SECTION_VERSION = 1;
const DERIVED_CACHE_VERSION = 1;
const LEGACY_CACHE_FILE_VERSION_1 = 1;
const LEGACY_CACHE_FILE_VERSION_2 = 2;
const quarantinedLegacyRecordMarker = Symbol("quarantinedLegacyRecord");

const confidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    normalizedLevel: z.enum(["confirmed", "observed", "inferred", "unknown"]).optional(),
    reason: z.string().optional(),
    evidence: z.array(z.string()).optional()
  })
  .strict();

const normalizedConfidenceSchema = z.enum(["confirmed", "observed", "inferred", "unknown"]);
const legacyDiagnosticConfidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"])
  })
  .passthrough();

const diagnosticSchema = z
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
    relatedEntityIds: z.array(z.string().min(1)).optional(),
    confidence: z.union([normalizedConfidenceSchema, legacyDiagnosticConfidenceSchema]).optional()
  })
  .passthrough();

const groupedHarnessCapabilitiesSchema = z
  .object({
    discovery: z
      .object({
        defaultRoots: z.boolean(),
        projectRootMapping: z.enum(["native", "inferred", "none"]),
        stableProjectId: z.boolean(),
        stableSessionId: z.boolean()
      })
      .strict(),
    replay: z
      .object({
        transcriptReplay: z.boolean(),
        messageRoles: z.boolean(),
        assistantMessages: z.boolean(),
        lifecycleEvents: z.boolean(),
        cancellationEvents: z.boolean(),
        topicEvents: z.boolean(),
        rawEventPointers: z.boolean()
      })
      .strict(),
    tools: z
      .object({
        toolCalls: z.boolean(),
        toolResults: z.boolean(),
        fileReads: z.boolean(),
        fileSearches: z.boolean(),
        fileMutations: z.boolean(),
        diffStats: z.boolean(),
        shellCommands: z.boolean(),
        shellOutputs: z.boolean(),
        sidecarOutputs: z.boolean()
      })
      .strict(),
    usage: z
      .object({
        modelNames: z.boolean(),
        tokenCounts: z.boolean(),
        costEstimates: z.boolean()
      })
      .strict(),
    live: z
      .object({
        activeSessionDetection: z.enum(["mtime", "process", "hook", "native", "none"]),
        watchableArtifacts: z.boolean(),
        incrementalParsing: z.boolean()
      })
      .strict(),
    audit: z
      .object({
        agentClaimDetection: z.boolean(),
        finalAnswerDetection: z.boolean(),
        shellExitCodeEvidence: z.boolean(),
        verificationCommandEvidence: z.boolean()
      })
      .strict(),
    export: z
      .object({
        rawArtifactExport: z.boolean(),
        normalizedExport: z.boolean()
      })
      .strict()
  })
  .strict()
  .passthrough();

const capabilityEnvelopeSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    capabilities: groupedHarnessCapabilitiesSchema
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

const shellCommandsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    sessions: z.array(
      z
        .object({
          sessionId: z.string().min(1),
          shellCommands: z.array(parsedShellCommandSchema)
        })
        .strict()
    )
  })
  .strict();

const verificationResultsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    sessions: z.array(
      z
        .object({
          sessionId: z.string().min(1),
          verification: verificationResultSchema
        })
        .strict()
    )
  })
  .strict();

const runAuditsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    sessions: z.array(
      z
        .object({
          sessionId: z.string().min(1),
          audit: runAuditSchema
        })
        .strict()
    )
  })
  .strict();

const gitSnapshotsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    projects: z.array(
      z
        .object({
          projectId: z.string().min(1),
          git: gitSnapshotSchema
        })
        .strict()
    )
  })
  .strict();

const githubSnapshotsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    projects: z.array(
      z
        .object({
          projectId: z.string().min(1),
          github: githubSnapshotSchema
        })
        .strict()
    )
  })
  .strict();

const diagnosticsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    entries: z.array(diagnosticSchema)
  })
  .strict();

const rawArtifactIndexEntrySchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    nativeRef: z.string().min(1).optional(),
    nativeId: z.string().min(1),
    path: z.string().min(1).optional(),
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
    sizeBytes: z.number().int().nonnegative().optional(),
    byteLength: z.number().int().nonnegative().optional(),
    mtime: z.string().min(1).optional(),
    mtimeMs: z.number().nonnegative().optional(),
    inode: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    parseStrategy: z.enum(["stream-jsonl", "json", "text", "adapter-native", "unknown"]),
    parserVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
    diagnosticsHash: z.string().min(1)
  })
  .strict();

const rawArtifactIndexCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    entries: z.array(rawArtifactIndexEntrySchema)
  })
  .strict();

const capabilitySnapshotsCacheSectionSchema = z
  .object({
    version: z.literal(SECTION_VERSION).default(SECTION_VERSION),
    adapter: capabilityEnvelopeSchema,
    source: capabilityEnvelopeSchema.extend({
      sourceId: z.string().min(1)
    }),
    sessions: z.array(
      capabilityEnvelopeSchema.extend({
        sourceId: z.string().min(1),
        sessionId: z.string().min(1)
      })
    )
  })
  .strict();

const legacyDerivedCacheRecordSchema = z
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

const legacyNormalizedCacheRecordSchema = z
  .object({
    cacheKey: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    artifactFingerprint: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    normalized: normalizedResultSchema,
    derived: legacyDerivedCacheRecordSchema.optional()
  })
  .strict();

const hydratedNormalizedCacheRecordSchema = z
  .object({
    cacheKey: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    artifactFingerprint: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    normalized: normalizedResultSchema,
    shellCommands: shellCommandsCacheSectionSchema,
    verificationResults: verificationResultsCacheSectionSchema,
    runAudits: runAuditsCacheSectionSchema,
    gitSnapshots: gitSnapshotsCacheSectionSchema,
    githubSnapshots: githubSnapshotsCacheSectionSchema,
    diagnostics: diagnosticsCacheSectionSchema,
    rawArtifactIndex: rawArtifactIndexCacheSectionSchema,
    capabilitySnapshots: capabilitySnapshotsCacheSectionSchema
  })
  .strict();

export const normalizedCacheRecordSchema = hydratedNormalizedCacheRecordSchema;

const currentCacheFileSchema = z
  .object({
    version: z.literal(MONOLITHIC_CACHE_FILE_VERSION),
    records: z.array(hydratedNormalizedCacheRecordSchema)
  })
  .strict();

const sectionedCacheIndexRecordSchema = z
  .object({
    cacheKey: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    artifactFingerprint: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    recordPath: z.string().min(1)
  })
  .strict();

const sectionedCacheFileSchema = z
  .object({
    version: z.literal(CACHE_FILE_VERSION),
    records: z.array(sectionedCacheIndexRecordSchema)
  })
  .strict();

const legacyCacheFileSchema = z
  .object({
    version: z.union([z.literal(LEGACY_CACHE_FILE_VERSION_1), z.literal(LEGACY_CACHE_FILE_VERSION_2)]),
    records: z.array(legacyNormalizedCacheRecordSchema)
  })
  .strict();

const legacyCacheFileEnvelopeSchema = z
  .object({
    version: z.union([z.literal(LEGACY_CACHE_FILE_VERSION_1), z.literal(LEGACY_CACHE_FILE_VERSION_2)]),
    records: z.array(z.unknown())
  })
  .passthrough();

export interface NormalizedCacheRecord {
  cacheKey: string;
  adapterId: AdapterId;
  sourceId: SourceId;
  artifactFingerprint: string;
  createdAt: string;
  updatedAt: string;
  normalized: AdapterNormalizationResult;
  shellCommands?: ShellCommandsCacheSection;
  verificationResults?: VerificationResultsCacheSection;
  runAudits?: RunAuditsCacheSection;
  gitSnapshots?: GitSnapshotsCacheSection;
  githubSnapshots?: GitHubSnapshotsCacheSection;
  diagnostics?: DiagnosticsCacheSection;
  rawArtifactIndex?: RawArtifactIndexCacheSection;
  capabilitySnapshots?: CapabilitySnapshotsCacheSection;
  /** @deprecated Transitional alias for legacy readers. Use first-class cache sections instead. */
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

export interface ShellCommandsCacheSection {
  version?: 1;
  sessions: Array<{
    sessionId: string;
    shellCommands: ParsedShellCommand[];
  }>;
}

export interface VerificationResultsCacheSection {
  version?: 1;
  sessions: Array<{
    sessionId: string;
    verification: VerificationResult;
  }>;
}

export interface RunAuditsCacheSection {
  version?: 1;
  sessions: Array<{
    sessionId: string;
    audit: RunAuditResult;
  }>;
}

export interface GitSnapshotsCacheSection {
  version?: 1;
  projects: Array<{
    projectId: string;
    git: ProjectGitSnapshot;
  }>;
}

export interface GitHubSnapshotsCacheSection {
  version?: 1;
  projects: Array<{
    projectId: string;
    github: ProjectGitHubSnapshot;
  }>;
}

export interface DiagnosticsCacheSection {
  version?: 1;
  entries: Diagnostic[];
}

export interface RawArtifactIndexCacheSection {
  version?: 1;
  entries: RawArtifactIndexEntry[];
}

export interface CapabilitySnapshotsCacheSection {
  version?: 1;
  adapter: AdapterCapabilityEnvelope;
  source: AdapterCapabilityEnvelope;
  sessions: Array<AdapterCapabilityEnvelope & { sessionId: string }>;
}

export interface HydratedNormalizedCacheRecord extends Omit<NormalizedCacheRecord, keyof CacheSections> {
  shellCommands: Required<ShellCommandsCacheSection>;
  verificationResults: Required<VerificationResultsCacheSection>;
  runAudits: Required<RunAuditsCacheSection>;
  gitSnapshots: Required<GitSnapshotsCacheSection>;
  githubSnapshots: Required<GitHubSnapshotsCacheSection>;
  diagnostics: Required<DiagnosticsCacheSection>;
  rawArtifactIndex: Required<RawArtifactIndexCacheSection>;
  capabilitySnapshots: Required<CapabilitySnapshotsCacheSection>;
}

type CacheSections = Pick<
  NormalizedCacheRecord,
  | "shellCommands"
  | "verificationResults"
  | "runAudits"
  | "gitSnapshots"
  | "githubSnapshots"
  | "diagnostics"
  | "rawArtifactIndex"
  | "capabilitySnapshots"
>;

type SectionedCacheFile = z.infer<typeof sectionedCacheFileSchema>;
type SectionedCacheIndexRecord = z.infer<typeof sectionedCacheIndexRecordSchema>;

export class FileBackedCacheStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<NormalizedCacheRecord[]> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const payload = JSON.parse(source);
      const sectioned = sectionedCacheFileSchema.safeParse(payload);

      if (sectioned.success) {
        const records = await Promise.all(
          sectioned.data.records.map((entry) => this.#loadSectionRecord(entry))
        );

        return records.map(attachLegacyDerivedCompatibility);
      }

      const parsed = parseCacheFile(payload);

      return parsed.records.map(attachLegacyDerivedCompatibility);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  async listSourceRecords(sourceId: SourceId): Promise<NormalizedCacheRecord[]> {
    const index = await this.#loadSectionedIndex();

    if (index) {
      const records = await Promise.all(
        index.records
          .filter((record) => record.sourceId === sourceId)
          .map((entry) => this.#loadSectionRecord(entry))
      );

      return records.map(attachLegacyDerivedCompatibility);
    }

    return (await this.load()).filter((record) => record.sourceId === sourceId);
  }

  async getLatestSourceRecord(sourceId: SourceId): Promise<NormalizedCacheRecord | undefined> {
    const index = await this.#loadSectionedIndex();

    if (index) {
      const latest = [...index.records]
        .filter((record) => record.sourceId === sourceId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

      return latest
        ? attachLegacyDerivedCompatibility(await this.#loadSectionRecord(latest))
        : undefined;
    }

    const records = await this.listSourceRecords(sourceId);

    return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async listLatestRecords(): Promise<NormalizedCacheRecord[]> {
    const index = await this.#loadSectionedIndex();

    if (index) {
      const latestBySource = new Map<SourceId, SectionedCacheIndexRecord>();

      for (const record of index.records) {
        const current = latestBySource.get(record.sourceId);

        if (!current || current.updatedAt < record.updatedAt) {
          latestBySource.set(record.sourceId, record);
        }
      }

      const records = await Promise.all(
        [...latestBySource.values()].map((entry) => this.#loadSectionRecord(entry))
      );

      return records.map(attachLegacyDerivedCompatibility);
    }

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
    const currentRecords = await this.listAllRecordsForReplacement();
    const nextRecords: NormalizedCacheRecord[] = currentRecords.filter(
      (current) =>
        !(current.sourceId === record.sourceId && current.cacheKey === record.cacheKey)
    );

    nextRecords.push(record);
    await this.save(nextRecords);
  }

  async replaceSourceRecords(
    sourceIds: Iterable<SourceId>,
    records: NormalizedCacheRecord[]
  ): Promise<void> {
    const sourceIdSet = new Set(sourceIds);
    const index = await this.#loadSectionedIndex();

    if (!index) {
      const currentRecords = await this.load();
      await this.save([
        ...currentRecords.filter((record) => !sourceIdSet.has(record.sourceId)),
        ...records
      ]);
      return;
    }

    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await mkdir(this.#sectionRootPath(), { recursive: true });
    const nextIndexRecords = [
      ...index.records.filter((record) => !sourceIdSet.has(record.sourceId)),
      ...(await Promise.all(records.map((record) => this.#writeSectionRecord(record))))
    ];

    await this.#writeSectionedIndex(nextIndexRecords);
  }

  async save(records: NormalizedCacheRecord[]): Promise<void> {
    const quarantinedRecords = records.filter(isQuarantinedLegacyRecord);

    if (quarantinedRecords.length > 0) {
      throw new Error(
        "Cannot safely persist normalized cache while legacy records are quarantined. Rescan or replace the affected source records before writing the cache."
      );
    }

    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await mkdir(this.#sectionRootPath(), { recursive: true });

    const indexRecords: SectionedCacheIndexRecord[] = [];

    for (const record of records) {
      indexRecords.push(await this.#writeSectionRecord(record));
    }

    await this.#writeSectionedIndex(indexRecords);
  }

  async #writeSectionRecord(record: NormalizedCacheRecord): Promise<SectionedCacheIndexRecord> {
    const hydrated = toHydratedRecord(record);
    const recordPath = this.#sectionRelativePath(hydrated);
    const absoluteRecordPath = path.join(path.dirname(this.#filePath), recordPath);

    await mkdir(path.dirname(absoluteRecordPath), { recursive: true });
    await writeFile(
      absoluteRecordPath,
      `${JSON.stringify(hydratedNormalizedCacheRecordSchema.parse(hydrated))}\n`,
      "utf8"
    );

    return {
      cacheKey: hydrated.cacheKey,
      adapterId: hydrated.adapterId,
      sourceId: hydrated.sourceId,
      artifactFingerprint: hydrated.artifactFingerprint,
      createdAt: hydrated.createdAt,
      updatedAt: hydrated.updatedAt,
      recordPath
    };
  }

  async #writeSectionedIndex(indexRecords: SectionedCacheIndexRecord[]): Promise<void> {
    const payload = sectionedCacheFileSchema.parse({
      version: CACHE_FILE_VERSION,
      records: indexRecords
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private async listAllRecordsForReplacement(): Promise<NormalizedCacheRecord[]> {
    return this.load();
  }

  async #loadSectionedIndex(): Promise<SectionedCacheFile | undefined> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const parsed = sectionedCacheFileSchema.safeParse(JSON.parse(source));

      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          version: CACHE_FILE_VERSION,
          records: []
        };
      }

      throw error;
    }
  }

  async #loadSectionRecord(
    entry: SectionedCacheIndexRecord
  ): Promise<HydratedNormalizedCacheRecord> {
    const source = await readFile(
      path.join(path.dirname(this.#filePath), entry.recordPath),
      "utf8"
    );

    return hydratedNormalizedCacheRecordSchema.parse(
      JSON.parse(source)
    ) as unknown as HydratedNormalizedCacheRecord;
  }

  #sectionRootPath(): string {
    return path.join(
      path.dirname(this.#filePath),
      `${path.basename(this.#filePath, path.extname(this.#filePath))}.sections`
    );
  }

  #sectionRelativePath(record: HydratedNormalizedCacheRecord): string {
    const sectionRootName = path.basename(this.#sectionRootPath());
    const fingerprint = createHash("sha256")
      .update(`${record.sourceId}\0${record.cacheKey}`)
      .digest("hex")
      .slice(0, 32);

    return path.join(sectionRootName, `${fingerprint}.json`);
  }
}

function parseCacheFile(payload: unknown): {
  version: 3 | 4;
  records: HydratedNormalizedCacheRecord[];
} {
  const current = currentCacheFileSchema.safeParse(payload);

  if (current.success) {
    return current.data as unknown as { version: 3; records: HydratedNormalizedCacheRecord[] };
  }

  const legacy = legacyCacheFileSchema.safeParse(payload);

  if (legacy.success) {
    return {
      version: CACHE_FILE_VERSION,
      records: legacy.data.records.map((record) => toHydratedRecord(record as unknown as NormalizedCacheRecord))
    };
  }

  const legacyEnvelope = legacyCacheFileEnvelopeSchema.safeParse(payload);

  if (legacyEnvelope.success) {
    return {
      version: CACHE_FILE_VERSION,
      records: legacyEnvelope.data.records.map((record, index) => {
        const migrated = migrateLegacyCacheRecord(record, index);
        const hydrated = toHydratedRecord(migrated);

        return isQuarantinedLegacyRecord(migrated)
          ? markQuarantinedLegacyRecord(hydrated)
          : hydrated;
      })
    };
  }

  throw current.error;
}

function migrateLegacyCacheRecord(record: unknown, index: number): NormalizedCacheRecord {
  try {
    return migrateLegacyCacheRecordShape(record, index);
  } catch (error) {
    return buildQuarantinedLegacyRecord(record, index, error);
  }
}

function migrateLegacyCacheRecordShape(record: unknown, index: number): NormalizedCacheRecord {
  const rawRecord = expectRecord(record, `records.${index}`);
  const rawNormalized = expectRecord(rawRecord.normalized, `records.${index}.normalized`);
  const adapterId = readString(rawRecord.adapterId) ?? readString(rawNormalized.adapterId);
  const sourceId = readString(rawRecord.sourceId) ?? readString(rawNormalized.sourceId);

  if (!adapterId || !sourceId) {
    throw new Error("Legacy cache record is missing adapterId/sourceId.");
  }

  const diagnostics = readArray(rawNormalized.diagnostics).filter(isDiagnostic);
  const capabilities = migrateLegacyCapabilitySnapshots(rawNormalized.capabilities, {
    adapterId,
    sourceId,
    sessions: readArray(rawNormalized.sessions)
      .map((session) => readString(asRecord(session)?.id))
      .filter((sessionId): sessionId is string => Boolean(sessionId))
  });
  const projects = readArray(rawNormalized.projects).map((project) =>
    migrateLegacyProject(project, { adapterId, sourceId, sessions: readArray(rawNormalized.sessions), diagnostics })
  );
  const sessions = readArray(rawNormalized.sessions).map((session) =>
    migrateLegacySession(session, {
      adapterId,
      sourceId,
      capabilities,
      diagnostics,
      fileMutations: readArray(rawNormalized.fileMutations),
      messages: readArray(rawNormalized.messages),
      outputArtifacts: readArray(rawNormalized.outputArtifacts),
      shellCommands: readArray(rawNormalized.shellCommands),
      toolCalls: readArray(rawNormalized.toolCalls),
      events: readArray(rawNormalized.events)
    })
  );
  const events = readArray(rawNormalized.events).map((event) =>
    migrateLegacyEvent(event, { adapterId, sourceId })
  );
  const messages = readArray(rawNormalized.messages).map((message) =>
    migrateLegacyMessage(message, { adapterId, sourceId })
  );
  const toolCalls = readArray(rawNormalized.toolCalls).map((toolCall) =>
    migrateLegacyToolCall(toolCall, { adapterId, sourceId })
  );
  const shellCommands = readArray(rawNormalized.shellCommands).map((shellCommand) =>
    migrateLegacyShellCommand(shellCommand, { adapterId, sourceId })
  );
  const outputArtifacts = readArray(rawNormalized.outputArtifacts).map((artifact) =>
    migrateLegacyOutputArtifact(artifact, { adapterId, sourceId })
  );
  const fileMutations = readArray(rawNormalized.fileMutations).map((mutation) =>
    migrateLegacyFileMutation(mutation, { adapterId, sourceId })
  );
  const migratedDerived = migrateLegacyDerived(rawRecord.derived, {
    adapterId,
    cacheKey: readString(rawRecord.cacheKey) ?? `legacy-record-${index + 1}`,
    sourceId
  });
  const migrationDiagnostic = buildLegacyCacheDiagnostic({
    adapterId,
    code: "cache.legacy-record-migrated",
    message:
      "Loaded a legacy normalized cache record and migrated it to the current cache contract. Rescan the source to refresh durable cache sections.",
    nativeId: readString(rawRecord.cacheKey) ?? `legacy-record-${index + 1}`,
    relatedEntityIds: sessions.map((session) => session.id),
    severity: "warning",
    sourceId
  });
  const normalized = {
    adapterId,
    sourceId,
    capabilities,
    projects,
    sessions,
    events,
    messages,
    toolCalls,
    shellCommands,
    outputArtifacts,
    fileMutations,
    diagnostics: [...diagnostics, migrationDiagnostic, ...migratedDerived.diagnostics]
  } as unknown as AdapterNormalizationResult;

  return {
    cacheKey: readString(rawRecord.cacheKey) ?? `legacy-cache-${index + 1}`,
    adapterId,
    sourceId,
    artifactFingerprint:
      readString(rawRecord.artifactFingerprint) ?? `legacy-cache-${index + 1}`,
    createdAt: readString(rawRecord.createdAt) ?? readString(rawRecord.updatedAt) ?? new Date(0).toISOString(),
    updatedAt: readString(rawRecord.updatedAt) ?? readString(rawRecord.createdAt) ?? new Date(0).toISOString(),
    normalized,
    ...(migratedDerived.derived ? { derived: migratedDerived.derived } : {})
  };
}

function buildQuarantinedLegacyRecord(
  record: unknown,
  index: number,
  error: unknown
): NormalizedCacheRecord {
  const rawRecord = asRecord(record);
  const rawNormalized = asRecord(rawRecord?.normalized);
  const adapterId =
    readString(rawRecord?.adapterId) ?? readString(rawNormalized?.adapterId) ?? "unknown-adapter";
  const sourceId =
    readString(rawRecord?.sourceId) ??
    readString(rawNormalized?.sourceId) ??
    `legacy-cache-source-${index + 1}`;
  const diagnostic = buildLegacyCacheDiagnostic({
    adapterId,
    code: "cache.legacy-record-quarantined",
    message: `A legacy normalized cache record could not be migrated and was quarantined: ${errorToMessage(error)}`,
    nativeId: readString(rawRecord?.cacheKey) ?? `legacy-record-${index + 1}`,
    severity: "error",
    sourceId
  });
  const capabilities = buildUnknownCapabilitySnapshots(adapterId, sourceId, []);

  return {
    cacheKey: readString(rawRecord?.cacheKey) ?? `legacy-cache-quarantined-${index + 1}`,
    adapterId,
    sourceId,
    artifactFingerprint:
      readString(rawRecord?.artifactFingerprint) ?? `legacy-cache-quarantined-${index + 1}`,
    createdAt: readString(rawRecord?.createdAt) ?? readString(rawRecord?.updatedAt) ?? new Date(0).toISOString(),
    updatedAt: readString(rawRecord?.updatedAt) ?? readString(rawRecord?.createdAt) ?? new Date(0).toISOString(),
    normalized: {
      adapterId,
      sourceId,
      capabilities,
      projects: [],
      sessions: [],
      events: [],
      messages: [],
      toolCalls: [],
      shellCommands: [],
      outputArtifacts: [],
      fileMutations: [],
      diagnostics: [diagnostic]
    },
    [quarantinedLegacyRecordMarker]: true
  } as NormalizedCacheRecord;
}

function migrateLegacyCapabilitySnapshots(
  snapshots: unknown,
  context: { adapterId: string; sourceId: string; sessions: string[] }
): AdapterCapabilitySnapshots {
  const rawSnapshots = asRecord(snapshots);
  const adapterCapabilities = migrateLegacyCapabilities(
    asRecord(asRecord(rawSnapshots?.adapter)?.capabilities) ?? rawSnapshots?.adapter
  );
  const sourceCapabilities = migrateLegacyCapabilities(
    asRecord(asRecord(rawSnapshots?.source)?.capabilities) ?? rawSnapshots?.source ?? rawSnapshots?.adapter
  );
  const sessionSnapshots = readArray(rawSnapshots?.sessions);

  return {
    adapter: {
      adapterId: context.adapterId,
      capabilities: adapterCapabilities
    },
    source: {
      adapterId: context.adapterId,
      sourceId: context.sourceId,
      capabilities: sourceCapabilities
    },
    sessions: context.sessions.map((sessionId) => {
      const sessionSnapshot = sessionSnapshots.find(
        (snapshot) => readString(asRecord(snapshot)?.sessionId) === sessionId
      );

      return {
        adapterId: context.adapterId,
        sourceId: context.sourceId,
        sessionId,
        capabilities: migrateLegacyCapabilities(
          asRecord(asRecord(sessionSnapshot)?.capabilities) ?? sourceCapabilities
        )
      };
    })
  };
}

function migrateLegacyCapabilities(capabilities: unknown): AdapterCapabilityEnvelope["capabilities"] {
  const grouped = groupedHarnessCapabilitiesSchema.safeParse(capabilities);

  if (grouped.success) {
    return grouped.data as AdapterCapabilityEnvelope["capabilities"];
  }

  const legacy = asRecord(capabilities);

  return {
    discovery: {
      defaultRoots: legacyCapabilitySupported(legacy, "sessionDiscovery") || legacyCapabilitySupported(legacy, "sourceValidation"),
      projectRootMapping: legacyCapabilitySupported(legacy, "sessionDiscovery") ? "native" : "none",
      stableProjectId: legacyCapabilitySupported(legacy, "sessionDiscovery"),
      stableSessionId: legacyCapabilitySupported(legacy, "sessionDiscovery")
    },
    replay: {
      transcriptReplay: legacyCapabilitySupported(legacy, "eventStreaming") || legacyCapabilitySupported(legacy, "messageCapture"),
      messageRoles: legacyCapabilitySupported(legacy, "messageCapture"),
      assistantMessages: legacyCapabilitySupported(legacy, "messageCapture"),
      lifecycleEvents: legacyCapabilitySupported(legacy, "eventStreaming"),
      cancellationEvents: legacyCapabilitySupported(legacy, "eventStreaming"),
      topicEvents: false,
      rawEventPointers: legacyCapabilitySupported(legacy, "eventStreaming")
    },
    tools: {
      toolCalls: legacyCapabilitySupported(legacy, "toolCallCapture"),
      toolResults: legacyCapabilitySupported(legacy, "toolCallCapture"),
      fileReads: false,
      fileSearches: false,
      fileMutations: legacyCapabilitySupported(legacy, "fileMutationCapture"),
      diffStats: false,
      shellCommands: legacyCapabilitySupported(legacy, "shellCommandCapture"),
      shellOutputs: legacyCapabilitySupported(legacy, "shellCommandCapture"),
      sidecarOutputs: legacyCapabilitySupported(legacy, "outputArtifactCapture")
    },
    usage: {
      modelNames: false,
      tokenCounts: false,
      costEstimates: false
    },
    live: {
      activeSessionDetection: legacyCapabilitySupported(legacy, "liveSessionObservation") ? "mtime" : "none",
      watchableArtifacts: legacyCapabilitySupported(legacy, "watchPlans"),
      incrementalParsing: false
    },
    audit: {
      agentClaimDetection: legacyCapabilitySupported(legacy, "verificationSignals"),
      finalAnswerDetection: legacyCapabilitySupported(legacy, "verificationSignals"),
      shellExitCodeEvidence: legacyCapabilitySupported(legacy, "shellCommandCapture"),
      verificationCommandEvidence: legacyCapabilitySupported(legacy, "verificationSignals")
    },
    export: {
      rawArtifactExport: legacyCapabilitySupported(legacy, "outputArtifactCapture"),
      normalizedExport: true
    }
  };
}

function legacyCapabilitySupported(
  capabilities: Record<string, unknown> | undefined,
  key: string
): boolean {
  const value = asRecord(capabilities?.[key]);

  return value?.status === "supported";
}

function migrateLegacyProject(
  project: unknown,
  context: {
    adapterId: string;
    diagnostics: Diagnostic[];
    sessions: unknown[];
    sourceId: string;
  }
) {
  const rawProject = expectRecord(project, "legacy project");
  const id = readString(rawProject.id) ?? readString(rawProject.nativeId);

  if (!id) {
    throw new Error("Legacy project is missing id.");
  }

  const sourceId = readString(rawProject.sourceId) ?? context.sourceId;
  const adapterId = readString(rawProject.adapterId) ?? context.adapterId;
  const rootConfidence = normalizeLegacyConfidence(rawProject.rootConfidence ?? rawProject.confidence);
  const sessionIds = context.sessions
    .filter((session) => readString(asRecord(session)?.projectId) === id)
    .map((session) => readString(asRecord(session)?.id))
    .filter((sessionId): sessionId is string => Boolean(sessionId));

  return {
    ...rawProject,
    id,
    displayName: readString(rawProject.displayName) ?? readString(rawProject.name) ?? id,
    ...(readString(rawProject.primaryRootPath) ?? readString(rawProject.rootPath)
      ? { primaryRootPath: readString(rawProject.primaryRootPath) ?? readString(rawProject.rootPath) }
      : {}),
    rootConfidence,
    harnessRefs:
      readArray(rawProject.harnessRefs).length > 0
        ? readArray(rawProject.harnessRefs)
        : [
            {
              adapterId,
              sourceId,
              ...(readString(rawProject.nativeProjectId) ?? readString(rawProject.nativeId)
                ? { nativeProjectId: readString(rawProject.nativeProjectId) ?? readString(rawProject.nativeId) }
                : {}),
              ...(readString(rawProject.nativeProjectPath) ?? readString(rawProject.rootPath)
                ? { nativeProjectPath: readString(rawProject.nativeProjectPath) ?? readString(rawProject.rootPath) }
                : {}),
              ...(readString(rawProject.projectRootPath) ?? readString(rawProject.rootPath)
                ? { projectRootPath: readString(rawProject.projectRootPath) ?? readString(rawProject.rootPath) }
                : {}),
              projectRootConfidence: rootConfidence,
              rawArtifactRefs: readArray(rawProject.rawArtifactRefs)
            }
          ],
    sessionIds: readStringArray(rawProject.sessionIds).length > 0 ? readStringArray(rawProject.sessionIds) : sessionIds,
    diagnostics: diagnosticsForEntity(context.diagnostics, id, sourceId)
  };
}

function migrateLegacySession(
  session: unknown,
  context: {
    adapterId: string;
    capabilities: AdapterCapabilitySnapshots;
    diagnostics: Diagnostic[];
    events: unknown[];
    fileMutations: unknown[];
    messages: unknown[];
    outputArtifacts: unknown[];
    shellCommands: unknown[];
    sourceId: string;
    toolCalls: unknown[];
  }
) {
  const rawSession = expectRecord(session, "legacy session");
  const id = readString(rawSession.id) ?? readString(rawSession.nativeId);

  if (!id) {
    throw new Error("Legacy session is missing id.");
  }

  const sourceId = readString(rawSession.sourceId) ?? context.sourceId;
  const adapterId = readString(rawSession.adapterId) ?? context.adapterId;
  const sessionCapabilities =
    context.capabilities.sessions.find((snapshot) => snapshot.sessionId === id)?.capabilities ??
    context.capabilities.source.capabilities;

  return {
    ...rawSession,
    id,
    adapterId,
    sourceId,
    ...(readString(rawSession.nativeSessionId) ?? readString(rawSession.nativeId)
      ? { nativeSessionId: readString(rawSession.nativeSessionId) ?? readString(rawSession.nativeId) }
      : {}),
    lifecycleStatus: normalizeLifecycleStatus(rawSession.lifecycleStatus ?? rawSession.lifecycleState),
    ...(readString(rawSession.lastUpdatedAt) ?? readString(rawSession.endedAt) ?? readString(rawSession.startedAt)
      ? {
          lastUpdatedAt:
            readString(rawSession.lastUpdatedAt) ??
            readString(rawSession.endedAt) ??
            readString(rawSession.startedAt)
        }
      : {}),
    capabilities: migrateLegacyCapabilities(rawSession.capabilities ?? sessionCapabilities),
    parseConfidence: normalizeLegacyConfidence(rawSession.parseConfidence ?? rawSession.confidence),
    messageIds: idsForSession(context.messages, id),
    eventIds: idsForSession(context.events, id),
    toolCallIds: idsForSession(context.toolCalls, id),
    fileMutationIds: idsForSession(context.fileMutations, id),
    shellCommandIds: idsForSession(context.shellCommands, id),
    outputArtifactIds: idsForSession(context.outputArtifacts, id),
    usage: asRecord(rawSession.usage) ?? {},
    rawArtifactRefs: readArray(rawSession.rawArtifactRefs),
    diagnostics: diagnosticsForEntity(context.diagnostics, id, sourceId)
  };
}

function migrateLegacyEvent(event: unknown, context: { adapterId: string; sourceId: string }) {
  const rawEvent = expectRecord(event, "legacy event");
  const id = readString(rawEvent.id) ?? readString(rawEvent.nativeId);

  if (!id) {
    throw new Error("Legacy event is missing id.");
  }

  return {
    ...rawEvent,
    id,
    sessionId: readRequiredString(rawEvent.sessionId, "Legacy event is missing sessionId."),
    adapterId: readString(rawEvent.adapterId) ?? context.adapterId,
    kind: normalizeEventKind(rawEvent.eventKind ?? rawEvent.kind),
    orderKey:
      readString(rawEvent.orderKey) ??
      `${String(readNumber(rawEvent.ordinal) ?? 0).padStart(6, "0")}:${readString(rawEvent.nativeId) ?? id}`,
    ...(readString(rawEvent.summary) && !readString(rawEvent.text)
      ? { text: readString(rawEvent.summary) }
      : {}),
    raw: toLegacyRawPointer(rawEvent, id),
    diagnostics: readArray(rawEvent.diagnostics).filter(isDiagnostic)
  };
}

function migrateLegacyMessage(message: unknown, context: { adapterId: string; sourceId: string }) {
  const rawMessage = expectRecord(message, "legacy message");
  const id = readString(rawMessage.id) ?? readString(rawMessage.nativeId);

  if (!id) {
    throw new Error("Legacy message is missing id.");
  }

  return {
    ...rawMessage,
    id,
    sessionId: readRequiredString(rawMessage.sessionId, "Legacy message is missing sessionId."),
    adapterId: readString(rawMessage.adapterId) ?? context.adapterId,
    role: normalizeMessageRole(rawMessage.role),
    text: readString(rawMessage.text) ?? readString(rawMessage.content),
    toolCallIds: readStringArray(rawMessage.toolCallIds),
    eventIds: readStringArray(rawMessage.eventIds).length > 0
      ? readStringArray(rawMessage.eventIds)
      : readString(rawMessage.eventId)
        ? [readString(rawMessage.eventId) as string]
        : [],
    source: asRecord(rawMessage.source) ?? toLegacyRawPointer(rawMessage, id),
    confidence: normalizeLegacyConfidence(rawMessage.confidence)
  };
}

function migrateLegacyToolCall(toolCall: unknown, context: { adapterId: string; sourceId: string }) {
  const rawToolCall = expectRecord(toolCall, "legacy tool call");
  const id = readString(rawToolCall.id) ?? readString(rawToolCall.nativeId);
  const name = readString(rawToolCall.name) ?? readString(rawToolCall.toolName);

  if (!id || !name) {
    throw new Error("Legacy tool call is missing id/name.");
  }

  return {
    ...rawToolCall,
    id,
    sessionId: readRequiredString(rawToolCall.sessionId, "Legacy tool call is missing sessionId."),
    adapterId: readString(rawToolCall.adapterId) ?? context.adapterId,
    nativeToolCallId: readString(rawToolCall.nativeToolCallId) ?? readString(rawToolCall.nativeId) ?? id,
    name,
    normalizedKind: normalizeToolKind(name),
    statusRaw: readString(rawToolCall.statusRaw) ?? readString(rawToolCall.status),
    statusNormalized: normalizeToolStatus(rawToolCall.statusNormalized ?? rawToolCall.status),
    argsPreview: readString(rawToolCall.argsPreview) ?? readString(rawToolCall.inputSummary),
    resultPreview: readString(rawToolCall.resultPreview) ?? readString(rawToolCall.outputSummary),
    outputArtifactIds: readStringArray(rawToolCall.outputArtifactIds).length > 0
      ? readStringArray(rawToolCall.outputArtifactIds)
      : readStringArray(rawToolCall.artifactIds),
    source: asRecord(rawToolCall.source) ?? toLegacyRawPointer(rawToolCall, id),
    confidence: normalizeLegacyConfidence(rawToolCall.confidence),
    diagnostics: readArray(rawToolCall.diagnostics).filter(isDiagnostic)
  };
}

function migrateLegacyShellCommand(
  shellCommand: unknown,
  context: { adapterId: string; sourceId: string }
) {
  const rawShellCommand = expectRecord(shellCommand, "legacy shell command");
  const id = readString(rawShellCommand.id) ?? readString(rawShellCommand.nativeId);

  if (!id) {
    throw new Error("Legacy shell command is missing id.");
  }

  return {
    ...rawShellCommand,
    id,
    sessionId: readRequiredString(rawShellCommand.sessionId, "Legacy shell command is missing sessionId."),
    adapterId: readString(rawShellCommand.adapterId) ?? context.adapterId,
    outputInline: readString(rawShellCommand.outputInline) ?? readString(rawShellCommand.outputSummary),
    outputArtifactIds: readStringArray(rawShellCommand.outputArtifactIds).length > 0
      ? readStringArray(rawShellCommand.outputArtifactIds)
      : readStringArray(rawShellCommand.artifactIds),
    rawStatus: readString(rawShellCommand.rawStatus) ?? readString(rawShellCommand.rawToolStatus),
    source: asRecord(rawShellCommand.source) ?? toLegacyRawPointer(rawShellCommand, id),
    confidence: normalizeLegacyConfidence(rawShellCommand.confidence)
  };
}

function migrateLegacyOutputArtifact(
  artifact: unknown,
  context: { adapterId: string; sourceId: string }
) {
  const rawArtifact = expectRecord(artifact, "legacy output artifact");
  const id = readString(rawArtifact.id) ?? readString(rawArtifact.nativeId);

  if (!id) {
    throw new Error("Legacy output artifact is missing id.");
  }

  const contentKind = normalizeOutputArtifactContentKind(rawArtifact.contentKind ?? rawArtifact.artifactKind);

  return {
    ...rawArtifact,
    id,
    adapterId: readString(rawArtifact.adapterId) ?? context.adapterId,
    sourceId: readString(rawArtifact.sourceId) ?? context.sourceId,
    nativeRef: readString(rawArtifact.nativeRef) ?? readString(rawArtifact.path) ?? readString(rawArtifact.nativeId),
    kind: normalizeOutputArtifactKind(rawArtifact.artifactKind ?? rawArtifact.kind),
    contentKind,
    ...(readNumber(rawArtifact.sizeBytes) ?? readNumber(rawArtifact.byteLength)
      ? { sizeBytes: readNumber(rawArtifact.sizeBytes) ?? readNumber(rawArtifact.byteLength) }
      : {}),
    loaded: rawArtifact.loaded === true,
    source: asRecord(rawArtifact.source) ?? toLegacyRawPointer(rawArtifact, id),
    diagnostics: readArray(rawArtifact.diagnostics).filter(isDiagnostic)
  };
}

function migrateLegacyFileMutation(
  mutation: unknown,
  context: { adapterId: string; sourceId: string }
) {
  const rawMutation = expectRecord(mutation, "legacy file mutation");
  const id = readString(rawMutation.id) ?? readString(rawMutation.nativeId);

  if (!id) {
    throw new Error("Legacy file mutation is missing id.");
  }

  return {
    ...rawMutation,
    id,
    sessionId: readRequiredString(rawMutation.sessionId, "Legacy file mutation is missing sessionId."),
    adapterId: readString(rawMutation.adapterId) ?? context.adapterId,
    path: readRequiredString(rawMutation.path, "Legacy file mutation is missing path."),
    mutationKind: normalizeFileMutationKind(rawMutation.mutationKind),
    source: asRecord(rawMutation.source) ?? toLegacyRawPointer(rawMutation, id),
    confidence: normalizeLegacyConfidence(rawMutation.confidence),
    diagnostics: readArray(rawMutation.diagnostics).filter(isDiagnostic)
  };
}

function migrateLegacyDerived(
  derived: unknown,
  context: { adapterId: string; cacheKey: string; sourceId: string }
): { derived?: DerivedCacheRecord; diagnostics: Diagnostic[] } {
  if (derived === undefined) {
    return { diagnostics: [] };
  }

  const parsed = legacyDerivedCacheRecordSchema.safeParse(derived);

  if (parsed.success) {
    return { derived: parsed.data as DerivedCacheRecord, diagnostics: [] };
  }

  return {
    diagnostics: [
      buildLegacyCacheDiagnostic({
        adapterId: context.adapterId,
        code: "cache.legacy-derived-dropped",
        message:
          "A legacy derived cache section could not be migrated, so shell, verification, audit, git, or GitHub cached summaries may be unavailable until the source is rescanned.",
        nativeId: context.cacheKey,
        severity: "warning",
        sourceId: context.sourceId
      })
    ]
  };
}

function buildUnknownCapabilitySnapshots(
  adapterId: string,
  sourceId: string,
  sessions: string[]
): AdapterCapabilitySnapshots {
  const capabilities = migrateLegacyCapabilities(undefined);

  return {
    adapter: {
      adapterId,
      capabilities
    },
    source: {
      adapterId,
      sourceId,
      capabilities
    },
    sessions: sessions.map((sessionId) => ({
      adapterId,
      sourceId,
      sessionId,
      capabilities
    }))
  };
}

function idsForSession(items: unknown[], sessionId: string): string[] {
  return items
    .filter((item) => readString(asRecord(item)?.sessionId) === sessionId)
    .map((item) => readString(asRecord(item)?.id))
    .filter((id): id is string => Boolean(id));
}

function diagnosticsForEntity(
  diagnostics: Diagnostic[],
  entityId: string,
  sourceId: string
): Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.relatedEntityIds?.includes(entityId) ||
      ((diagnostic.scope === "adapter" || diagnostic.scope === "source") &&
        diagnostic.sourceId === sourceId)
  );
}

function buildLegacyCacheDiagnostic(input: {
  adapterId: string;
  code: string;
  message: string;
  nativeId: string;
  relatedEntityIds?: string[];
  severity: "error" | "info" | "warning";
  sourceId: string;
}): Diagnostic {
  return {
    id: `${input.code}:${input.sourceId}:${input.nativeId}`,
    code: input.code,
    message: input.message,
    severity: input.severity,
    scope: "source",
    adapterId: input.adapterId,
    sourceId: input.sourceId,
    ...(input.relatedEntityIds && input.relatedEntityIds.length > 0
      ? { relatedEntityIds: input.relatedEntityIds }
      : {}),
    confidence: {
      level: "medium",
      normalizedLevel: "observed",
      reason: "Legacy cache compatibility migration"
    }
  };
}

function normalizeLegacyConfidence(value: unknown): "confirmed" | "inferred" | "observed" | "unknown" {
  if (
    value === "confirmed" ||
    value === "observed" ||
    value === "inferred" ||
    value === "unknown"
  ) {
    return value;
  }

  const level = asRecord(value)?.level;

  switch (level) {
    case "high":
      return "confirmed";
    case "medium":
      return "observed";
    case "low":
      return "inferred";
    default:
      return "unknown";
  }
}

function normalizeLifecycleStatus(value: unknown): "active" | "cancelled" | "completed" | "unknown" {
  switch (value) {
    case "active":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "unknown";
  }
}

function normalizeEventKind(value: unknown) {
  switch (value) {
    case "message":
    case "tool-call":
    case "tool-result":
    case "shell-command":
    case "file-event":
    case "lifecycle":
    case "metadata":
    case "topic":
    case "raw-unknown":
      return value;
    case "output-artifact":
      return "metadata";
    default:
      return "raw-unknown";
  }
}

function normalizeMessageRole(value: unknown) {
  switch (value) {
    case "assistant":
    case "system":
    case "tool":
    case "user":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function normalizeToolKind(name: string) {
  switch (name) {
    case "read_file":
      return "read";
    case "grep":
    case "glob":
    case "search_file":
      return "search";
    case "create_file":
    case "write_file":
      return "write";
    case "edit_file":
    case "replace":
      return "replace";
    case "run_shell_command":
      return "shell";
    case "update_topic":
      return "topic";
    case "web_fetch":
      return "network";
    case "mcp":
      return "mcp";
    default:
      return "unknown";
  }
}

function normalizeToolStatus(value: unknown) {
  switch (value) {
    case "started":
    case "pending":
    case "running":
      return "pending";
    case "completed":
    case "success":
    case "succeeded":
      return "completed";
    case "cancelled":
    case "error":
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

function normalizeOutputArtifactKind(value: unknown) {
  switch (value) {
    case "sidecar":
    case "inline-large-output":
    case "raw-log":
    case "screenshot":
    case "unknown":
      return value;
    case "json":
    case "text":
      return "sidecar";
    default:
      return "unknown";
  }
}

function normalizeOutputArtifactContentKind(value: unknown) {
  switch (value) {
    case "plain-text":
    case "json-output-wrapper":
    case "json":
    case "binary":
    case "unknown":
      return value;
    case "text":
      return "plain-text";
    default:
      return "unknown";
  }
}

function normalizeFileMutationKind(value: unknown) {
  switch (value) {
    case "created":
    case "updated":
    case "deleted":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function toLegacyRawPointer(entity: Record<string, unknown>, fallbackId: string) {
  return {
    nativeId: readString(entity.nativeId) ?? fallbackId,
    pointer: readString(entity.eventId) ?? readString(entity.ordinal) ?? fallbackId,
    ...(readString(entity.path) ? { path: readString(entity.path) } : {})
  };
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return diagnosticSchema.safeParse(value).success;
}

function readRequiredString(value: unknown, message: string): string {
  const result = readString(value);

  if (!result) {
    throw new Error(message);
  }

  return result;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);

  if (!record) {
    throw new Error(`${label} must be an object.`);
  }

  return record;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQuarantinedLegacyRecord(record: NormalizedCacheRecord): boolean {
  return Boolean(
    (record as NormalizedCacheRecord & { [quarantinedLegacyRecordMarker]?: true })[
      quarantinedLegacyRecordMarker
    ]
  );
}

function markQuarantinedLegacyRecord<TRecord extends NormalizedCacheRecord>(
  record: TRecord
): TRecord {
  return Object.assign(record, { [quarantinedLegacyRecordMarker]: true });
}

function toHydratedRecord(record: NormalizedCacheRecord): HydratedNormalizedCacheRecord {
  const hydrated = hydratedNormalizedCacheRecordSchema.parse({
    cacheKey: record.cacheKey,
    adapterId: record.adapterId,
    sourceId: record.sourceId,
    artifactFingerprint: record.artifactFingerprint,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    normalized: record.normalized,
    shellCommands: toShellCommandsSection(record),
    verificationResults: toVerificationResultsSection(record),
    runAudits: toRunAuditsSection(record),
    gitSnapshots: toGitSnapshotsSection(record),
    githubSnapshots: toGitHubSnapshotsSection(record),
    diagnostics: toDiagnosticsSection(record),
    rawArtifactIndex: toRawArtifactIndexSection(record),
    capabilitySnapshots: toCapabilitySnapshotsSection(record)
  });

  return hydrated as unknown as HydratedNormalizedCacheRecord;
}

function toShellCommandsSection(record: NormalizedCacheRecord): Required<ShellCommandsCacheSection> {
  if (record.shellCommands) {
    return {
      version: SECTION_VERSION,
      sessions: record.shellCommands.sessions
    };
  }

  return {
    version: SECTION_VERSION,
    sessions: (record.derived?.sessions ?? []).map((session) => ({
      sessionId: session.sessionId,
      shellCommands: session.shellCommands
    }))
  };
}

function toVerificationResultsSection(
  record: NormalizedCacheRecord
): Required<VerificationResultsCacheSection> {
  if (record.verificationResults) {
    return {
      version: SECTION_VERSION,
      sessions: record.verificationResults.sessions
    };
  }

  const sessions =
    record.derived?.sessions
      ?.filter((session) => session.verification)
      .map((session) => ({
        sessionId: session.sessionId,
        verification: session.verification as VerificationResult
      })) ?? [];

  return {
    version: SECTION_VERSION,
    sessions
  };
}

function toRunAuditsSection(record: NormalizedCacheRecord): Required<RunAuditsCacheSection> {
  if (record.runAudits) {
    return {
      version: SECTION_VERSION,
      sessions: record.runAudits.sessions
    };
  }

  const sessions =
    record.derived?.sessions
      ?.filter((session) => session.audit)
      .map((session) => ({
        sessionId: session.sessionId,
        audit: session.audit as RunAuditResult
      })) ?? [];

  return {
    version: SECTION_VERSION,
    sessions
  };
}

function toGitSnapshotsSection(record: NormalizedCacheRecord): Required<GitSnapshotsCacheSection> {
  if (record.gitSnapshots) {
    return {
      version: SECTION_VERSION,
      projects: record.gitSnapshots.projects
    };
  }

  return {
    version: SECTION_VERSION,
    projects: (record.derived?.projects ?? []).map((project) => ({
      projectId: project.projectId,
      git: project.git
    }))
  };
}

function toGitHubSnapshotsSection(
  record: NormalizedCacheRecord
): Required<GitHubSnapshotsCacheSection> {
  if (record.githubSnapshots) {
    return {
      version: SECTION_VERSION,
      projects: record.githubSnapshots.projects
    };
  }

  return {
    version: SECTION_VERSION,
    projects: (record.derived?.projects ?? [])
      .filter((project) => project.github)
      .map((project) => ({
        projectId: project.projectId,
        github: project.github as ProjectGitHubSnapshot
      }))
  };
}

function toDiagnosticsSection(record: NormalizedCacheRecord): Required<DiagnosticsCacheSection> {
  return {
    version: SECTION_VERSION,
    entries: record.diagnostics?.entries ?? record.normalized.diagnostics
  };
}

function toRawArtifactIndexSection(
  record: NormalizedCacheRecord
): Required<RawArtifactIndexCacheSection> {
  if (record.rawArtifactIndex) {
    return {
      version: SECTION_VERSION,
      entries: record.rawArtifactIndex.entries
    };
  }

  const entriesById = new Map<string, ReturnType<typeof collectRawArtifactRefsFromNormalized>[number]>();

  for (const artifact of collectRawArtifactRefsFromNormalized(record.normalized)) {
    entriesById.set(artifact.id, artifact);
  }

  return {
    version: SECTION_VERSION,
    entries: createRawArtifactIndexEntries({
      adapterVersion: "legacy-cache",
      artifacts: [...entriesById.values()],
      diagnosticsHash: "legacy-cache",
      parserVersion: "legacy-cache",
      schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
    })
  };
}

function collectRawArtifactRefsFromNormalized(record: AdapterNormalizationResult) {
  return [
    ...record.projects.flatMap((project) =>
      (project.harnessRefs ?? []).flatMap((ref) => ref.rawArtifactRefs)
    ),
    ...record.sessions.flatMap((session) => session.rawArtifactRefs ?? []),
    ...record.outputArtifacts.map((artifact) => ({
      id: artifact.id,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      ...(artifact.nativeRef ?? artifact.nativeId
        ? { nativeRef: artifact.nativeRef ?? artifact.nativeId }
        : {}),
      ...(artifact.nativeId ? { nativeId: artifact.nativeId } : {}),
      ...(artifact.path ? { path: artifact.path } : {}),
      artifactKind: "output-artifact" as const,
      artifactType: artifact.kind,
      ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
      ...(artifact.sizeBytes !== undefined ? { sizeBytes: artifact.sizeBytes } : {}),
      ...(artifact.mtime ? { mtime: artifact.mtime } : {}),
      parseStrategy:
        artifact.contentKind === "json" || artifact.contentKind === "json-output-wrapper"
          ? ("json" as const)
          : artifact.contentKind === "plain-text"
            ? ("text" as const)
            : ("unknown" as const)
    }))
  ];
}

function toCapabilitySnapshotsSection(
  record: NormalizedCacheRecord
): Required<CapabilitySnapshotsCacheSection> {
  const snapshots = (record.capabilitySnapshots ?? record.normalized.capabilities) as AdapterCapabilitySnapshots;

  return {
    version: SECTION_VERSION,
    adapter: snapshots.adapter,
    source: snapshots.source,
    sessions: snapshots.sessions
  };
}

function attachLegacyDerivedCompatibility(
  record: HydratedNormalizedCacheRecord
): HydratedNormalizedCacheRecord {
  const derived = buildDerivedCompatibility(record);

  return {
    ...record,
    ...(derived ? { derived } : {})
  };
}

function buildDerivedCompatibility(record: HydratedNormalizedCacheRecord): DerivedCacheRecord | undefined {
  const sessionsById = new Map<string, DerivedSessionCacheRecord>();

  for (const session of record.shellCommands.sessions) {
    sessionsById.set(session.sessionId, {
      sessionId: session.sessionId,
      shellCommands: session.shellCommands
    });
  }

  for (const session of record.verificationResults.sessions) {
    const current = sessionsById.get(session.sessionId);
    sessionsById.set(session.sessionId, {
      sessionId: session.sessionId,
      shellCommands: current?.shellCommands ?? [],
      verification: session.verification,
      ...(current?.audit ? { audit: current.audit } : {})
    });
  }

  for (const session of record.runAudits.sessions) {
    const current = sessionsById.get(session.sessionId);
    sessionsById.set(session.sessionId, {
      sessionId: session.sessionId,
      shellCommands: current?.shellCommands ?? [],
      ...(current?.verification ? { verification: current.verification } : {}),
      audit: session.audit
    });
  }

  const projectsById = new Map<string, DerivedProjectCacheRecord>();

  for (const project of record.gitSnapshots.projects) {
    projectsById.set(project.projectId, {
      projectId: project.projectId,
      git: project.git
    });
  }

  for (const project of record.githubSnapshots.projects) {
    const current = projectsById.get(project.projectId);

    projectsById.set(project.projectId, {
      projectId: project.projectId,
      git: current?.git ?? {
        status: "unknown",
        rootConfidence: "unknown",
        diagnosticIds: []
      },
      github: project.github
    });
  }

  const hasSessionData = sessionsById.size > 0;
  const hasProjectData = projectsById.size > 0;

  if (!hasSessionData && !hasProjectData) {
    return undefined;
  }

  return {
    version: DERIVED_CACHE_VERSION,
    sessions: [...sessionsById.values()],
    ...(hasProjectData ? { projects: [...projectsById.values()] } : {})
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
