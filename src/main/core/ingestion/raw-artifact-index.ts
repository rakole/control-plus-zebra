import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { RawArtifactRef } from "../adapter-contract/types.js";
import type { AdapterId, RawArtifactId, SourceId } from "../model/identifiers.js";

export const RAW_ARTIFACT_SCHEMA_VERSION = "1";

export interface RawArtifactIndexEntry {
  id: RawArtifactId;
  adapterId: AdapterId;
  sourceId: SourceId;
  nativeId: string;
  path?: string;
  artifactType: string;
  mediaType?: string;
  byteLength?: number;
  mtimeMs?: number;
  inode?: number;
  parserVersion: string;
  adapterVersion: string;
  schemaVersion: string;
  diagnosticsHash: string;
}

const entrySchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    nativeId: z.string().min(1),
    path: z.string().min(1).optional(),
    artifactType: z.string().min(1),
    mediaType: z.string().min(1).optional(),
    byteLength: z.number().int().nonnegative().optional(),
    mtimeMs: z.number().nonnegative().optional(),
    inode: z.number().int().nonnegative().optional(),
    parserVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
    diagnosticsHash: z.string().min(1)
  })
  .strict();

const indexFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(entrySchema)
  })
  .strict();

export class RawArtifactIndex {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<RawArtifactIndexEntry[]> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const parsed = indexFileSchema.parse(JSON.parse(source));

      return parsed.entries.map((entry) => ({
        id: entry.id,
        adapterId: entry.adapterId,
        sourceId: entry.sourceId,
        nativeId: entry.nativeId,
        ...(entry.path ? { path: entry.path } : {}),
        artifactType: entry.artifactType,
        ...(entry.mediaType ? { mediaType: entry.mediaType } : {}),
        ...(entry.byteLength !== undefined ? { byteLength: entry.byteLength } : {}),
        ...(entry.mtimeMs !== undefined ? { mtimeMs: entry.mtimeMs } : {}),
        ...(entry.inode !== undefined ? { inode: entry.inode } : {}),
        parserVersion: entry.parserVersion,
        adapterVersion: entry.adapterVersion,
        schemaVersion: entry.schemaVersion,
        diagnosticsHash: entry.diagnosticsHash
      }));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  async listSourceEntries(sourceId: SourceId): Promise<RawArtifactIndexEntry[]> {
    return (await this.load()).filter((entry) => entry.sourceId === sourceId);
  }

  async replaceSourceEntries(
    sourceId: SourceId,
    entries: RawArtifactIndexEntry[]
  ): Promise<void> {
    const currentEntries = await this.load();
    const nextEntries = currentEntries.filter((entry) => entry.sourceId !== sourceId);

    nextEntries.push(...entries);
    await this.save(nextEntries);
  }

  async hasSourceChanged(
    sourceId: SourceId,
    nextEntries: RawArtifactIndexEntry[]
  ): Promise<{ changed: boolean; previousFingerprint?: string; nextFingerprint: string }> {
    const previousEntries = await this.listSourceEntries(sourceId);
    const previousFingerprint =
      previousEntries.length > 0 ? fingerprintEntries(previousEntries) : undefined;
    const nextFingerprint = fingerprintEntries(nextEntries);

    return {
      changed: previousFingerprint !== nextFingerprint,
      ...(previousFingerprint ? { previousFingerprint } : {}),
      nextFingerprint
    };
  }

  async save(entries: RawArtifactIndexEntry[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const payload = indexFileSchema.parse({
      version: 1,
      entries
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

export function createRawArtifactIndexEntries(input: {
  adapterVersion: string;
  artifacts: Array<RawArtifactRef & { inode?: number }>;
  diagnosticsHash: string;
  parserVersion: string;
  schemaVersion?: string;
}): RawArtifactIndexEntry[] {
  return input.artifacts.map((artifact) => ({
    id: artifact.id,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    nativeId: artifact.nativeId,
    ...(artifact.path ? { path: artifact.path } : {}),
    artifactType: artifact.artifactType,
    ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
    ...(artifact.byteLength !== undefined ? { byteLength: artifact.byteLength } : {}),
    ...(artifact.mtimeMs !== undefined ? { mtimeMs: artifact.mtimeMs } : {}),
    ...(artifact.inode !== undefined ? { inode: artifact.inode } : {}),
    parserVersion: input.parserVersion,
    adapterVersion: input.adapterVersion,
    schemaVersion: input.schemaVersion ?? RAW_ARTIFACT_SCHEMA_VERSION,
    diagnosticsHash: input.diagnosticsHash
  }));
}

export function fingerprintEntries(entries: RawArtifactIndexEntry[]): string {
  const stable = [...entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) =>
      JSON.stringify({
        adapterId: entry.adapterId,
        adapterVersion: entry.adapterVersion,
        artifactType: entry.artifactType,
        byteLength: entry.byteLength ?? null,
        diagnosticsHash: entry.diagnosticsHash,
        id: entry.id,
        inode: entry.inode ?? null,
        mediaType: entry.mediaType ?? null,
        mtimeMs: entry.mtimeMs ?? null,
        nativeId: entry.nativeId,
        parserVersion: entry.parserVersion,
        path: entry.path ?? null,
        schemaVersion: entry.schemaVersion,
        sourceId: entry.sourceId
      })
    )
    .join("|");

  return createHash("sha256").update(stable).digest("hex");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
