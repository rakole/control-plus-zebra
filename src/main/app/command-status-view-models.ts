import type { ParsedShellCommand } from "../core/shell/types.js";
import type { ShellCommandEvidence } from "../core/model/entities.js";
import type { TruthStateTone } from "../ipc/view-models.js";

export interface CommandDisplayStatus {
  isFailure: boolean;
  label: "Cancelled" | "Failed" | "Running" | "Succeeded" | "Unknown";
  tone: TruthStateTone;
}

function normalizeRawStatus(
  status: ParsedShellCommand["rawToolStatus"] | ShellCommandEvidence["rawStatus"] | undefined
): ParsedShellCommand["rawToolStatus"] | undefined {
  switch (status) {
    case "success":
    case "completed":
      return "succeeded";
    case "error":
      return "failed";
    case "pending":
    case "running":
      return "started";
    case "started":
    case "succeeded":
    case "failed":
    case "cancelled":
    case "unknown":
      return status;
    default:
      return undefined;
  }
}

export function getCommandDisplayStatus(args: {
  parsedShellCommand?: ParsedShellCommand;
  shellCommand?: Pick<ShellCommandEvidence, "rawExitCode" | "rawStatus">;
}): CommandDisplayStatus {
  const rawStatus = normalizeRawStatus(
    args.parsedShellCommand?.rawToolStatus ?? args.shellCommand?.rawStatus
  );
  const exitCode = args.parsedShellCommand?.exitCode ?? args.shellCommand?.rawExitCode;
  const parsedResult = args.parsedShellCommand?.result;

  if (exitCode !== undefined) {
    return exitCode === 0
      ? { label: "Succeeded", tone: "positive", isFailure: false }
      : { label: "Failed", tone: "danger", isFailure: true };
  }

  if (parsedResult === "failed" || rawStatus === "failed") {
    return { label: "Failed", tone: "danger", isFailure: true };
  }

  if (rawStatus === "cancelled") {
    return { label: "Cancelled", tone: "warning", isFailure: false };
  }

  if (rawStatus === "started") {
    return { label: "Running", tone: "info", isFailure: false };
  }

  if (parsedResult === "passed" || rawStatus === "succeeded") {
    return { label: "Succeeded", tone: "positive", isFailure: false };
  }

  return { label: "Unknown", tone: "neutral", isFailure: false };
}
