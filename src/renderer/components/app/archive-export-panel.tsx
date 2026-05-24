import * as React from "react";
import { AlertTriangleIcon, ArchiveIcon } from "lucide-react";

import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.js";
import { cn } from "../../lib/utils.js";

const DEFAULT_PRIVACY_WARNING_BODY =
  "Transcripts, sidecars, repo paths, and command output may contain sensitive local information. Export raw artifacts only when that data is intentionally shareable.";

export interface ArchiveExportPanelProps extends React.ComponentProps<"section"> {
  summary: React.ReactNode;
  toggleLabel: string;
  exportLabel: string;
  includeRawArtifacts: boolean;
  onIncludeRawArtifactsChange(nextValue: boolean): void;
  isOpen: boolean;
  onToggle(): void;
  onExport(): void;
  isExporting?: boolean | undefined;
  exportMessage?: React.ReactNode;
  errorMessage?: React.ReactNode;
  rawArtifactsAvailable: boolean;
  rawArtifactCount: number;
  rawArtifactsReason?: string | undefined;
  privacyWarningTitle?: React.ReactNode;
  privacyWarningBody?: React.ReactNode;
}

export function ArchiveExportPanel({
  summary,
  toggleLabel,
  exportLabel,
  includeRawArtifacts,
  onIncludeRawArtifactsChange,
  isOpen,
  onToggle,
  onExport,
  isExporting = false,
  exportMessage,
  errorMessage,
  rawArtifactsAvailable,
  rawArtifactCount,
  rawArtifactsReason,
  privacyWarningTitle = "Raw artifacts may include sensitive local data",
  privacyWarningBody = DEFAULT_PRIVACY_WARNING_BODY,
  className,
  ...props
}: ArchiveExportPanelProps) {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{summary}</p>
          {exportMessage ? (
            <p className="text-xs/relaxed text-muted-foreground">{exportMessage}</p>
          ) : null}
        </div>
        <Button onClick={onToggle} type="button" variant={isOpen ? "secondary" : "default"}>
          <ArchiveIcon aria-hidden="true" />
          {toggleLabel}
        </Button>
      </div>

      {isOpen ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Normalized Only</Badge>
            {rawArtifactsAvailable ? (
              <Badge variant="outline">{rawArtifactCount} indexed raw artifacts</Badge>
            ) : null}
          </div>

          <label
            className={cn(
              "flex items-start gap-3 rounded-md border border-border bg-background px-3 py-3",
              !rawArtifactsAvailable && "opacity-70"
            )}
          >
            <Checkbox
              checked={includeRawArtifacts}
              disabled={!rawArtifactsAvailable}
              onCheckedChange={(checked) => onIncludeRawArtifactsChange(checked === true)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Include Raw Artifacts</span>
              <span className="block text-xs/relaxed text-muted-foreground">
                {rawArtifactsAvailable
                  ? `${rawArtifactCount} indexed raw artifacts are available for this archive scope.`
                  : rawArtifactsReason}
              </span>
            </span>
          </label>

          <Alert>
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>{privacyWarningTitle}</AlertTitle>
            <AlertDescription>{privacyWarningBody}</AlertDescription>
          </Alert>

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>Archive export failed</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isExporting} onClick={onExport} type="button">
              {isExporting ? "Exporting..." : exportLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
