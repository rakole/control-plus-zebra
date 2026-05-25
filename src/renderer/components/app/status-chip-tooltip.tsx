import type { ReactElement } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../ui/tooltip.js";

interface StatusChipTooltipProps {
  children: ReactElement;
  tooltip: string;
}

export function StatusChipTooltip({
  children,
  tooltip
}: StatusChipTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
