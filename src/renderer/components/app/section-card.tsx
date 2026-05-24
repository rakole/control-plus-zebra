import * as React from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription
} from "../ui/card.js";

export interface SectionCardProps
  extends Omit<React.ComponentProps<typeof Card>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string | undefined;
}

export function SectionCard({
  title,
  description,
  actions,
  footer,
  children,
  contentClassName,
  ...props
}: SectionCardProps) {
  return (
    <Card {...props}>
      {title || description || actions ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {actions ? <CardAction>{actions}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={contentClassName}>{children}</CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
