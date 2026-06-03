interface TruthStateLike {
  label: string;
  reason?: string | undefined;
}

interface FieldValueLike {
  displayValue: string;
  reason?: string | undefined;
}

interface MetricValueLike {
  displayValue: string;
  reason?: string | undefined;
}

interface CapabilityLike {
  label: string;
  state: string;
  reason?: string | undefined;
}

export function getTruthTooltip(label: string, state: TruthStateLike): string {
  return state.reason ? `${label}: ${state.label}. ${state.reason}` : `${label}: ${state.label}`;
}

export function getFieldTooltip(label: string, field: FieldValueLike): string {
  return field.reason
    ? `${label}: ${field.displayValue}. ${field.reason}`
    : `${label}: ${field.displayValue}`;
}

export function getMetricTooltip(
  label: string,
  metric: MetricValueLike,
  suffix?: string
): string {
  const value = suffix ? `${metric.displayValue} ${suffix}` : metric.displayValue;

  return metric.reason ? `${label}: ${value}. ${metric.reason}` : `${label}: ${value}`;
}

export function getCapabilityTooltip(capability: CapabilityLike): string {
  return capability.reason
    ? `${capability.label}: ${capability.state}. ${capability.reason}`
    : `${capability.label}: ${capability.state}`;
}
