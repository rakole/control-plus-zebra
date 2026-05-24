import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { RawArtifactRef } from "../adapter-contract/types.js";
import type { AdapterId, RawArtifactId, SourceId } from "../model/identifiers.js";

export const RAW_ARTIFACT_SCHEMA_VERSION = "2";

type RawArtifactKind = NonNullable<RawArtifactRef["artifactKind"]>;
type RawArtifactParseStrategy = NonNullable<RawArtifactRef["parseStrategy"]>;

export interface RawArtifactIndexEntry {
  id: RawArtifactId;
  adapterId: AdapterId;
  sourceId: SourceId;
  nativeRef?: string;
  nativeId: string;
  path?: string;
  artifactKind: RawArtifactKind;
  artifactType: string;
  mediaType?: string;
  sizeBytes?: number;
  byteLength?: number;
  mtime?: string;
  mtimeMs?: number;
  inode?: number | string;
  parseStrategy: RawArtifactParseStrategy;
  parserVersion: string;
  adapterVersion: string;
  schemaVersion: string;
  diagnosticsHash: string;
}

const legacyEntrySchema = z
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

const entrySchema = z
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

const indexFileSchema = z.union([
  z
    .object({
      version: z.literal(1),
      entries: z.array(legacyEntrySchema)
    })
    .strict(),
  z
    .object({
      version: z.literal(2),
      entries: z.array(entrySchema)
    })
    .strict()
]);

export interface RawArtifactIndexEntryChange {
  field: keyof RawArtifactIndexEntry;
  previous: RawArtifactIndexEntry[keyof RawArtifactIndexEntry];
  next: RawArtifactIndexEntry[keyof RawArtifactIndexEntry];
}

export interface RawArtifactIndexEntryPair {
  previous: RawArtifactIndexEntry;
  next: RawArtifactIndexEntry;
}

export interface RawArtifactIndexEntryChanged extends RawArtifactIndexEntryPair {
  changes: RawArtifactIndexEntryChange[];
}

export interface RawArtifactIndexComparison {
  added: RawArtifactIndexEntry[];
  removed: RawArtifactIndexEntry[];
  changed: RawArtifactIndexEntryChanged[];
  unchanged: RawArtifactIndexEntryPair[];
}

