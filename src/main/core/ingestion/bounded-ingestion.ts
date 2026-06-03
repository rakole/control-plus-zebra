export const DEFAULT_BOUNDED_INGESTION_LIMITS = {
  maxArchiveLineBytes: 4 * 1024 * 1024,
  maxEntityBatchSize: 5_000,
  maxRawArtifactChunkBytes: 1024 * 1024,
  maxTextLineBytes: 4 * 1024 * 1024
} as const;

export interface BoundedIngestionLimits {
  maxArchiveLineBytes: number;
  maxEntityBatchSize: number;
  maxRawArtifactChunkBytes: number;
  maxTextLineBytes: number;
}

export class BoundedIngestionError extends Error {
  readonly code:
    | "archive-import.line-too-large"
    | "archive-import.section-too-large"
    | "artifact.line-too-large"
    | "artifact.raw-chunk-too-large";

  constructor(code: BoundedIngestionError["code"], message: string) {
    super(message);
    this.name = "BoundedIngestionError";
    this.code = code;
  }
}

export function getUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function assertBoundedLine(input: {
  code: BoundedIngestionError["code"];
  line: string;
  limitBytes: number;
  subject: string;
}): void {
  const byteLength = getUtf8ByteLength(input.line);

  if (byteLength > input.limitBytes) {
    throw new BoundedIngestionError(
      input.code,
      `${input.subject} exceeds the ${input.limitBytes}-byte bounded ingestion limit.`
    );
  }
}
