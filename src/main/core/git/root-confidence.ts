import type { Project } from "../model/entities.js";

export type ProjectRootConfidence = "confirmed" | "observed" | "inferred" | "unknown";

export interface ProjectRootCandidate {
  confidence: ProjectRootConfidence;
  path?: string;
  reason?: string;
}

export function resolveProjectRootCandidate(project: Project): ProjectRootCandidate {
  const configuredPath =
    typeof project.rootPath === "string" && project.rootPath.trim().length > 0
      ? project.rootPath.trim()
      : undefined;
  const configuredConfidence = parseProjectRootConfidence(
    project.metadata?.projectRootConfidence ?? project.metadata?.projectRootMapping
  );

  if (!configuredPath) {
    return {
      confidence: "unknown",
      reason: "No project root evidence was captured for this project."
    };
  }

  const confidence = configuredConfidence ?? "observed";

  if (confidence === "inferred") {
    return {
      confidence,
      path: configuredPath,
      reason:
        "Git context is unavailable because the project root was inferred rather than observed."
    };
  }

  if (confidence === "unknown") {
    return {
      confidence,
      path: configuredPath,
      reason:
        "Git context is unavailable because Agent Workbench could not trust the captured project root."
    };
  }

  return {
    confidence,
    path: configuredPath
  };
}

function parseProjectRootConfidence(value: unknown): ProjectRootConfidence | undefined {
  switch (value) {
    case "confirmed":
    case "observed":
    case "inferred":
    case "unknown":
      return value;
    case "native":
      return "confirmed";
    case "none":
      return "unknown";
    default:
      return undefined;
  }
}