export class RawArtifactIndex {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<RawArtifactIndexEntry[]> {
    try {
      const source = await readFile(this.#filePath, "utf8");
      const parsed = indexFileSchema.parse(JSON.parse(source));

      return parsed.entries.map(normalizeIndexEntry);
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
  ): Promise<{
    changed: boolean;
    previousFingerprint?: string;
    nextFingerprint: string;
    comparison: RawArtifactIndexComparison;
  }> {
    const previousEntries = await this.listSourceEntries(sourceId);
    const previousFingerprint =
      previousEntries.length > 0 ? fingerprintEntries(previousEntries) : undefined;
    const nextFingerprint = fingerprintEntries(nextEntries);
    const comparison = compareRawArtifactIndexEntries(previousEntries, nextEntries);

    return {
      changed: previousFingerprint !== nextFingerprint,
      ...(previousFingerprint ? { previousFingerprint } : {}),
      nextFingerprint,
      comparison
    };
  }

  async save(entries: RawArtifactIndexEntry[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const normalizedEntries = entries.map(normalizeIndexEntry);
    const payload = indexFileSchema.parse({
      version: 2,
      entries: normalizedEntries
    });

    await writeFile(this.#filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

export function createRawArtifactIndexEntries(input: {
  adapterVersion: string;
  artifacts: RawArtifactRef[];
  diagnosticsHash: string;
  parserVersion: string;
  schemaVersion?: string;
}): RawArtifactIndexEntry[] {
  return input.artifacts.map((artifact) =>
    normalizeIndexEntry({
      id: artifact.id,
      adapterId: artifact.adapterId,
      sourceId: artifact.sourceId,
      ...(artifact.nativeRef ?? artifact.nativeId
        ? { nativeRef: artifact.nativeRef ?? artifact.nativeId }
        : {}),
      nativeId: artifact.nativeId ?? artifact.nativeRef ?? artifact.path ?? artifact.id,
      ...(artifact.path ? { path: artifact.path } : {}),
      artifactKind: artifact.artifactKind ?? "unknown",
      artifactType: artifact.artifactType ?? artifact.artifactKind ?? "unknown",
      ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
      ...(artifact.sizeBytes !== undefined ? { sizeBytes: artifact.sizeBytes } : {}),
      ...(artifact.byteLength !== undefined ? { byteLength: artifact.byteLength } : {}),
      ...(artifact.mtime ? { mtime: artifact.mtime } : {}),
      ...(artifact.mtimeMs !== undefined ? { mtimeMs: artifact.mtimeMs } : {}),
      ...(artifact.inode !== undefined ? { inode: artifact.inode } : {}),
      parseStrategy: artifact.parseStrategy ?? "unknown",
      parserVersion: input.parserVersion,
      adapterVersion: input.adapterVersion,
      schemaVersion: input.schemaVersion ?? RAW_ARTIFACT_SCHEMA_VERSION,
      diagnosticsHash: input.diagnosticsHash
    })
  );
}

export function fingerprintEntries(entries: RawArtifactIndexEntry[]): string {
  const stable = [...entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => JSON.stringify(toFingerprintShape(entry)))
    .join("|");

  return createHash("sha256").update(stable).digest("hex");
}

export function compareRawArtifactIndexEntries(
  previousEntries: RawArtifactIndexEntry[],
  nextEntries: RawArtifactIndexEntry[]
): RawArtifactIndexComparison {
  const previousById = buildEntryLookup(previousEntries, (entry) => entry.id);
  const previousByNativeRef = buildEntryLookup(previousEntries, (entry) => entry.nativeRef ?? entry.nativeId);
  const previousByPath = buildEntryLookup(previousEntries, (entry) => entry.path);
  const matchedPrevious = new Set<RawArtifactIndexEntry>();
  const comparison: RawArtifactIndexComparison = {
    added: [],
    removed: [],
    changed: [],
    unchanged: []
  };

  for (const nextEntry of nextEntries) {
    const previousEntry =
      takeUnmatchedEntry(previousById.get(nextEntry.id), matchedPrevious) ??
      takeUnmatchedEntry(previousByNativeRef.get(nextEntry.nativeRef ?? nextEntry.nativeId), matchedPrevious) ??
      takeUnmatchedEntry(nextEntry.path ? previousByPath.get(nextEntry.path) : undefined, matchedPrevious);

    if (!previousEntry) {
      comparison.added.push(nextEntry);
      continue;
    }

    matchedPrevious.add(previousEntry);

    const changes = diffEntry(previousEntry, nextEntry);
    if (changes.length === 0) {
      comparison.unchanged.push({ previous: previousEntry, next: nextEntry });
      continue;
    }

    comparison.changed.push({
      previous: previousEntry,
      next: nextEntry,
      changes
    });
  }

  for (const previousEntry of previousEntries) {
    if (!matchedPrevious.has(previousEntry)) {
      comparison.removed.push(previousEntry);
    }
  }

  return comparison;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function normalizeIndexEntry(
  entry: z.infer<typeof legacyEntrySchema> | z.infer<typeof entrySchema>
): RawArtifactIndexEntry {
  const nativeRef = "nativeRef" in entry ? entry.nativeRef : undefined;
  const pathValue = entry.path;
  const sizeBytes =
    "sizeBytes" in entry && entry.sizeBytes !== undefined
      ? entry.sizeBytes
      : entry.byteLength !== undefined
        ? entry.byteLength
        : undefined;
  const byteLength =
    entry.byteLength !== undefined ? entry.byteLength : sizeBytes !== undefined ? sizeBytes : undefined;
  const mtime =
    "mtime" in entry && entry.mtime
      ? entry.mtime
      : entry.mtimeMs !== undefined
        ? new Date(entry.mtimeMs).toISOString()
        : undefined;
  const mtimeMs =
    entry.mtimeMs !== undefined
      ? entry.mtimeMs
      : "mtime" in entry && entry.mtime
        ? toEpochMilliseconds(entry.mtime)
        : undefined;
  const inode = entry.inode;
  const artifactKind =
    "artifactKind" in entry ? entry.artifactKind : toArtifactKind(entry.artifactType);
  const parseStrategy =
    "parseStrategy" in entry ? entry.parseStrategy : inferParseStrategy(pathValue, entry.mediaType);

  return {
    id: entry.id,
    adapterId: entry.adapterId,
    sourceId: entry.sourceId,
    ...(nativeRef ? { nativeRef } : {}),
    nativeId: entry.nativeId,
    ...(pathValue ? { path: pathValue } : {}),
    artifactKind,
    artifactType: entry.artifactType,
    ...(entry.mediaType ? { mediaType: entry.mediaType } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(byteLength !== undefined ? { byteLength } : {}),
    ...(mtime ? { mtime } : {}),
    ...(mtimeMs !== undefined ? { mtimeMs } : {}),
    ...(inode !== undefined ? { inode } : {}),
    parseStrategy,
    parserVersion: entry.parserVersion,
    adapterVersion: entry.adapterVersion,
    schemaVersion: entry.schemaVersion,
    diagnosticsHash: entry.diagnosticsHash
  };
}

function toArtifactKind(artifactType: string): RawArtifactKind {
  switch (artifactType) {
    case "session-log":
      return "session-log";
    case "message-index":
      return "message-index";
    case "project-root-map":
      return "project-root-map";
    case "output-artifact":
      return "output-artifact";
    case "history":
      return "history";
    case "metadata":
      return "metadata";
    default:
      return "unknown";
  }
}

function inferParseStrategy(pathValue?: string, mediaType?: string): RawArtifactParseStrategy {
  if (mediaType === "application/json") {
    return "json";
  }

  if (pathValue?.endsWith(".json")) {
    return "json";
  }

  if (pathValue?.endsWith(".jsonl")) {
    return "stream-jsonl";
  }

  if (typeof pathValue === "string") {
    return "text";
  }

  return "unknown";
}

function withEpochMilliseconds(mtime: string): { mtimeMs: number } | {} {
  const parsed = toEpochMilliseconds(mtime);
  if (parsed === undefined) {
    return {};
  }

  return { mtimeMs: parsed };
}

function toEpochMilliseconds(mtime: string): number | undefined {
  const parsed = Date.parse(mtime);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function toFingerprintShape(entry: RawArtifactIndexEntry) {
  return {
    adapterId: entry.adapterId,
    adapterVersion: entry.adapterVersion,
    artifactKind: entry.artifactKind,
    artifactType: entry.artifactType,
    byteLength: entry.byteLength ?? null,
    diagnosticsHash: entry.diagnosticsHash,
    id: entry.id,
    inode: entry.inode ?? null,
    mediaType: entry.mediaType ?? null,
    mtime: entry.mtime ?? null,
    mtimeMs: entry.mtimeMs ?? null,
    nativeId: entry.nativeId,
    nativeRef: entry.nativeRef ?? null,
    parseStrategy: entry.parseStrategy,
    parserVersion: entry.parserVersion,
    path: entry.path ?? null,
    schemaVersion: entry.schemaVersion,
    sizeBytes: entry.sizeBytes ?? null,
    sourceId: entry.sourceId
  };
}

function buildEntryLookup(
  entries: RawArtifactIndexEntry[],
  selectKey: (entry: RawArtifactIndexEntry) => string | undefined
): Map<string, RawArtifactIndexEntry[]> {
  const lookup = new Map<string, RawArtifactIndexEntry[]>();

  for (const entry of entries) {
    const key = selectKey(entry);
    if (!key) {
      continue;
    }

    const bucket = lookup.get(key);
    if (bucket) {
      bucket.push(entry);
      continue;
    }

    lookup.set(key, [entry]);
  }

  return lookup;
}

function takeUnmatchedEntry(
  entries: RawArtifactIndexEntry[] | undefined,
  matchedPrevious: Set<RawArtifactIndexEntry>
): RawArtifactIndexEntry | undefined {
  return entries?.find((entry) => !matchedPrevious.has(entry));
}

function diffEntry(
  previous: RawArtifactIndexEntry,
  next: RawArtifactIndexEntry
): RawArtifactIndexEntryChange[] {
  const previousShape = toFingerprintShape(previous);
  const nextShape = toFingerprintShape(next);
  const changes: RawArtifactIndexEntryChange[] = [];

  for (const field of Object.keys(previousShape) as Array<keyof typeof previousShape>) {
    if (previousShape[field] === nextShape[field]) {
      continue;
    }

    changes.push({
      field,
      previous: previous[field],
      next: next[field]
    });
  }

  return changes;
}
