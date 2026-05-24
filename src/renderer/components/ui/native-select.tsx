import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "../../lib/utils.js";

function NativeSelect({
  className,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & {
  size?: "default" | "sm";
}) {
  return (
    <span
      data-slot="native-select-wrapper"
      className="relative inline-flex w-full min-w-0 items-center"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "w-full min-w-0 appearance-none rounded-md border border-input bg-input/20 px-2 pr-8 text-xs/relaxed text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=default]:h-7 data-[size=sm]:h-6 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground"
      />
    </span>
  );
}

export { NativeSelect };
