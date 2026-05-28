import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card.js";
import { GlowCard, type GlowCardProps } from "../ui/glow-card.js";

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  supportingText?: React.ReactNode;
  variant?: "default" | "glow";
  glowColor?: GlowCardProps["glowColor"];
  customSize?: GlowCardProps["customSize"];
  width?: GlowCardProps["width"];
  height?: GlowCardProps["height"];
  size?: GlowCardProps["size"];
}

export function MetricCard({
  label,
  value,
  supportingText,
  variant = "default",
  glowColor = "blue",
  customSize,
  width,
  height,
  size,
  className,
  ...props
}: MetricCardProps) {
  const sharedProps = {
    role: "group" as const,
    ...(typeof label === "string" ? { "aria-label": label } : {}),
    className
  };

  const content = (
    <>
      <CardHeader className="gap-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold">{value}</CardTitle>
      </CardHeader>
      {supportingText ? (
        <CardContent className="pt-0 text-xs/relaxed text-muted-foreground">
          {supportingText}
        </CardContent>
      ) : null}
    </>
  );

  if (variant === "glow") {
    return (
      <GlowCard
        {...sharedProps}
        {...props}
        {...(customSize !== undefined ? { customSize } : {})}
        {...(glowColor !== undefined ? { glowColor } : {})}
        {...(height !== undefined ? { height } : {})}
        {...(size !== undefined ? { size } : {})}
        {...(width !== undefined ? { width } : {})}
      >
        {content}
      </GlowCard>
    );
  }

  return (
    <Card
      {...sharedProps}
      {...props}
    >
      {content}
    </Card>
  );
}
