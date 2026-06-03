function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextFromRecord(candidate: Record<string, unknown>): string | undefined {
  const directTextKeys = ["content", "output", "text", "result"] as const;

  for (const key of directTextKeys) {
    const text = readNonEmptyString(candidate[key]);

    if (text) {
      return text;
    }
  }

  const nestedKeys = ["response", "payload", "data", "result"] as const;

  for (const key of nestedKeys) {
    const nested = candidate[key];

    if (!isRecord(nested)) {
      continue;
    }

    const text = extractTextFromRecord(nested);

    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractExitCodeFromRecord(candidate: Record<string, unknown>): number | undefined {
  const exitCode = readInteger(candidate.exitCode);

  if (exitCode !== undefined) {
    return exitCode;
  }

  const nestedKeys = ["response", "payload", "data", "result"] as const;

  for (const key of nestedKeys) {
    const nested = candidate[key];

    if (!isRecord(nested)) {
      continue;
    }

    const nestedExitCode = extractExitCodeFromRecord(nested);

    if (nestedExitCode !== undefined) {
      return nestedExitCode;
    }
  }

  return undefined;
}

export function extractGeminiJsonOutputEnvelope(candidate: Record<string, unknown>): {
  exitCode?: number;
  text?: string;
} {
  const text = extractTextFromRecord(candidate);
  const exitCode = extractExitCodeFromRecord(candidate);

  return {
    ...(text ? { text } : {}),
    ...(exitCode !== undefined ? { exitCode } : {})
  };
}

export function extractGeminiToolCallResultEnvelope(results: unknown[] | undefined): {
  exitCode?: number;
  text?: string;
} {
  if (!Array.isArray(results)) {
    return {};
  }

  for (const result of results) {
    if (!isRecord(result)) {
      continue;
    }

    const functionResponse = result.functionResponse;

    if (!isRecord(functionResponse)) {
      continue;
    }

    const response = functionResponse.response;

    if (!isRecord(response)) {
      continue;
    }

    const envelope = extractGeminiJsonOutputEnvelope(response);

    if (envelope.text || envelope.exitCode !== undefined) {
      return envelope;
    }
  }

  return {};
}
