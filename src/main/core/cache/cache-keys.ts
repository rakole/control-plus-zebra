import { createHash } from "node:crypto";

import type { AdapterId, SourceId } from "../model/identifiers.js";
import type { RawArtifactIndexEntry } from "../ingestion/raw-artifact-index.js";

export interface CacheKeyInput {
  adapterId: AdapterId;
  sourceId: SourceId;
  adapterVersion: string;
  parserVersion: string;
  schemaVersion: string;
  diagnosticsHash: string;
  artifacts: RawArtifactIndexEntry[];
}

export function createCacheKey(input: CacheKeyInput): string {
  const serializedArtifacts = [...input.artifacts]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((artifact) =>
      JSON.stringify({
        adapterId: artifact.adapterId,
        adapterVersion: artifact.adapterVersion,
        artifactKind: artifact.artifactKind,
        artifactType: artifact.artifactType,
        diagnosticsHash: artifact.diagnosticsHash,
        id: artifact.id,
        mediaType: artifact.mediaType ?? null,
        mtime: artifact.mtime ?? null,
        mtimeMs: artifact.mtimeMs ?? null,
        nativeId: artifact.nativeId,
        nativeRef: artifact.nativeRef ?? null,
        parseStrategy: artifact.parseStrategy,
        parserVersion: artifact.parserVersion,
        path: artifact.path ?? null,
        schemaVersion: artifact.schemaVersion,
        sizeBytes: artifact.sizeBytes ?? null,
        sourceId: artifact.sourceId,
        byteLength: artifact.byteLength ?? null,
        inode: artifact.inode ?? null
      })
    )
    .join("|");
  const digest = createHash("sha256")
    .update(
      [
        input.adapterId,
        input.sourceId,
        input.adapterVersion,
        input.parserVersion,
        input.schemaVersion,
        input.diagnosticsHash,
        serializedArtifacts
      ].join("|")
    )
    .digest("hex");

  return `cache_${digest.slice(0, 24)}`;
}
