export type KeysetCursorPrimitive = boolean | null | number | string;
export type KeysetCursorShape = Record<string, KeysetCursorPrimitive>;

export interface PaginationLimitOptions {
  defaultLimit?: number;
  maxLimit: number;
  minLimit?: number;
}

interface EncodedKeysetCursor<TCursor extends object> {
  version: 1;
  keyset: TCursor;
}

export class PaginationValidationError extends Error {
  readonly code: "invalid-cursor" | "invalid-limit";

  constructor(code: PaginationValidationError["code"], message?: string) {
    super(
      message ??
        (code === "invalid-cursor"
          ? "The pagination cursor is invalid."
          : "The pagination limit is invalid.")
    );
    this.name = "PaginationValidationError";
    this.code = code;
  }
}

export function encodeOpaqueCursor<TCursor extends object>(keyset: TCursor): string {
  assertCursorShape(keyset);

  return Buffer.from(
    JSON.stringify({
      version: 1,
      keyset
    } satisfies EncodedKeysetCursor<TCursor>),
    "utf8"
  ).toString("base64url");
}

export function decodeOpaqueCursor<TCursor extends object>(cursor: string): TCursor {
  if (!cursor || typeof cursor !== "string") {
    throw new PaginationValidationError("invalid-cursor");
  }

  let parsed: unknown;

  try {
    const payload = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(payload);
  } catch {
    throw new PaginationValidationError("invalid-cursor");
  }

  if (!isEncodedCursorEnvelope(parsed)) {
    throw new PaginationValidationError("invalid-cursor");
  }

  return parsed.keyset as TCursor;
}

export function validatePageLimit(
  limit: number | undefined,
  options: PaginationLimitOptions
): number {
  const minLimit = options.minLimit ?? 1;
  const defaultLimit = options.defaultLimit ?? options.maxLimit;
  const resolved = limit ?? defaultLimit;

  if (
    !Number.isInteger(resolved) ||
    resolved < minLimit ||
    resolved > options.maxLimit
  ) {
    throw new PaginationValidationError("invalid-limit");
  }

  return resolved;
}

function isEncodedCursorEnvelope(value: unknown): value is EncodedKeysetCursor<KeysetCursorShape> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<EncodedKeysetCursor<KeysetCursorShape>>;

  return candidate.version === 1 && isCursorShape(candidate.keyset);
}

function isCursorShape(value: unknown): value is KeysetCursorShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isKeysetCursorPrimitive);
}

function assertCursorShape(value: object): void {
  if (!isCursorShape(value)) {
    throw new PaginationValidationError("invalid-cursor");
  }
}

function isKeysetCursorPrimitive(value: unknown): value is KeysetCursorPrimitive {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}
