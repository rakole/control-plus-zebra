import * as React from "react";

import { cn } from "../../lib/utils.js";

const glowPalette = {
  blue: {
    core: "hsl(210 95% 72% / 0.3)",
    fill: "hsl(210 95% 62% / 0.18)",
    ring: "hsl(210 95% 68% / 0.2)"
  },
  purple: {
    core: "hsl(275 90% 75% / 0.28)",
    fill: "hsl(275 90% 65% / 0.16)",
    ring: "hsl(275 90% 70% / 0.18)"
  },
  green: {
    core: "hsl(155 80% 68% / 0.28)",
    fill: "hsl(155 80% 48% / 0.16)",
    ring: "hsl(155 80% 58% / 0.18)"
  },
  red: {
    core: "hsl(8 92% 72% / 0.28)",
    fill: "hsl(8 92% 60% / 0.16)",
    ring: "hsl(8 92% 66% / 0.18)"
  },
  orange: {
    core: "hsl(32 95% 72% / 0.28)",
    fill: "hsl(32 95% 60% / 0.16)",
    ring: "hsl(32 95% 66% / 0.18)"
  }
} as const;

const sizeMap = {
  sm: "w-48 h-64",
  md: "w-64 h-80",
  lg: "w-80 h-96"
} as const;

export interface GlowCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glowColor?: keyof typeof glowPalette;
  size?: keyof typeof sizeMap;
  width?: string | number;
  height?: string | number;
  customSize?: boolean;
}

type GlowCardStyle = React.CSSProperties & {
  "--glow-x"?: string;
  "--glow-y"?: string;
  "--glow-core"?: string;
  "--glow-fill"?: string;
  "--glow-ring"?: string;
};

export const GlowCard = React.forwardRef<HTMLDivElement, GlowCardProps>(function GlowCard(
  {
    children,
    className,
    glowColor = "blue",
    size = "md",
    width,
    height,
    customSize = false,
    onPointerLeave,
    onPointerMove,
    style,
    ...props
  },
  ref
) {
  const innerRef = React.useRef<HTMLDivElement | null>(null);

  const syncGlowPosition = React.useCallback((x: string, y: string) => {
    if (!innerRef.current) {
      return;
    }

    innerRef.current.style.setProperty("--glow-x", x);
    innerRef.current.style.setProperty("--glow-y", y);
  }, []);

  React.useEffect(() => {
    syncGlowPosition("50%", "50%");
  }, [syncGlowPosition]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    syncGlowPosition(`${event.clientX - bounds.left}px`, `${event.clientY - bounds.top}px`);
    onPointerMove?.(event);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    syncGlowPosition("50%", "50%");
    onPointerLeave?.(event);
  };

  const palette = glowPalette[glowColor];
  const cardStyle: GlowCardStyle = {
    "--glow-core": palette.core,
    "--glow-fill": palette.fill,
    "--glow-ring": palette.ring,
    "--glow-x": "50%",
    "--glow-y": "50%",
    ...style
  };

  if (width !== undefined) {
    cardStyle.width = typeof width === "number" ? `${width}px` : width;
  }

  if (height !== undefined) {
    cardStyle.height = typeof height === "number" ? `${height}px` : height;
  }

  return (
    <div
      ref={(node) => {
        innerRef.current = node;

        if (typeof ref === "function") {
          ref(node);
          return;
        }

        if (ref) {
          ref.current = node;
        }
      }}
      data-slot="glow-card"
      className={cn(
        "group/glow relative flex flex-col gap-4 overflow-hidden rounded-lg border border-border/70 bg-card/95 py-4 text-xs/relaxed text-card-foreground shadow-sm ring-1 ring-foreground/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
        !customSize && sizeMap[size],
        className
      )}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      style={cardStyle}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-90 transition-opacity duration-300 group-hover/glow:opacity-100"
        style={{
          backgroundImage:
            "radial-gradient(220px circle at var(--glow-x) var(--glow-y), var(--glow-fill), transparent 72%)"
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-px rounded-[calc(theme(borderRadius.lg)-1px)] opacity-80 transition-opacity duration-300 group-hover/glow:opacity-100 dark:opacity-65"
        style={{
          backgroundImage:
            "radial-gradient(140px circle at var(--glow-x) var(--glow-y), var(--glow-core), transparent 62%)",
          boxShadow: "inset 0 0 0 1px var(--glow-ring)"
        }}
      />
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  );
});
