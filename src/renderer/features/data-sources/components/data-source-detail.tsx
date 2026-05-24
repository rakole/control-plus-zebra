import { useEffect } from "react";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "../../../components/ui/button.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle
} from "../../../components/ui/field.js";
import { Input } from "../../../components/ui/input.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { Switch } from "../../../components/ui/switch.js";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert.js";
import { DiagnosticsList } from "../../../components/app/diagnostics-list.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { SourceStateBadge } from "../../../components/app/source-state-badge.js";
import type { DataSourceAdapterOption } from "../../../bridge/data-sources.js";
import { formatDiagnosticCount, toneForSourceLabel } from "../status.js";
import type { DataSourceEditorState } from "../types.js";

interface DataSourceDetailProps {
  adapters: DataSourceAdapterOption[];
  source: DataSourceEditorState | null;
  canValidate: boolean;
  canScan: boolean;
  isBusy: boolean;
  pathAutoFocusKey: string | null;
  onAdapterChange(adapterId: string): void;
  onEnabledChange(enabled: boolean): void;
  onSourceNameChange(value: string): void;
  onRootPathChange(value: string): void;
  onValidate(): void;
  onScan(): void;
}

const detailEmptyCopy =
  "Select a data source to inspect validation, scan, cache, and watcher status.";
const validationFailureCopy =
  "Source validation failed. Review the diagnostics, update the path, then validate again.";
const scanFailureCopy =
  "Scan failed. Review source, adapter, cache, and normalization diagnostics, then rescan when the source is ready.";

