import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTriageViewModelService } from "../../../src/main/app/triage-view-model-service.js";
import {
  ArchiveExportError,
  ArchiveExporter
} from "../../../src/main/core/archive/archive-exporter.js";
import {
  cleanupTempDirs,
  createScannedRuntime
} from "../ipc/triage-test-runtime.js";

describe("ArchiveExporter", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("writes normalized-only project archives by default and records manifest metadata", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const triageService = createTriageViewModelService({ runtime });
    const projectId = (await triageService.listProjects()).find(
      (project) => project.projectName === "control-plus-zebra"
    )?.projectId;

    expect(projectId).toBeDefined();
    if (!projectId) {
      throw new Error("Expected a scanned project.");
    }

    const destinationPath = path.join(runtime.appDataDir, "exports", "normalized.awb-archive.json");
    const result = await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });
    const archive = JSON.parse(await readFile(destinationPath, "utf8")) as {
      manifest: {
        counts: { cacheRecords: number };
        includes: { rawArtifacts: boolean };
        scope: { kind: string };
      };
      payload: { rawArtifacts?: unknown[]; cacheRecords: unknown[]; sources: unknown[] };
    };

    expect(result.manifest.format).toBe("agent-workbench-archive");
    expect(result.manifest.includes.rawArtifacts).toBe(false);
    expect(archive.manifest.scope.kind).toBe("project");
    expect(archive.manifest.counts.cacheRecords).toBeGreaterThan(0);
    expect(archive.payload.sources.length).toBeGreaterThan(0);
    expect(archive.payload.cacheRecords.length).toBeGreaterThan(0);
    expect(
      archive.payload.cacheRecords.every(
        (record) => typeof record === "object" && record !== null && !("derived" in record)
      )
    ).toBe(true);
    expect(archive.payload.rawArtifacts).toBeUndefined();
  });

  it("includes only indexed raw artifacts when raw export is explicitly enabled", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const geminiRecord = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "gemini-cli"
    );
    const geminiSession = geminiRecord?.normalized.sessions[0];
    const geminiSessionId = geminiSession?.id;

    expect(geminiSessionId).toBeDefined();
    expect(geminiSession?.nativeId).toBeDefined();
    if (!geminiSessionId || !geminiSession?.nativeId) {
      throw new Error("Expected a Gemini fixture session.");
    }

    const strayPath = path.join(runtime.appDataDir, "gemini-root", "not-indexed-secret.txt");
    await writeFile(strayPath, "secret", "utf8");

    const availability = await exporter.getScopeAvailability({
      kind: "session",
      sessionId: geminiSessionId
    });

    expect(availability.rawArtifactsAvailable).toBe(true);
    expect(availability.rawArtifactCount).toBeGreaterThan(0);

    const destinationPath = path.join(runtime.appDataDir, "exports", "raw.awb-archive.json");
    const result = await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "session", sessionId: geminiSessionId }
    });
    const archive = JSON.parse(await readFile(destinationPath, "utf8")) as {
      manifest: {
        counts: { rawArtifacts: number };
        includes: { privacyWarningAcknowledged: boolean; rawArtifacts: boolean };
      };
      payload: {
        rawArtifacts?: Array<{
          artifactKind: string;
          nativeRef?: string;
          originalPath?: string;
          parseStrategy: string;
          content: string;
        }>;
        sources: Array<{ rootPath: string; sourceId: string }>;
      };
    };
    const rawArtifacts = archive.payload.rawArtifacts ?? [];
    const sessionScopedArtifacts = rawArtifacts.filter(
      (artifact) =>
        artifact.artifactKind === "session-log" || artifact.artifactKind === "output-artifact"
    );

    expect(result.rawArtifactCount).toBeGreaterThan(0);
    expect(archive.manifest.includes.rawArtifacts).toBe(true);
    expect(archive.manifest.includes.privacyWarningAcknowledged).toBe(true);
    expect(archive.manifest.counts.rawArtifacts).toBe(result.rawArtifactCount);
    expect(rawArtifacts.length).toBe(result.rawArtifactCount);
    expect(rawArtifacts.every((artifact) => artifact.content.length > 0)).toBe(true);
    expect(rawArtifacts.every((artifact) => artifact.parseStrategy.length > 0)).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "project-root-map")).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "history")).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "session-log")).toBe(true);
    expect(rawArtifacts.some((artifact) => artifact.artifactKind === "output-artifact")).toBe(true);
    expect(
      sessionScopedArtifacts.every((artifact) =>
        [artifact.nativeRef, artifact.originalPath].some((value) =>
          value?.includes(geminiSession.nativeId ?? "")
        )
      )
    ).toBe(true);
    expect(
      rawArtifacts.some((artifact) => artifact.originalPath?.endsWith("not-indexed-secret.txt"))
    ).toBe(false);
    expect(archive.payload.sources).toEqual([
      expect.objectContaining({
        sourceId: geminiRecord?.sourceId,
        rootPath: path.join(runtime.appDataDir, "gemini-root")
      })
    ]);
  });

  it("rejects raw artifact export until the privacy warning is acknowledged", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const geminiSessionId = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "gemini-cli"
    )?.normalized.sessions[0]?.id;

    expect(geminiSessionId).toBeDefined();
    if (!geminiSessionId) {
      throw new Error("Expected a Gemini fixture session.");
    }

    await expect(
      exporter.createArchive({
        destinationPath: path.join(
          runtime.appDataDir,
          "exports",
          "raw-warning-required.awb-archive.json"
        ),
        includeRawArtifacts: true,
        privacyWarningAcknowledged: false,
        scope: { kind: "session", sessionId: geminiSessionId }
      })
    ).rejects.toMatchObject({
      code: "archive-export.warning-not-acknowledged"
    } satisfies Partial<ArchiveExportError>);
  });

  it("does not include unreferenced same-source raw artifacts in project archives", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const exporter = new ArchiveExporter({
      cacheStore: runtime.cacheStore,
      rawArtifactIndex: runtime.rawArtifactIndex,
      sourceRegistry: runtime.sourceRegistry
    });
    const geminiRecord = (await runtime.cacheStore.listLatestRecords()).find(
      (record) => record.adapterId === "gemini-cli"
    );
    const projectId = geminiRecord?.normalized.projects[0]?.id;
    const existingEntries = await runtime.rawArtifactIndex.load();
    const templateEntry = existingEntries.find(
      (entry) => entry.sourceId === geminiRecord?.sourceId && entry.path
    );

    expect(projectId).toBeDefined();
    expect(geminiRecord).toBeDefined();
    expect(templateEntry).toBeDefined();
    if (!projectId || !geminiRecord || !templateEntry) {
      throw new Error("Expected a Gemini project with indexed raw artifacts.");
    }

    const unrelatedPath = path.join(
      runtime.appDataDir,
      "gemini-root",
      "chats",
      "session-unrelated.jsonl"
    );

    await mkdir(path.dirname(unrelatedPath), { recursive: true });
    await writeFile(unrelatedPath, "{\"type\":\"message\",\"text\":\"leak\"}\n", "utf8");
    await runtime.rawArtifactIndex.save([
      ...existingEntries,
      {
        ...templateEntry,
        id: "raw-artifact-unreferenced-same-source",
        nativeRef: "chats/session-unrelated.jsonl",
        nativeId: "chats/session-unrelated.jsonl",
        path: unrelatedPath,
        artifactKind: "session-log",
        artifactType: "gemini-chat",
        mediaType: "application/x-ndjson"
      }
    ]);

    const destinationPath = path.join(
      runtime.appDataDir,
      "exports",
      "project-raw-scoped.awb-archive.json"
    );

    await exporter.createArchive({
      destinationPath,
      includeRawArtifacts: true,
      privacyWarningAcknowledged: true,
      scope: { kind: "project", projectId }
    });

    const archive = JSON.parse(await readFile(destinationPath, "utf8")) as {
      payload: { rawArtifacts?: Array<{ nativeRef?: string; originalPath?: string }> };
    };

    expect(
      (archive.payload.rawArtifacts ?? []).some(
        (artifact) =>
          artifact.originalPath === unrelatedPath ||
          artifact.nativeRef === "chats/session-unrelated.jsonl"
      )
    ).toBe(false);
  });
});
