import * as React from "react";
import { InboxIcon } from "lucide-react";

import {
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyTitle,
  EmptyVisual
} from "../ui/empty.js";

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  visual?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  visual
}: EmptyStateProps) {
  return (
    <Empty>
      <EmptyVisual>
        {visual ?? <InboxIcon className="size-5" />}
      </EmptyVisual>
      <div className="space-y-1">
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </div>
      {action ? <EmptyActions>{action}</EmptyActions> : null}
    </Empty>
  );
}
