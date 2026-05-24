interface TruthStateView {
  label: string;
  tone: "neutral" | "positive" | "warning" | "danger" | "info";
  reason?: string | undefined;
}

interface TruthStateBadgeProps {
  state: TruthStateView;
}

export function TruthStateBadge({ state }: TruthStateBadgeProps) {
  return (
    <span
      className={`truth-badge truth-badge-${state.tone}`}
      title={state.reason ?? state.label}
      aria-label={state.label}
    >
      {state.label}
    </span>
  );
}
