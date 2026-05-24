import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle
} from "../ui/alert.js";

export interface ErrorStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function ErrorState({
  title,
  description,
  action
}: ErrorStateProps) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon className="size-4" />
      <AlertTitle>
        <h2 className="text-sm font-medium">{title}</h2>
      </AlertTitle>
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}