export function DataSourceDetail({
  adapters,
  source,
  canValidate,
  canScan,
  isBusy,
  pathAutoFocusKey,
  onAdapterChange,
  onEnabledChange,
  onSourceNameChange,
  onRootPathChange,
  onValidate,
  onScan
}: DataSourceDetailProps) {
  if (!source) {
    return (
      <section aria-label="Selected data source detail" className="flex h-full items-center p-4">
        <EmptyState title={detailEmptyCopy} />
      </section>
    );
  }

  const title = source.sourceName?.trim() || source.rootPath || "Draft source";
  const showValidationAlert = source.validation.label === "Invalid";
  const showScanAlert = source.scan.label === "Scan Failed";
  const isReadOnly = source.readOnly;
  const scanButtonLabel = isReadOnly
    ? "Scan Unavailable"
    : source.hasCompletedScan
      ? "Rescan Source"
      : "Scan Source";
  const adapterOptions = adapters.some((adapter) => adapter.adapterId === source.adapterId)
    ? adapters
    : [
        {
          adapterId: source.adapterId,
          displayName: source.adapterDisplayName
        },
        ...adapters
      ];

  useEffect(() => {
    if (pathAutoFocusKey !== source.sourceId) {
      return;
    }

    document.getElementById("source-root-path")?.focus();
  }, [pathAutoFocusKey, source.sourceId]);

  return (
    <section aria-label="Selected data source detail" className="h-full overflow-auto">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
              {source.adapterDisplayName}
            </p>
            <h2 className="break-words text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {source.readOnlyLabel ? (
              <SourceStateBadge
                label={source.readOnlyLabel}
                tone={toneForSourceLabel(source.readOnlyLabel)}
              />
            ) : null}
            <SourceStateBadge
              label={source.enabledLabel}
              tone={toneForSourceLabel(source.enabledLabel)}
            />
          </div>
        </div>

        <SectionCard title={<h3>Source Metadata</h3>} contentClassName="space-y-4">
          <MetadataGrid
            items={[
              { label: "Source Kind", value: source.sourceKind },
              { label: "Added By", value: source.addedBy }
            ]}
          />
          {source.readOnlyReason ? (
            <p className="text-xs/relaxed text-muted-foreground">{source.readOnlyReason}</p>
          ) : null}
        </SectionCard>

        {source.archiveMetadata ? (
          <SectionCard title={<h3>Archive Metadata</h3>}>
            <MetadataGrid
              items={[
                { label: "Archive Path", value: source.archiveMetadata.archivePath },
                { label: "Archive Scope", value: source.archiveMetadata.scopeLabel },
                { label: "Manifest Version", value: String(source.archiveMetadata.manifestVersion) },
                { label: "Imported At", value: source.archiveMetadata.importedAt },
                { label: "Exported At", value: source.archiveMetadata.exportedAt },
                { label: "Archived Sessions", value: String(source.archiveMetadata.sessionCount) }
              ]}
            />
          </SectionCard>
        ) : null}

        <SectionCard title={<h3>Source Settings</h3>}>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="source-harness">Harness</FieldLabel>
                <NativeSelect
                  id="source-harness"
                  aria-label="Harness"
                  disabled={isReadOnly}
                  onChange={(event) => onAdapterChange(event.target.value)}
                  value={source.adapterId}
                >
                  {adapterOptions.map((adapter) => (
                    <option key={adapter.adapterId} value={adapter.adapterId}>
                      {adapter.displayName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field>
                <FieldLabel htmlFor="source-name">Source Name</FieldLabel>
                <Input
                  id="source-name"
                  aria-label="Source Name"
                  disabled={isReadOnly}
                  onChange={(event) => onSourceNameChange(event.target.value)}
                  type="text"
                  value={source.sourceName ?? ""}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="source-root-path">Source Root Path</FieldLabel>
              <Input
                id="source-root-path"
                aria-label="Source Root Path"
                disabled={isReadOnly}
                onChange={(event) => onRootPathChange(event.target.value)}
                type="text"
                value={source.rootPath}
              />
              <FieldDescription>
                {isReadOnly
                  ? "Imported archives keep the original archive path and remain read-only after import."
                  : "Enter a local source root path. Validation runs through the shared source registry."}
              </FieldDescription>
            </Field>

            <Field
              orientation="horizontal"
              data-disabled={isReadOnly ? "true" : undefined}
              className="rounded-md border border-border bg-muted/20 px-3 py-3"
            >
              <FieldContent>
                <FieldTitle>Source Enabled</FieldTitle>
                <FieldDescription>
                  Disabling a source preserves its registry and cache state but prevents
                  scanning.
                </FieldDescription>
              </FieldContent>
              <Switch
                aria-label="Source Enabled"
                checked={source.enabled}
                disabled={isReadOnly}
                onCheckedChange={onEnabledChange}
              />
            </Field>
          </FieldGroup>
        </SectionCard>

        <SectionCard
          title={<h3>Validation Status</h3>}
          actions={
            <SourceStateBadge
              label={source.validation.label}
              title={source.validation.detail}
              tone={toneForSourceLabel(source.validation.label)}
            />
          }
          contentClassName="space-y-3"
        >
          <p className="text-xs/relaxed text-muted-foreground">
            {source.validation.detail ?? "Validation summary unavailable."}
          </p>
          {showValidationAlert ? (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>Validation attention required</AlertTitle>
              <AlertDescription>{validationFailureCopy}</AlertDescription>
            </Alert>
          ) : null}
        </SectionCard>

        <SectionCard
          title={<h3>Cache State</h3>}
          actions={
            <div className="flex flex-wrap justify-end gap-2">
              <SourceStateBadge
                label={source.scan.label}
                title={source.scan.detail}
                tone={toneForSourceLabel(source.scan.label)}
              />
              <SourceStateBadge
                label={source.cache.label}
                title={source.cache.detail}
                tone={toneForSourceLabel(source.cache.label)}
              />
              <SourceStateBadge
                label={source.watch.label}
                title={source.watch.detail}
                tone={toneForSourceLabel(source.watch.label)}
              />
            </div>
          }
          contentClassName="space-y-2"
        >
          <p className="text-xs/relaxed text-muted-foreground">
            {source.scan.detail ?? "Scan status unavailable."}
          </p>
          <p className="text-xs/relaxed text-muted-foreground">
            {source.cache.detail ?? "Cache status unavailable."}
          </p>
          <p className="text-xs/relaxed text-muted-foreground">
            {source.watch.detail ?? "Watch support is unknown."}
          </p>
          {showScanAlert ? (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>Scan attention required</AlertTitle>
              <AlertDescription>{scanFailureCopy}</AlertDescription>
            </Alert>
          ) : null}
        </SectionCard>

        <SectionCard
          title={<h3>Source Diagnostics</h3>}
          actions={<SourceStateBadge label={formatDiagnosticCount(source.diagnosticCount)} />}
        >
          {source.diagnostics.length === 0 ? (
            <p className="text-xs/relaxed text-muted-foreground">
              No source diagnostics reported for this data source.
            </p>
          ) : (
            <DiagnosticsList
              title="Reported diagnostics"
              diagnostics={source.diagnostics.map((diagnostic, index) => ({
                id: `${diagnostic.code}-${index}`,
                severity: diagnostic.severity,
                message: diagnostic.code,
                detail: diagnostic.message
              }))}
            />
          )}
        </SectionCard>

        <div className="flex flex-wrap gap-2" aria-label="Source actions">
          <Button disabled={!canScan || isBusy} onClick={onScan} type="button">
            {scanButtonLabel}
          </Button>
          <Button
            disabled={!canValidate || isBusy}
            onClick={onValidate}
            type="button"
            variant="outline"
          >
            {isReadOnly ? "Validation Unavailable" : "Validate Source"}
          </Button>
        </div>
      </div>
    </section>
  );
}
