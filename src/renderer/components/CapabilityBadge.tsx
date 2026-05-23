type CapabilityState = "Supported" | "Unsupported" | "Unknown";

interface CapabilityBadgeProps {
  label?: string;
  state: CapabilityState;
  reason?: string;
}

export function CapabilityBadge({ label, state, reason }: CapabilityBadgeProps) {
  const className =
    state === "Supported"
      ? "capability-badge capability-badge-supported"
      : "capability-badge capability-badge-neutral";

  return (
    <span className={className} title={reason ?? label} aria-label={label ? `${label}: ${state}` : state}>
      {state}
    </span>
  );
}
