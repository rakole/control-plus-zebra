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
        artifactType: artifact.artifactType,
        byteLength: artifact.byteLength ?? null,
        diagnosticsHash: artifact.diagnosticsHash,
        id: artifact.id,
        inode: artifact.inode ?? null,
        mediaType: artifact.mediaType ?? null,
        mtimeMs: artifact.mtimeMs ?? null,
        nativeId: artifact.nativeId,
        path: artifact.path ?? null,
        schemaVersion: artifact.schemaVersion,
        sourceId: artifact.sourceId
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
