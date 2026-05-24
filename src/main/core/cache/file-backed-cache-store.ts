import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { AdapterNormalizationResult } from "../adapter-contract/types.js";
import type { AdapterId, SourceId } from "../model/identifiers.js";
import type { RunAuditResult } from "../audit/types.js";
import type { ParsedShellCommand } from "../shell/types.js";
import type { VerificationResult } from "../verification/types.js";
import type { ProjectGitSnapshot } from "../git/git-snapshot-provider.js";

const confidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    reason: z.string().optional(),
    evidence: z.array(z.string()).optional()
  })
  .strict();

const capabilityStateSchema = z
  .object({
    status: z.enum(["supported", "unsupported", "unknown"]),
    reason: z.string().optional(),
    details: z.string().optional()
  })
  .strict();

const capabilityEnvelopeSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    capabilities: z.object({
      sessionDiscovery: capabilityStateSchema,
      liveSessionObservation: capabilityStateSchema,
      eventStreaming: capabilityStateSchema,
      messageCapture: capabilityStateSchema,
      toolCallCapture: capabilityStateSchema,
      shellCommandCapture: capabilityStateSchema,
      outputArtifactCapture: capabilityStateSchema,
      fileMutationCapture: capabilityStateSchema,
      sourceValidation: capabilityStateSchema,
      watchPlans: capabilityStateSchema,
      gitContextCapture: capabilityStateSchema,
      githubContextCapture: capabilityStateSchema,
      verificationSignals: capabilityStateSchema
    })
  })
  .strict();

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
    relatedEntityIds: z.array(z.string()).optional(),
    confidence: confidenceSchema,
    metadata: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.null()]))
      .optional()
  })
  .strict();

const entityMetadataValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.null(),
  z.array(z.union([z.boolean(), z.number(), z.string(), z.null()]))
]);

const normalizedEntityBaseSchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    confidence: confidenceSchema,
    diagnosticIds: z.array(z.string()).optional(),
    metadata: z.record(z.string(), entityMetadataValueSchema).optional()
  })
  .strict();

const normalizedSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    capabilities: z
      .object({
        adapter: capabilityEnvelopeSchema,
        source: capabilityEnvelopeSchema,
        sessions: z.array(capabilityEnvelopeSchema)
      })
      .strict(),
    projects: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("project"),
        nativeId: z.string().min(1),
        name: z.string().min(1),
        rootPath: z.string().min(1).optional()
      })
    ),
    sessions: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("session"),
        nativeId: z.string().min(1),
        projectId: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        startedAt: z.string().min(1).optional(),
        endedAt: z.string().min(1).optional(),
        lifecycleState: z.enum(["active", "completed", "cancelled", "unknown"])
      })
    ),
    events: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("session-event"),
        sessionId: z.string().min(1),
        nativeId: z.string().min(1),
        eventKind: z.enum([
          "lifecycle",
          "message",
          "tool-call",
          "shell-command",
          "output-artifact",
          "file-mutation",
          "metadata"
        ]),
        timestamp: z.string().min(1).optional(),
        ordinal: z.number().int().nonnegative(),
        summary: z.string().min(1).optional(),
        messageId: z.string().min(1).optional(),
        toolCallId: z.string().min(1).optional(),
        shellCommandId: z.string().min(1).optional(),
        outputArtifactId: z.string().min(1).optional(),
        fileMutationId: z.string().min(1).optional()
      })
    ),
    messages: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("session-message"),
        sessionId: z.string().min(1),
        nativeId: z.string().min(1),
        role: z.enum(["assistant", "system", "tool", "user"]),
        content: z.string(),
        ordinal: z.number().int().nonnegative(),
        timestamp: z.string().min(1).optional(),
        eventId: z.string().min(1).optional()
      })
    ),
    toolCalls: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("tool-call"),
        sessionId: z.string().min(1),
        nativeId: z.string().min(1),
        toolName: z.string().min(1),
        status: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
        startedAt: z.string().min(1).optional(),
        endedAt: z.string().min(1).optional(),
        inputSummary: z.string().min(1).optional(),
        outputSummary: z.string().min(1).optional(),
        eventId: z.string().min(1).optional(),
        artifactIds: z.array(z.string()).optional(),
        fileMutationIds: z.array(z.string()).optional()
      })
    ),
    shellCommands: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("shell-command"),
        sessionId: z.string().min(1),
        nativeId: z.string().min(1),
        command: z.string().min(1),
        outputSource: z.enum(["stdout", "stderr", "combined", "unknown"]),
        cwd: z.string().min(1).optional(),
        exitCode: z.number().int().optional(),
        startedAt: z.string().min(1).optional(),
        endedAt: z.string().min(1).optional(),
        outputSummary: z.string().min(1).optional(),
        eventId: z.string().min(1).optional(),
        toolCallId: z.string().min(1).optional(),
        artifactIds: z.array(z.string().min(1)).optional(),
        rawToolStatus: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]).optional()
      })
    ),
    outputArtifacts: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("output-artifact"),
        sessionId: z.string().min(1),
        nativeId: z.string().min(1),
        artifactKind: z.enum(["image", "json", "text", "trace", "unknown"]),
        path: z.string().min(1).optional(),
        uri: z.string().min(1).optional(),
        mediaType: z.string().min(1).optional(),
        byteLength: z.number().int().nonnegative().optional(),
        eventId: z.string().min(1).optional()
      })
    ),
    fileMutations: z.array(
      normalizedEntityBaseSchema.extend({
        kind: z.literal("file-mutation"),
        sessionId: z.string().min(1),
        nativeId: z.string().min(1),
        path: z.string().min(1),
        mutationKind: z.enum(["created", "updated", "deleted", "unknown"]),
        eventId: z.string().min(1).optional(),
        toolCallId: z.string().min(1).optional()
      })
    ),
    diagnostics: z.array(diagnosticSchema)
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

const derivedSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    shellCommands: z.array(parsedShellCommandSchema),
    verification: z
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
      .strict()
      .optional(),
    audit: z
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
      .strict()
      .optional()
  })
  .strict();

const derivedProjectSchema = z
  .object({
    projectId: z.string().min(1),
    git: z
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
      .strict()
  })
  .strict();

const derivedSchema = z
  .object({
    sessions: z.array(derivedSessionSchema),
    projects: z.array(derivedProjectSchema).optional()
  })
  .strict();

const recordSchema = z
  .object({
    cacheKey: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    artifactFingerprint: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    normalized: normalizedSchema,
    derived: derivedSchema.optional()
  })
  .strict();

const cacheFileSchema = z
  .object({
    version: z.literal(1),
    records: z.array(recordSchema)
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
}

export interface DerivedCacheRecord {
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

      return parsed.records as NormalizedCacheRecord[];
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
      version: 1,
      records
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
