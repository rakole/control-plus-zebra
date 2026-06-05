import type { ReactNode } from "react";

import { cn } from "../../../lib/utils.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../components/ui/card.js";
import { Progress } from "../../../components/ui/progress.js";

export interface UsageCoverageCardMetric {
  change?: string;
  icon: ReactNode;
  progress?: number;
  title: string;
  value: ReactNode;
}

interface UsageCoverageCardsProps {
  className?: string;
  metrics: UsageCoverageCardMetric[];
}

export function UsageCoverageCards({
  metrics,
  className
}: UsageCoverageCardsProps) {
  return (
    <div
      aria-label="Usage coverage metrics"
      className={cn("grid gap-x-4 gap-y-1 sm:grid-cols-2", className)}
    >
      {metrics.map((metric) => (
        <Card
          key={metric.title}
          className="bg-card/95 font-mono backdrop-blur-sm"
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {metric.title}
              </CardTitle>
              <span className="text-sm font-semibold tracking-tight text-foreground/80">
                {metric.icon}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-1 text-2xl font-semibold tracking-tight">
              {metric.value}
            </div>
            {metric.change ? (
              <p className="mb-2 text-[10px] text-muted-foreground">
                {metric.change}
              </p>
            ) : null}
            {metric.progress !== undefined ? (
              <Progress
                className="h-2"
                value={metric.progress}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
