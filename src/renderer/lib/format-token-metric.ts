interface TokenMetricValueLike {
  displayValue: string;
  numericValue?: number | undefined;
  status?: string | undefined;
}

function formatCompactLong(value: number, divisor: number, unit: "million" | "billion"): string {
  const scaled = value / divisor;
  const rounded = Number.parseFloat(scaled.toFixed(2));

  return `${rounded} ${unit}`;
}

export function formatTokenMetric(metric: TokenMetricValueLike): string {
  if (
    metric.status !== "value" ||
    typeof metric.numericValue !== "number" ||
    !Number.isFinite(metric.numericValue)
  ) {
    return metric.displayValue;
  }

  if (metric.numericValue >= 1_000_000_000) {
    return formatCompactLong(metric.numericValue, 1_000_000_000, "billion");
  }

  if (metric.numericValue >= 1_000_000) {
    return formatCompactLong(metric.numericValue, 1_000_000, "million");
  }

  return metric.displayValue;
}
