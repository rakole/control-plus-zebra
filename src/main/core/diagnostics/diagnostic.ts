import type { ConfidenceScore } from "../model/confidence.js";
import { createDiagnosticId } from "../model/identifiers.js";
import type { AdapterId, DiagnosticId, SourceId } from "../model/identifiers.js";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticScope =
  | "adapter"
  | "source"
  | "artifact"
  | "project"
  | "session"
  | "event"
  | "message"
  | "tool-call"
  | "shell-command"
  | "output-artifact"
  | "file-mutation";

export type DiagnosticMetadataValue = boolean | null | number | string;

export interface Diagnostic {
  id: DiagnosticId;
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  scope: DiagnosticScope;
  adapterId: AdapterId;
  sourceId?: SourceId;
  relatedEntityIds?: string[];
  confidence: ConfidenceScore;
  metadata?: Record<string, DiagnosticMetadataValue>;
}

export function buildDiagnostic(
  adapterId: AdapterId,
  code: string,
  message: string,
  severity: DiagnosticSeverity,
  scope: DiagnosticScope,
  confidence: ConfidenceScore,
  options: {
    sourceId?: SourceId;
    nativeId?: string;
    relatedEntityIds?: string[];
    metadata?: Record<string, DiagnosticMetadataValue>;
  } = {}
): Diagnostic {
  const idParts = {
    adapterId,
    nativeId: options.nativeId ?? code,
    ...(options.sourceId ? { sourceId: options.sourceId } : {})
  };

  return {
    id: createDiagnosticId(idParts),
    code,
    message,
    severity,
    scope,
    adapterId,
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.relatedEntityIds ? { relatedEntityIds: options.relatedEntityIds } : {}),
    confidence,
    ...(options.metadata ? { metadata: options.metadata } : {})
  };
}
