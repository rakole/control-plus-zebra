export type Confidence = "confirmed" | "observed" | "inferred" | "unknown";

export type LegacyConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type ConfidenceLevel = LegacyConfidenceLevel;

export interface ConfidenceScore {
  level: ConfidenceLevel;
  normalizedLevel?: Confidence;
  reason?: string;
  evidence?: string[];
}

function toLegacyConfidenceLevel(level: Confidence | LegacyConfidenceLevel): ConfidenceLevel {
  switch (level) {
    case "confirmed":
      return "high";
    case "observed":
      return "medium";
    case "inferred":
      return "low";
    default:
      return level;
  }
}

export function toConfidence(
  value: Confidence | LegacyConfidenceLevel | ConfidenceScore
): Confidence {
  const level = typeof value === "string" ? value : value.normalizedLevel ?? value.level;

  switch (level) {
    case "confirmed":
    case "high":
      return "confirmed";
    case "observed":
    case "medium":
      return "observed";
    case "inferred":
    case "low":
      return "inferred";
    default:
      return "unknown";
  }
}

export function createConfidenceScore(
  level: Confidence | LegacyConfidenceLevel,
  reason?: string,
  evidence?: string[]
): ConfidenceScore {
  const normalizedLevel = toConfidence(level);

  return {
    level: toLegacyConfidenceLevel(level),
    ...(normalizedLevel === "unknown" ? {} : { normalizedLevel }),
    ...(reason ? { reason } : {}),
    ...(evidence && evidence.length > 0 ? { evidence } : {})
  };
}

export const CONFIRMED_CONFIDENCE: ConfidenceScore = createConfidenceScore("confirmed");
export const OBSERVED_CONFIDENCE: ConfidenceScore = createConfidenceScore("observed");
export const INFERRED_CONFIDENCE: ConfidenceScore = createConfidenceScore("inferred");
export const UNKNOWN_CONFIDENCE: ConfidenceScore = createConfidenceScore("unknown");

export const HIGH_CONFIDENCE = CONFIRMED_CONFIDENCE;
export const MEDIUM_CONFIDENCE = OBSERVED_CONFIDENCE;
export const LOW_CONFIDENCE = INFERRED_CONFIDENCE;
