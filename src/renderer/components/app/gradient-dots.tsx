import * as React from "react";
import { motion } from "framer-motion";

import { cn } from "../../lib/utils.js";

export interface GradientDotsProps extends React.ComponentProps<typeof motion.div> {
  dotSize?: number | undefined;
  spacing?: number | undefined;
  duration?: number | undefined;
  colorCycleDuration?: number | undefined;
  backgroundColor?: string | undefined;
}

export function GradientDots({
  dotSize = 8,
  spacing = 10,
  duration = 30,
  colorCycleDuration = 6,
  backgroundColor = "var(--background)",
  className,
  style,
  ...props
}: GradientDotsProps) {
  const hexSpacing = spacing * 1.732;

  return (
    <motion.div
      aria-hidden="true"
      className={cn("absolute inset-0", className)}
      style={{
        backgroundColor,
        backgroundImage: `
          radial-gradient(circle at 50% 50%, transparent 1.5px, ${backgroundColor} 0 ${dotSize}px, transparent ${dotSize}px),
          radial-gradient(circle at 50% 50%, transparent 1.5px, ${backgroundColor} 0 ${dotSize}px, transparent ${dotSize}px),
          radial-gradient(circle at 50% 50%, var(--status-danger), transparent 60%),
          radial-gradient(circle at 50% 50%, var(--status-warning), transparent 60%),
          radial-gradient(circle at 50% 50%, var(--status-success), transparent 60%),
          radial-gradient(ellipse at 50% 50%, var(--status-info), transparent 60%)
        `,
        backgroundSize: `
          ${spacing}px ${hexSpacing}px,
          ${spacing}px ${hexSpacing}px,
          200% 200%,
          200% 200%,
          200% 200%,
          200% ${hexSpacing}px
        `,
        backgroundPosition: `
          0px 0px,
          ${spacing / 2}px ${hexSpacing / 2}px,
          0% 0%,
          0% 0%,
          0% 0%,
          0% 0%
        `,
        ...style
      }}
      animate={{
        backgroundPosition: [
          `
            0px 0px,
            ${spacing / 2}px ${hexSpacing / 2}px,
            800% 400%,
            1000% -400%,
            -1200% -600%,
            400% ${hexSpacing}px
          `,
          `
            0px 0px,
            ${spacing / 2}px ${hexSpacing / 2}px,
            0% 0%,
            0% 0%,
            0% 0%,
            0% 0%
          `
        ],
        filter: ["hue-rotate(0deg)", "hue-rotate(360deg)"]
      }}
      transition={{
        backgroundPosition: {
          duration,
          ease: "linear",
          repeat: Number.POSITIVE_INFINITY
        },
        filter: {
          duration: colorCycleDuration,
          ease: "linear",
          repeat: Number.POSITIVE_INFINITY
        }
      }}
      {...props}
    />
  );
}
