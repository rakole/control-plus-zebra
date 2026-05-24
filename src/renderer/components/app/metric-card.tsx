import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card.js";

export interface MetricCardProps extends React.ComponentProps<typeof Card> {
  label: React.ReactNode;
  value: React.ReactNode;
  supportingText?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
    supportingText,
    ...props
}: MetricCardProps) {
  return (
    <Card
      role="group"
      {...(typeof label === "string" ? { "aria-label": label } : {})}
      {...props}
    >
      <CardHeader className="gap-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold">{value}</CardTitle>
      </CardHeader>
      {supportingText ? (
        <CardContent className="pt-0 text-xs/relaxed text-muted-foreground">
          {supportingText}
        </CardContent>
      ) : null}
    </Card>
  );
}
