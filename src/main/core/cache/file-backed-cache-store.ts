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

const CACHE_FILE_VERSION = 3;
const SECTION_VERSION = 1;
const DERIVED_CACHE_VERSION = 1;
const LEGACY_CACHE_FILE_VERSION_1 = 1;
const LEGACY_CACHE_FILE_VERSION_2 = 2;

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
    version: z.literal(CACHE_FILE_VERSION),
    records: z.array(hydratedNormalizedCacheRecordSchema)
  })
  .strict();

const legacyCacheFileSchema = z
  .object({
    version: z.union([z.literal(LEGACY_CACHE_FILE_VERSION_1), z.literal(LEGACY_CACHE_FILE_VERSION_2)]),
    records: z.array(legacyNormalizedCacheRecordSchema)
  })
  .strict();

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

export class FileBackedCacheStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<NormalizedCacheRecord[]> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const parsed = parseCacheFile(JSON.parse(source));

      return parsed.records.map(attachLegacyDerivedCompatibility);
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
    const nextRecords: NormalizedCacheRecord[] = currentRecords.filter(
      (current) =>
        !(current.sourceId === record.sourceId && current.cacheKey === record.cacheKey)
    );

    nextRecords.push(record);
    await this.save(nextRecords);
  }

  async save(records: NormalizedCacheRecord[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const payload = currentCacheFileSchema.parse({
      version: CACHE_FILE_VERSION,
      records: records.map(toHydratedRecord)
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function parseCacheFile(payload: unknown): {
  version: 3;
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

  throw current.error;
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
    ...record.sessions.flatMap((session) => session.rawArtifactRefs ?? [])
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
