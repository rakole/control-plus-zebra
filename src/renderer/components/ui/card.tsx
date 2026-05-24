import * as React from "react"

import { cn } from "../../lib/utils.js"

export interface BentoItem {
  title: string
  description: string
  icon: React.ReactNode
  status?: string | undefined
  tags?: string[] | undefined
  meta?: string | undefined
  cta?: string | undefined
  colSpan?: number | undefined
  hasPersistentHover?: boolean | undefined
}

interface BentoGridProps extends React.ComponentProps<"div"> {
  items: readonly BentoItem[]
}

function Card({
  children,
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card relative flex flex-col gap-4 overflow-hidden rounded-lg border border-border/70 bg-card py-4 text-xs/relaxed text-card-foreground shadow-sm ring-1 ring-foreground/5 transition-all duration-300 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--foreground)_4%,transparent)_1px,transparent_1px)] before:bg-[length:4px_4px] before:opacity-0 before:transition-opacity before:duration-300 hover:-translate-y-0.5 hover:shadow-md hover:before:opacity-100 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("relative px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-lg px-4 group-data-[size=sm]/card:px-3 [.border-t]:pt-4 group-data-[size=sm]/card:[.border-t]:pt-3",
        className
      )}
      {...props}
    />
  )
}

function BentoGrid({ items, className, ...props }: BentoGridProps) {
  return (
    <div
      data-slot="bento-grid"
      className={cn("grid grid-cols-1 gap-3 md:grid-cols-3", className)}
      {...props}
    >
      {items.map((item, index) => (
        <div
          key={`${item.title}-${index}`}
          data-slot="bento-card"
          className={cn(
            "group/bento relative overflow-hidden rounded-lg border border-border/70 bg-card p-4 text-card-foreground shadow-sm transition-all duration-300 will-change-transform hover:-translate-y-0.5 hover:shadow-md",
            getBentoColSpanClass(item.colSpan),
            item.hasPersistentHover && "-translate-y-0.5 shadow-md"
          )}
        >
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--foreground)_4%,transparent)_1px,transparent_1px)] bg-[length:4px_4px] opacity-0 transition-opacity duration-300 group-hover/bento:opacity-100",
              item.hasPersistentHover && "opacity-100"
            )}
          />

          <div className="relative flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors duration-300 group-hover/bento:bg-accent group-hover/bento:text-accent-foreground">
                {item.icon}
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-300 group-hover/bento:bg-accent group-hover/bento:text-accent-foreground">
                {item.status ?? "Active"}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-[0.9375rem] font-medium tracking-normal text-card-foreground">
                {item.title}
                {item.meta ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {item.meta}
                  </span>
                ) : null}
              </h3>
              <p className="text-sm leading-snug font-normal text-muted-foreground">
                {item.description}
              </p>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {item.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-muted px-2 py-1 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/bento:opacity-100">
                {item.cta ?? "Explore ->"}
              </span>
            </div>
          </div>

          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-foreground/5 opacity-0 transition-opacity duration-300 group-hover/bento:opacity-100",
              item.hasPersistentHover && "opacity-100"
            )}
          />
        </div>
      ))}
    </div>
  )
}

function getBentoColSpanClass(colSpan: number | undefined): string | undefined {
  if (colSpan === 3) {
    return "md:col-span-3"
  }

  if (colSpan === 2) {
    return "md:col-span-2"
  }

  return undefined
}

export {
  BentoGrid,
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
