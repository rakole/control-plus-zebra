import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";
import {
  FileBackedCacheStore,
  type HydratedNormalizedCacheRecord,
  type NormalizedCacheRecord
} from "../../../src/main/core/cache/index.js";
import {
  createRawArtifactIndexEntries,
  RAW_ARTIFACT_SCHEMA_VERSION
} from "../../../src/main/core/ingestion/index.js";
import { exerciseAdapter } from "../../contract/run-adapter-contract.js";

const fixturePath = path.resolve("src/main/adapters/fake-test/fixtures/phase1-session.fixture.json");
const CACHE_FILE_VERSION = 4;

describe("FileBackedCacheStore", () => {
  let baseRecord: NormalizedCacheRecord;

  beforeAll(async () => {
    const { normalized } = await exerciseAdapter(fakeTestAdapter, fixturePath);
    const sessionId = normalized.sessions[0]?.id;
    const projectId = normalized.projects[0]?.id;

    if (!sessionId || !projectId) {
      throw new Error("Expected fake-test fixture to include a session and project.");
    }

    const rawArtifactIndex = uniqueRawArtifactIndexEntries(normalized);

    baseRecord = {
      cacheKey: "cache-proof",
      adapterId: normalized.adapterId,
      sourceId: normalized.sourceId,
      artifactFingerprint: "fingerprint-proof",
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      normalized,
      shellCommands: {
        sessions: [
          {
            sessionId,
            shellCommands: [
              {
                shellCommandId: "shell-command-1",
                command: "npm test",
                cwd: "/tmp/project",
                intent: "test",
                result: "passed",
                outputSource: "combined",
                outputTextSource: "artifact",
                exitCode: 0,
                exitCodeSource: "artifact",
                rawToolStatus: "succeeded",
                ...(normalized.toolCalls[0]?.id ? { toolCallId: normalized.toolCalls[0].id } : {}),
                artifactIds: rawArtifactIndex[0] ? [rawArtifactIndex[0].id] : [],
                failureMarkers: [],
                confidence: {
                  level: "high",
                  normalizedLevel: "confirmed",
                  reason: "fixture proof"
                },
                diagnosticIds: normalized.diagnostics[0] ? [normalized.diagnostics[0].id] : []
              }
            ]
          }
        ]
      },
      verificationResults: {
        sessions: [
          {
            sessionId,
            verification: {
              status: "passed",
              confidence: {
                level: "high",
                normalizedLevel: "confirmed",
                reason: "latest verification command passed"
              },
              commandIds: ["shell-command-1"],
              intentResults: [
                {
                  intent: "test",
                  latestCommandId: "shell-command-1",
                  latestStatus: "passed",
                  commandIds: ["shell-command-1"],
                  confidence: {
                    level: "high",
                    normalizedLevel: "confirmed"
                  },
                  diagnosticIds: normalized.diagnostics[0] ? [normalized.diagnostics[0].id] : []
                }
              ],
              reasonCodes: []
            }
          }
        ]
      },
      runAudits: {
        sessions: [
          {
            sessionId,
            audit: {
              status: "clean",
              attentionReasons: [],
              confidence: {
                level: "high",
                normalizedLevel: "confirmed",
                reason: "verified and clean"
              },
              completionClaim: "claimed",
              supportingCommandIds: ["shell-command-1"],
              supportingToolCallIds: normalized.toolCalls[0]?.id ? [normalized.toolCalls[0].id] : [],
              supportingMessageIds: normalized.messages[0]?.id ? [normalized.messages[0].id] : [],
              diagnosticIds: normalized.diagnostics[0] ? [normalized.diagnostics[0].id] : []
            }
          }
        ]
      },
      gitSnapshots: {
        projects: [
          {
            projectId,
            git: {
              status: "available",
              rootConfidence: "confirmed",
              candidateRootPath: "/tmp/project",
              validatedRootPath: "/tmp/project",
              snapshot: {
                additions: 2,
                branch: "main",
                changedFiles: 1,
                deletions: 0,
                dirty: false,
                headSha: "abc123",
                remoteUrl: "https://github.com/example/repo.git",
                untrackedFiles: 0
              },
              diagnosticIds: []
            }
          }
        ]
      },
      githubSnapshots: {
        projects: [
          {
            projectId,
            github: {
              status: "available",
              pullRequestNumber: 42,
              pullRequestTitle: "Fix cache contract",
              pullRequestUrl: "https://github.com/example/repo/pull/42",
              checksSummary: "all checks passing",
              reviewSummary: "approved",
              diagnosticIds: []
            }
          }
        ]
      },
      diagnostics: {
        entries: normalized.diagnostics
      },
      rawArtifactIndex: {
        entries: rawArtifactIndex
      },
      capabilitySnapshots: normalized.capabilities
    };
  });

  it("writes and reloads first-class cache sections", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);

    await store.save([baseRecord]);

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      version: number;
      records: Array<Record<string, unknown>>;
    };
    const loaded = await store.getLatestSourceRecord(baseRecord.sourceId);

    expect(persisted.version).toBe(CACHE_FILE_VERSION);
    expect(persisted.records[0]).not.toHaveProperty("derived");
    expect(loaded).toBeDefined();
    if (!loaded) {
      throw new Error("Expected the saved record to reload.");
    }
    expect(loaded.shellCommands).toEqual({
      version: 1,
      sessions: baseRecord.shellCommands?.sessions
    });
    expect(loaded.verificationResults).toEqual({
      version: 1,
      sessions: baseRecord.verificationResults?.sessions
    });
    expect(loaded.runAudits).toEqual({
      version: 1,
      sessions: baseRecord.runAudits?.sessions
    });
    expect(loaded.gitSnapshots).toEqual({
      version: 1,
      projects: baseRecord.gitSnapshots?.projects
    });
    expect(loaded.githubSnapshots).toEqual({
      version: 1,
      projects: baseRecord.githubSnapshots?.projects
    });
    expect(loaded.diagnostics).toEqual({
      version: 1,
      entries: baseRecord.diagnostics?.entries
    });
    expect(loaded.rawArtifactIndex).toEqual({
      version: 1,
      entries: baseRecord.rawArtifactIndex?.entries
    });
    expect(loaded.capabilitySnapshots).toEqual({
      version: 1,
      adapter: baseRecord.capabilitySnapshots?.adapter,
      source: baseRecord.capabilitySnapshots?.source,
      sessions: baseRecord.capabilitySnapshots?.sessions
    });
    expect(loaded.derived).toEqual({
      version: 1,
      sessions: [
        {
          sessionId: baseRecord.shellCommands?.sessions[0]?.sessionId,
          shellCommands: baseRecord.shellCommands?.sessions[0]?.shellCommands ?? [],
          verification: baseRecord.verificationResults?.sessions[0]?.verification,
          audit: baseRecord.runAudits?.sessions[0]?.audit
        }
      ],
      projects: [
        {
          projectId: baseRecord.gitSnapshots?.projects[0]?.projectId,
          git: baseRecord.gitSnapshots?.projects[0]?.git,
          github: baseRecord.githubSnapshots?.projects[0]?.github
        }
      ]
    });
  });

  it("replaces one source without rewriting unrelated section files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-sections-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);
    const otherRecord = structuredClone(baseRecord);

    otherRecord.cacheKey = "cache-proof-other";
    otherRecord.sourceId = "source_other";
    otherRecord.normalized.sourceId = "source_other";
    otherRecord.normalized.capabilities.source = {
      ...otherRecord.normalized.capabilities.source,
      sourceId: "source_other"
    };

    await store.save([baseRecord, otherRecord]);

    const initialIndex = JSON.parse(await readFile(filePath, "utf8")) as {
      records: Array<{ sourceId: string; recordPath: string }>;
    };
    const otherSectionPath = path.join(
      tempDir,
      initialIndex.records.find((record) => record.sourceId === otherRecord.sourceId)
        ?.recordPath ?? ""
    );
    const otherSectionBefore = await readFile(otherSectionPath, "utf8");
    const updatedBaseRecord = {
      ...baseRecord,
      updatedAt: "2026-05-23T00:01:00.000Z"
    };

    await store.replaceSourceRecords([baseRecord.sourceId], [updatedBaseRecord]);

    const otherSectionAfter = await readFile(otherSectionPath, "utf8");
    const loadedSources = (await store.load()).map((record) => record.sourceId);

    expect(otherSectionAfter).toBe(otherSectionBefore);
    expect(loadedSources).toEqual(
      expect.arrayContaining([baseRecord.sourceId, otherRecord.sourceId])
    );
  });

  it("migrates legacy derived cache records to first-class sections", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-legacy-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);
    const legacyNormalized = structuredClone(baseRecord.normalized);
    const legacyProjectArtifact = {
      id: "legacy-project-root-map",
      adapterId: legacyNormalized.adapterId,
      sourceId: legacyNormalized.sourceId,
      nativeRef: ".project_root",
      artifactKind: "project-root-map" as const,
      parseStrategy: "text" as const,
      sizeBytes: 12,
      mtime: "2026-05-23T00:00:00.000Z"
    };

    legacyNormalized.projects[0] = {
      ...legacyNormalized.projects[0]!,
      harnessRefs: [
        ...(legacyNormalized.projects[0]?.harnessRefs ?? []),
        {
          adapterId: legacyNormalized.adapterId,
          sourceId: legacyNormalized.sourceId,
          nativeProjectId: "legacy-project",
          projectRootPath: "/tmp/project",
          projectRootConfidence: "confirmed",
          rawArtifactRefs: [legacyProjectArtifact]
        }
      ]
    };
    const legacyRecord: NormalizedCacheRecord = {
      cacheKey: baseRecord.cacheKey,
      adapterId: baseRecord.adapterId,
      sourceId: baseRecord.sourceId,
      artifactFingerprint: baseRecord.artifactFingerprint,
      createdAt: baseRecord.createdAt,
      updatedAt: baseRecord.updatedAt,
      normalized: legacyNormalized,
      derived: {
        sessions: [
          {
            sessionId: baseRecord.shellCommands?.sessions[0]?.sessionId ?? "legacy-session",
            shellCommands: baseRecord.shellCommands?.sessions[0]?.shellCommands ?? [],
            ...(baseRecord.verificationResults?.sessions[0]?.verification
              ? { verification: baseRecord.verificationResults.sessions[0].verification }
              : {}),
            ...(baseRecord.runAudits?.sessions[0]?.audit
              ? { audit: baseRecord.runAudits.sessions[0].audit }
              : {})
          }
        ],
        projects: [
          {
            projectId: baseRecord.gitSnapshots?.projects[0]?.projectId ?? "legacy-project",
            git: baseRecord.gitSnapshots?.projects[0]?.git ?? {
              status: "unknown",
              rootConfidence: "unknown",
              diagnosticIds: []
            },
            ...(baseRecord.githubSnapshots?.projects[0]?.github
              ? { github: baseRecord.githubSnapshots.projects[0].github }
              : {})
          }
        ]
      }
    };

    await writeFile(
      filePath,
      `${JSON.stringify({ version: 2, records: [legacyRecord] }, null, 2)}\n`,
      "utf8"
    );

    const [loaded] = await store.load();
    if (!loaded) {
      throw new Error("Expected a migrated legacy record.");
    }

    expect(loaded.shellCommands).toEqual({
      version: 1,
      sessions: legacyRecord.derived?.sessions.map((session) => ({
        sessionId: session.sessionId,
        shellCommands: session.shellCommands
      }))
    });
    expect(loaded.verificationResults).toEqual({
      version: 1,
      sessions: legacyRecord.derived?.sessions
        .filter((session) => session.verification)
        .map((session) => ({
          sessionId: session.sessionId,
          verification: session.verification!
        }))
    });
    expect(loaded.runAudits).toEqual({
      version: 1,
      sessions: legacyRecord.derived?.sessions
        .filter((session) => session.audit)
        .map((session) => ({
          sessionId: session.sessionId,
          audit: session.audit!
        }))
    });
    expect(loaded.gitSnapshots).toEqual({
      version: 1,
      projects: legacyRecord.derived?.projects?.map((project) => ({
        projectId: project.projectId,
        git: project.git
      })) ?? []
    });
    expect(loaded.githubSnapshots).toEqual({
      version: 1,
      projects: legacyRecord.derived?.projects
        ?.filter((project) => project.github)
        .map((project) => ({
          projectId: project.projectId,
          github: project.github!
        })) ?? []
    });
    expect(loaded.diagnostics).toEqual({
      version: 1,
      entries: baseRecord.normalized.diagnostics
    });
    expect(loaded.rawArtifactIndex).toEqual({
      version: 1,
      entries: uniqueRawArtifactIndexEntries(legacyNormalized, {
        adapterVersion: "legacy-cache",
        diagnosticsHash: "legacy-cache",
        parserVersion: "legacy-cache"
      })
    });
    expect(loaded.rawArtifactIndex?.entries.some((entry) => entry.id === legacyProjectArtifact.id)).toBe(true);
    expect(loaded.capabilitySnapshots).toEqual({
      version: 1,
      adapter: baseRecord.normalized.capabilities.adapter,
      source: baseRecord.normalized.capabilities.source,
      sessions: baseRecord.normalized.capabilities.sessions
    });
    expect(loaded.derived?.version).toBe(1);
  });

  it("migrates legacy v1 flattened capability and entity records without throwing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-v1-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);
    const sessionId = baseRecord.normalized.sessions[0]?.id ?? "session-legacy";
    const projectId = baseRecord.normalized.projects[0]?.id ?? "project-legacy";
    const eventId = "event-legacy-message";
    const toolCallId = "tool-call-legacy";
    const shellCommandId = "shell-command-legacy";
    const outputArtifactId = "output-artifact-legacy";
    const fileMutationId = "file-mutation-legacy";
    const legacyCapabilities = {
      sessionDiscovery: { status: "supported" },
      liveSessionObservation: { status: "unknown" },
      eventStreaming: { status: "supported" },
      messageCapture: { status: "supported" },
      toolCallCapture: { status: "supported" },
      shellCommandCapture: { status: "supported" },
      outputArtifactCapture: { status: "supported" },
      fileMutationCapture: { status: "supported" },
      sourceValidation: { status: "supported" },
      watchPlans: { status: "unsupported", reason: "Legacy cache did not support watches." },
      gitContextCapture: { status: "unsupported", reason: "Legacy cache did not include git snapshots." },
      githubContextCapture: { status: "unknown" },
      verificationSignals: { status: "supported" }
    };
    const legacyRecord = {
      cacheKey: "legacy-v1-cache-proof",
      adapterId: baseRecord.adapterId,
      sourceId: baseRecord.sourceId,
      artifactFingerprint: "legacy-v1-fingerprint",
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      normalized: {
        adapterId: baseRecord.adapterId,
        sourceId: baseRecord.sourceId,
        capabilities: {
          adapter: { adapterId: baseRecord.adapterId, capabilities: legacyCapabilities },
          source: {
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            capabilities: legacyCapabilities
          },
          sessions: [
            {
              adapterId: baseRecord.adapterId,
              sourceId: baseRecord.sourceId,
              sessionId,
              capabilities: legacyCapabilities
            }
          ]
        },
        projects: [
          {
            id: projectId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "project",
            nativeId: "legacy-project",
            name: "Legacy Project",
            rootPath: "/tmp/legacy-project"
          }
        ],
        sessions: [
          {
            id: sessionId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "medium" },
            diagnosticIds: ["legacy-diagnostic"],
            kind: "session",
            nativeId: "legacy-session",
            projectId,
            title: "Legacy Session",
            startedAt: "2026-05-22T00:00:00.000Z",
            endedAt: "2026-05-22T00:05:00.000Z",
            lifecycleState: "completed"
          }
        ],
        events: [
          {
            id: eventId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "session-event",
            sessionId,
            nativeId: "legacy-event",
            eventKind: "message",
            timestamp: "2026-05-22T00:00:01.000Z",
            ordinal: 1,
            summary: "Legacy user message"
          }
        ],
        messages: [
          {
            id: "message-legacy",
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "session-message",
            sessionId,
            nativeId: "legacy-message",
            role: "user",
            content: "Run the proof.",
            ordinal: 1,
            timestamp: "2026-05-22T00:00:01.000Z",
            eventId
          }
        ],
        toolCalls: [
          {
            id: toolCallId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "tool-call",
            sessionId,
            nativeId: "legacy-tool-call",
            toolName: "run_shell_command",
            status: "succeeded",
            startedAt: "2026-05-22T00:01:00.000Z",
            endedAt: "2026-05-22T00:01:02.000Z",
            inputSummary: "npm test",
            outputSummary: "passed",
            eventId,
            artifactIds: [outputArtifactId]
          }
        ],
        shellCommands: [
          {
            id: shellCommandId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "shell-command",
            sessionId,
            nativeId: "legacy-shell-command",
            command: "npm test",
            outputSource: "combined",
            outputSummary: "passed",
            eventId,
            toolCallId,
            rawToolStatus: "succeeded"
          }
        ],
        outputArtifacts: [
          {
            id: outputArtifactId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "output-artifact",
            sessionId,
            nativeId: "legacy-output-artifact",
            artifactKind: "json",
            path: "/tmp/legacy-output.json",
            mediaType: "application/json",
            byteLength: 42,
            eventId
          }
        ],
        fileMutations: [
          {
            id: fileMutationId,
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            confidence: { level: "high" },
            kind: "file-mutation",
            sessionId,
            nativeId: "legacy-file-mutation",
            path: "README.md",
            mutationKind: "updated",
            eventId,
            toolCallId
          }
        ],
        diagnostics: [
          {
            id: "legacy-diagnostic",
            code: "legacy.parser-warning",
            message: "Legacy parser warning.",
            severity: "warning",
            scope: "session",
            adapterId: baseRecord.adapterId,
            sourceId: baseRecord.sourceId,
            relatedEntityIds: [sessionId],
            confidence: { level: "medium" }
          }
        ]
      },
      derived: {
        sessions: [
          {
            sessionId,
            shellCommands: "not-a-shell-command-array"
          }
        ]
      }
    };

    await writeFile(
      filePath,
      `${JSON.stringify({ version: 1, records: [legacyRecord] }, null, 2)}\n`,
      "utf8"
    );

    const [loaded] = await store.load();

    expect(loaded).toBeDefined();
    if (!loaded) {
      throw new Error("Expected a migrated legacy v1 record.");
    }

    expect(loaded?.normalized.projects[0]).toMatchObject({
      id: projectId,
      displayName: "Legacy Project",
      primaryRootPath: "/tmp/legacy-project",
      rootConfidence: "confirmed"
    });
    expect(loaded?.normalized.sessions[0]).toMatchObject({
      id: sessionId,
      lifecycleStatus: "completed",
      parseConfidence: "observed",
      messageIds: ["message-legacy"],
      eventIds: [eventId],
      toolCallIds: [toolCallId],
      shellCommandIds: [shellCommandId],
      outputArtifactIds: [outputArtifactId],
      fileMutationIds: [fileMutationId]
    });
    expect(loaded.normalized.sessions[0]?.capabilities?.tools?.shellCommands).toBe(true);
    expect(loaded.normalized.sessions[0]?.capabilities?.live?.watchableArtifacts).toBe(false);
    expect(loaded?.normalized.events[0]).toMatchObject({
      id: eventId,
      kind: "message",
      orderKey: "000001:legacy-event",
      text: "Legacy user message"
    });
    expect(loaded?.normalized.messages[0]).toMatchObject({
      id: "message-legacy",
      text: "Run the proof.",
      eventIds: [eventId],
      confidence: "confirmed"
    });
    expect(loaded?.normalized.toolCalls[0]).toMatchObject({
      id: toolCallId,
      name: "run_shell_command",
      normalizedKind: "shell",
      statusNormalized: "completed",
      outputArtifactIds: [outputArtifactId]
    });
    expect(loaded?.normalized.outputArtifacts[0]).toMatchObject({
      id: outputArtifactId,
      kind: "sidecar",
      contentKind: "json",
      loaded: false
    });
    expect(loaded?.rawArtifactIndex?.entries).toContainEqual(
      expect.objectContaining({
        id: outputArtifactId,
        artifactKind: "output-artifact",
        path: "/tmp/legacy-output.json"
      })
    );
    expect(loaded?.normalized.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cache.legacy-record-migrated",
        severity: "warning",
        relatedEntityIds: [sessionId]
      })
    );
    expect(loaded?.normalized.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cache.legacy-derived-dropped",
        severity: "warning"
      })
    );
    expect(loaded?.derived).toBeUndefined();
  });

  it("loads quarantined legacy records for diagnostics but refuses to persist them", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-quarantine-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);

    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          records: [
            {
              cacheKey: "legacy-quarantined",
              adapterId: "fake-test",
              sourceId: "source-quarantined",
              artifactFingerprint: "legacy-quarantined",
              createdAt: "2026-05-22T00:00:00.000Z",
              updatedAt: "2026-05-22T00:00:00.000Z",
              normalized: "not-a-normalized-record"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const loaded = await store.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.normalized.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cache.legacy-record-quarantined",
        severity: "error"
      })
    );
    await expect(store.save(loaded)).rejects.toThrow(/legacy records are quarantined/);
    await expect(
      store.writeRecord({
        ...baseRecord,
        cacheKey: "new-source-cache",
        sourceId: "source-new"
      })
    ).rejects.toThrow(/legacy records are quarantined/);
  });

  it("does not treat malformed cache files as a successful load", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-bad-"));
    const filePath = path.join(tempDir, "normalized-cache.json");
    const store = new FileBackedCacheStore(filePath);
    const malformedRecord = structuredClone(baseRecord) as unknown as Record<string, unknown>;

    malformedRecord.shellCommands = {
      version: 1,
      sessions: [
        {
          sessionId: "session-bad",
          shellCommands: [
            {
              shellCommandId: "bad-shell-command",
              command: 7
            }
          ]
        }
      ]
    };

    await writeFile(
      filePath,
      `${JSON.stringify({ version: CACHE_FILE_VERSION, records: [malformedRecord] }, null, 2)}\n`,
      "utf8"
    );

    await expect(store.load()).rejects.toThrow();
  });

  it("does not collide records with the same cache key across different sources", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-sources-"));
    const store = new FileBackedCacheStore(path.join(tempDir, "normalized-cache.json"));

    await store.writeRecord(baseRecord);
    await store.writeRecord({
      ...baseRecord,
      sourceId: "source-second",
      updatedAt: "2026-05-23T01:00:00.000Z"
    });

    const loaded = await store.load();

    expect(loaded).toHaveLength(2);
    expect(new Set(loaded.map((record) => record.sourceId))).toEqual(
      new Set([baseRecord.sourceId, "source-second"])
    );
  });

  it("selects the latest record per source", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-cache-store-latest-"));
    const store = new FileBackedCacheStore(path.join(tempDir, "normalized-cache.json"));
    const older = {
      ...baseRecord,
      cacheKey: "cache-proof-older",
      updatedAt: "2026-05-23T00:00:00.000Z"
    };
    const newer = {
      ...baseRecord,
      cacheKey: "cache-proof-newer",
      updatedAt: "2026-05-23T02:00:00.000Z"
    };
    const otherSource = {
      ...baseRecord,
      cacheKey: "cache-proof-other",
      sourceId: "source-third",
      updatedAt: "2026-05-23T01:30:00.000Z"
    };

    await store.save([older, newer, otherSource]);

    const latestForPrimarySource = await store.getLatestSourceRecord(baseRecord.sourceId);
    const latestRecords = await store.listLatestRecords();

    expect(latestForPrimarySource?.cacheKey).toBe("cache-proof-newer");
    expect(latestRecords).toHaveLength(2);
    expect(latestRecords.map((record) => record.cacheKey).sort()).toEqual([
      "cache-proof-newer",
      "cache-proof-other"
    ]);
  });
});

function uniqueRawArtifactIndexEntries(
  record: NormalizedCacheRecord["normalized"],
  overrides: {
    adapterVersion?: string;
    diagnosticsHash?: string;
    parserVersion?: string;
  } = {}
) {
  const entriesById = new Map<string, ReturnType<typeof collectRawArtifactRefs>[number]>();

  for (const artifact of collectRawArtifactRefs(record)) {
    entriesById.set(artifact.id, artifact);
  }

  return createRawArtifactIndexEntries({
    adapterVersion: overrides.adapterVersion ?? "0.1.0",
    artifacts: [...entriesById.values()],
    diagnosticsHash: overrides.diagnosticsHash ?? "diag-a",
    parserVersion: overrides.parserVersion ?? "0.1.0",
    schemaVersion: RAW_ARTIFACT_SCHEMA_VERSION
  });
}

function collectRawArtifactRefs(record: NormalizedCacheRecord["normalized"]) {
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
