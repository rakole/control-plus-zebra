interface SourceStatusBadgeProps {
  label: string;
  title?: string | undefined;
  tone?: "neutral" | "destructive";
}

export function SourceStatusBadge({
  label,
  title,
  tone = "neutral"
}: SourceStatusBadgeProps) {
  const className =
    tone === "destructive"
      ? "source-status-badge source-status-badge-destructive"
      : "source-status-badge source-status-badge-neutral";

  return (
    <span className={className} title={title ?? label}>
      {label}
    </span>
  );
}
