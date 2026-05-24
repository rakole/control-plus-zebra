import * as React from "react";
import { LoaderCircleIcon } from "lucide-react";

import { cn } from "../../lib/utils.js";

function Spinner({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof LoaderCircleIcon> & {
  size?: "sm" | "default" | "lg";
}) {
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      aria-hidden="true"
      className={cn(
        "animate-spin text-muted-foreground",
        size === "sm" && "size-3.5",
        size === "default" && "size-4",
        size === "lg" && "size-5",
        className
      )}
      {...props}
    />
  );
}

export { Spinner };
