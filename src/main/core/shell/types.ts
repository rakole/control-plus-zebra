import type { ConfidenceScore } from "../model/confidence.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { LoadedOutputArtifact } from "../adapter-contract/types.js";
import type { CommandOutputSource, ShellCommandEvidence, ToolCallStatus } from "../model/entities.js";
import type {
  OutputArtifactId,
  ShellCommandEvidenceId,
  ToolCallId
} from "../model/identifiers.js";

export type ShellCommandIntent =
  | "test"
  | "build"
  | "typecheck"
  | "lint"
  | "install"
  | "git"
  | "other"
  | "unknown";

export type ShellCommandResult = "passed" | "failed" | "unknown";

export type ShellOutputTextSource = "artifact" | "summary" | "artifact+summary" | "missing";

export type ShellExitCodeSource =
  | "evidence"
  | "artifact"
  | "summary"
  | "artifact+summary"
  | "unknown";

export interface ShellArtifactContent {
  artifactId: OutputArtifactId;
  mediaType?: string;
  text?: string;
}

export interface ParseShellCommandEvidenceInput {
  artifacts?: ShellArtifactContent[];
  relatedDiagnostics?: Diagnostic[];
  shellCommand: ShellCommandEvidence;
}

export interface ParsedShellCommand {
  shellCommandId: ShellCommandEvidenceId;
  command: string;
  cwd?: string;
  intent: ShellCommandIntent;
  result: ShellCommandResult;
  outputSource: CommandOutputSource;
  outputTextSource: ShellOutputTextSource;
  exitCode?: number;
  exitCodeSource: ShellExitCodeSource;
  rawToolStatus?: ToolCallStatus;
  toolCallId?: ToolCallId;
  artifactIds?: OutputArtifactId[];
  failureMarkers: string[];
  confidence: ConfidenceScore;
  diagnosticIds?: string[];
}

export interface LoadedArtifactDiagnostics {
  diagnostics: Diagnostic[];
  loadedArtifacts: ShellArtifactContent[];
}

export interface ShellArtifactLoadContext {
  loadOutputArtifact?: (
    artifactId: OutputArtifactId
  ) => Promise<LoadedOutputArtifact | undefined>;
  shellCommand: ShellCommandEvidence;
}
