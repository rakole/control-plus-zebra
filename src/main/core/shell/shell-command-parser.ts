import {
  HIGH_CONFIDENCE,
  LOW_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  type ConfidenceLevel,
  type ConfidenceScore
} from "../model/confidence.js";

import { extractExitCodeFromText } from "./exit-code-parser.js";
import { classifyShellIntent } from "./intent-classifier.js";
import type {
  ParseShellCommandEvidenceInput,
  ParsedShellCommand,
  ShellCommandResult,
  ShellExitCodeSource,
  ShellOutputTextSource
} from "./types.js";

export function parseShellCommandEvidence(
  input: ParseShellCommandEvidenceInput
): ParsedShellCommand {
  const relatedDiagnostics = dedupeDiagnosticIds(input.relatedDiagnostics ?? []);
  const summaryText = input.shellCommand.outputSummary?.trim();
  const artifactTexts = (input.artifacts ?? [])
    .map((artifact) => artifact.text?.trim())
    .filter((text): text is string => Boolean(text && text.length > 0));
  const outputTextSource = determineOutputTextSource(summaryText, artifactTexts);
  const combinedText = buildCombinedText(summaryText, artifactTexts);
  const parsedExitCode =
    input.shellCommand.exitCode === undefined && combinedText
      ? extractExitCodeFromText(combinedText)
      : undefined;
  const exitCode = input.shellCommand.exitCode ?? parsedExitCode;
  const exitCodeSource = determineExitCodeSource({
    explicitExitCode: input.shellCommand.exitCode,
    outputTextSource,
    parsedExitCode
  });
  const failureMarkers = collectFailureMarkers(combinedText);
  const result = determineCommandResult({
    exitCode,
    failureMarkers,
    rawToolStatus: input.shellCommand.rawToolStatus
  });
  const confidence = determineConfidence({
    exitCodeSource,
    hasDiagnostics: relatedDiagnostics.length > 0,
    outputTextSource,
    result
  });

  return {
    shellCommandId: input.shellCommand.id,
    command: input.shellCommand.command,
    ...(input.shellCommand.cwd ? { cwd: input.shellCommand.cwd } : {}),
    intent: classifyShellIntent(input.shellCommand.command),
    result,
    outputSource: input.shellCommand.outputSource,
    outputTextSource,
    ...(exitCode !== undefined ? { exitCode } : {}),
    exitCodeSource,
    ...(input.shellCommand.rawToolStatus ? { rawToolStatus: input.shellCommand.rawToolStatus } : {}),
    ...(input.shellCommand.toolCallId ? { toolCallId: input.shellCommand.toolCallId } : {}),
    ...(input.shellCommand.artifactIds?.length
      ? { artifactIds: input.shellCommand.artifactIds }
      : {}),
    failureMarkers,
    confidence,
    ...(relatedDiagnostics.length > 0 ? { diagnosticIds: relatedDiagnostics } : {})
  };
}

function buildCombinedText(summaryText?: string, artifactTexts: string[] = []): string | undefined {
  const parts = [
    ...(summaryText ? [summaryText] : []),
    ...artifactTexts
  ];

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n\n");
}

function determineOutputTextSource(
  summaryText: string | undefined,
  artifactTexts: string[]
): ShellOutputTextSource {
  if (summaryText && artifactTexts.length > 0) {
    return "artifact+summary";
  }

  if (artifactTexts.length > 0) {
    return "artifact";
  }

  if (summaryText) {
    return "summary";
  }

  return "missing";
}

function determineExitCodeSource(args: {
  explicitExitCode: number | undefined;
  outputTextSource: ShellOutputTextSource;
  parsedExitCode: number | undefined;
}): ShellExitCodeSource {
  if (args.explicitExitCode !== undefined) {
    return "evidence";
  }

  if (args.parsedExitCode === undefined) {
    return "unknown";
  }

  switch (args.outputTextSource) {
    case "artifact":
    case "summary":
    case "artifact+summary":
      return args.outputTextSource;
    case "missing":
      return "unknown";
  }
}

function determineCommandResult(args: {
  exitCode: number | undefined;
  failureMarkers: string[];
  rawToolStatus: string | undefined;
}): ShellCommandResult {
  if (args.exitCode !== undefined) {
    return args.exitCode === 0 ? "passed" : "failed";
  }

  if (args.rawToolStatus === "succeeded" && args.failureMarkers.length === 0) {
    return "passed";
  }

  return "unknown";
}

function collectFailureMarkers(text?: string): string[] {
  if (!text) {
    return [];
  }

  const patterns = [
    /\bfailed\b/iu,
    /\berror\b/iu,
    /\bexception\b/iu,
    /\bnot found\b/iu
  ];

  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source.replaceAll("\\b", ""))
    .map((marker) => marker.replaceAll("\\", ""))
    .map((marker) => marker.replaceAll("iu", ""));
}

function determineConfidence(args: {
  exitCodeSource: ShellExitCodeSource;
  hasDiagnostics: boolean;
  outputTextSource: ShellOutputTextSource;
  result: ShellCommandResult;
}): ConfidenceScore {
  let level: ConfidenceLevel;

  if (args.exitCodeSource === "evidence" && args.result !== "unknown") {
    level = "high";
  } else if (
    args.result === "passed" &&
    (args.outputTextSource === "artifact" || args.outputTextSource === "artifact+summary")
  ) {
    level = "medium";
  } else if (args.result === "passed" || args.exitCodeSource !== "unknown") {
    level = "medium";
  } else if (args.outputTextSource === "missing") {
    level = "low";
  } else {
    level = "low";
  }

  if (args.hasDiagnostics) {
    level = downgradeConfidence(level);
  }

  switch (level) {
    case "high":
      return HIGH_CONFIDENCE;
    case "medium":
      return MEDIUM_CONFIDENCE;
    case "low":
      return LOW_CONFIDENCE;
    default:
      return LOW_CONFIDENCE;
  }
}

function downgradeConfidence(level: ConfidenceLevel): ConfidenceLevel {
  switch (level) {
    case "high":
      return "medium";
    case "medium":
      return "low";
    case "low":
    case "unknown":
      return "low";
  }
}

function dedupeDiagnosticIds(
  diagnostics: Array<{ id: string }>
): string[] {
  return [...new Set(diagnostics.map((diagnostic) => diagnostic.id))];
}
