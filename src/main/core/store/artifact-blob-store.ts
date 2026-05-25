import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BoundedIngestionError,
  DEFAULT_BOUNDED_INGESTION_LIMITS,
  getUtf8ByteLength
} from "../ingestion/bounded-ingestion.js";

export interface ArtifactBlobStoreOptions {
  maxContentBytes?: number;
  maxPreviewBytes?: number;
  rootDir: string;
}

export interface WriteTextBlobInput {
  blobId: string;
  extension?: string;
  text: string;
}

export interface StoredArtifactBlob {
  blobId: string;
  byteLength: number;
  previewText: string;
  relativePath: string;
}

export class ArtifactBlobStore {
  readonly #maxContentBytes: number;
  readonly #maxPreviewBytes: number;
  readonly #rootDir: string;

  constructor(options: ArtifactBlobStoreOptions) {
    this.#maxContentBytes = options.maxContentBytes ?? DEFAULT_BOUNDED_INGESTION_LIMITS.maxRawArtifactChunkBytes;
    this.#maxPreviewBytes = options.maxPreviewBytes ?? Math.min(8 * 1024, this.#maxContentBytes);
    this.#rootDir = options.rootDir;

    mkdirSync(this.#rootDir, { recursive: true });
  }

  async writeTextBlob(input: WriteTextBlobInput): Promise<StoredArtifactBlob> {
    const byteLength = getUtf8ByteLength(input.text);

    if (byteLength > this.#maxContentBytes) {
      throw new BoundedIngestionError(
        "artifact.raw-chunk-too-large",
        `Artifact blob ${input.blobId} exceeds the ${this.#maxContentBytes}-byte bounded ingestion limit.`
      );
    }

    const extension = normalizeExtension(input.extension);
    const relativePath = path.join(input.blobId.slice(0, 2) || "bl", `${sanitizeBlobId(input.blobId)}${extension}`);
    const absolutePath = path.join(this.#rootDir, relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.text, "utf8");

    return {
      blobId: input.blobId,
      byteLength,
      previewText: truncateUtf8ByBytes(input.text, this.#maxPreviewBytes),
      relativePath
    };
  }
}

function normalizeExtension(extension: string | undefined): string {
  if (!extension) {
    return ".txt";
  }

  return extension.startsWith(".") ? extension : `.${extension}`;
}

function sanitizeBlobId(blobId: string): string {
  return blobId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function truncateUtf8ByBytes(value: string, maxBytes: number): string {
  if (getUtf8ByteLength(value) <= maxBytes) {
    return value;
  }

  let end = value.length;

  while (end > 0) {
    const candidate = value.slice(0, end);

    if (getUtf8ByteLength(candidate) <= maxBytes) {
      return candidate;
    }

    end -= 1;
  }

  return "";
}
