import type { StatusTone } from "../../components/app/status.js";
import type { DiagnosticSeverity } from "../../bridge/data-sources.js";

export function formatDiagnosticCount(count: number): string {
  return `${count} Diagnostic${count === 1 ? "" : "s"}`;
}

export function toneForSourceLabel(label: string): StatusTone {
  switch (label) {
    case "Enabled":
    case "Valid":
    case "Scanned":
    case "Cached":
    case "Watch Supported":
      return "success";
    case "Disabled":
    case "Scanned with Diagnostics":
    case "Stale":
      return "warning";
    case "Invalid":
    case "Scan Failed":
    case "Error":
      return "destructive";
    case "Unsupported":
    case "Read Only":
    case "Watch Unsupported":
      return "unsupported";
    case "Info":
      return "info";
    default:
      return "neutral";
  }
}

export function toneForDiagnosticSeverity(severity: DiagnosticSeverity): StatusTone {
  switch (severity) {
    case "error":
      return "destructive";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}
