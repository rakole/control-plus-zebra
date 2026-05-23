export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface ConfidenceScore {
  level: ConfidenceLevel;
  reason?: string;
  evidence?: string[];
}

export const HIGH_CONFIDENCE: ConfidenceScore = { level: "high" };
export const MEDIUM_CONFIDENCE: ConfidenceScore = { level: "medium" };
export const LOW_CONFIDENCE: ConfidenceScore = { level: "low" };
export const UNKNOWN_CONFIDENCE: ConfidenceScore = { level: "unknown" };
