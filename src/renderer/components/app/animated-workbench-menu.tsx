import * as React from "react";
import { motion, type Variants, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router";

import { cn } from "../../lib/utils.js";

export interface AnimatedWorkbenchMenuItem {
  icon: LucideIcon;
  label: string;
  to: string;
}

export interface AnimatedWorkbenchMenuProps extends React.ComponentProps<typeof motion.nav> {
  items: readonly AnimatedWorkbenchMenuItem[];
  minimized?: boolean | undefined;
}

const menuVariants: Variants = {
  closed: {
    opacity: 0,
    transition: {
      duration: 0.18
    }
  },
  open: {
    opacity: 1,
    transition: {
      duration: 0.24,
      staggerChildren: 0.055,
      delayChildren: 0.04
    }
  }
};

const itemVariants: Variants = {
  closed: {
    opacity: 0,
    x: -18
  },
  open: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 28,
      mass: 0.8
    }
  }
};

const reduceMotionItemVariants: Variants = {
  closed: {
    opacity: 1,
    x: 0
  },
  open: {
    opacity: 1,
    x: 0
  }
};

export function AnimatedWorkbenchMenu({
  items,
  minimized = false,
  className,
  ...props
}: AnimatedWorkbenchMenuProps) {
  const shouldReduceMotion = useReducedMotion();
  const resolvedItemVariants = shouldReduceMotion ? reduceMotionItemVariants : itemVariants;

  return (
    <motion.nav
      aria-label="Workbench navigation"
      className={cn("flex flex-col gap-1", minimized && "items-center", className)}
      initial="closed"
      animate="open"
      variants={menuVariants}
      {...props}
    >
      {items.map((item) => (
        <motion.div key={item.label} variants={resolvedItemVariants}>
          <NavLink
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-2 overflow-hidden rounded-md px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                minimized && "size-11 justify-center px-0 py-0",
                isActive
                  ? "text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )
            }
            title={minimized ? item.label : undefined}
            to={item.to}
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-md bg-sidebar-accent"
                    layoutId="workbench-menu-active"
                    transition={{
                      type: "spring",
                      stiffness: 240,
                      damping: 30,
                      mass: 0.75
                    }}
                  />
                ) : null}
                <motion.span
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border/70 bg-sidebar text-sidebar-foreground transition-colors",
                    isActive
                      ? "border-sidebar-ring/30 bg-sidebar-primary text-sidebar-primary-foreground"
                      : "group-hover:border-sidebar-ring/20 group-hover:bg-sidebar-accent"
                  )}
                  {...(shouldReduceMotion
                    ? {}
                    : {
                        whileHover: { scale: 1.08, rotate: 4 },
                        whileTap: { scale: 0.96 }
                      })}
                >
                  <item.icon className="size-4" />
                </motion.span>
                <span className={cn("relative z-10 truncate", minimized && "sr-only")}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        </motion.div>
      ))}
    </motion.nav>
  );
}
