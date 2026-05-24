export const statusToneClassNames = {
  neutral:
    "border-status-neutral/25 bg-status-neutral/15 text-status-neutral-foreground",
  success:
    "border-status-success/25 bg-status-success/15 text-status-success-foreground",
  warning:
    "border-status-warning/25 bg-status-warning/15 text-status-warning-foreground",
  danger:
    "border-status-danger/25 bg-status-danger/15 text-status-danger-foreground",
  info: "border-status-info/25 bg-status-info/15 text-status-info-foreground",
  unsupported:
    "border-status-unsupported/25 bg-status-unsupported/15 text-status-unsupported-foreground",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive"
} as const;

export type StatusTone = keyof typeof statusToneClassNames;

export type TruthBadgeTone =
  | "neutral"
  | "positive"
  | "warning"
  | "danger"
  | "info"
  | "unsupported";

export function mapTruthBadgeTone(tone: TruthBadgeTone): StatusTone {
  if (tone === "positive") {
    return "success";
  }

  return tone;
}
