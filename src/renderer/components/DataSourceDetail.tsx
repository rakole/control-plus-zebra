import { useEffect, useRef } from "react";

import type {
  DataSourceAdapterOption,
  DataSourceViewModel
} from "../data-sources-bridge.js";
import { SourceStatusBadge } from "./SourceStatusBadge.js";

export interface DataSourceEditorState extends DataSourceViewModel {
  isDraft?: boolean;
}

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
  const pathInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pathAutoFocusKey) {
      pathInputRef.current?.focus();
    }
  }, [pathAutoFocusKey]);

  if (!source) {
    return (
      <aside className="source-detail-panel preview-empty" aria-label="Selected data source detail">
        <p className="preview-label">Selected source</p>
        <h2>{detailEmptyCopy}</h2>
      </aside>
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

  return (
    <aside className="source-detail-panel" aria-label="Selected data source detail">
      <div className="detail-heading">
        <div>
          <p className="preview-label">{source.adapterDisplayName}</p>
          <h2>{title}</h2>
        </div>
        <div className="detail-section-badges">
          {source.readOnlyLabel ? <SourceStatusBadge label={source.readOnlyLabel} /> : null}
          <SourceStatusBadge label={source.enabledLabel} />
        </div>
      </div>

      <section className="detail-section" aria-labelledby="source-metadata-heading">
        <div className="detail-section-heading">
          <h3 id="source-metadata-heading">Source Metadata</h3>
        </div>
        <div className="detail-field-grid">
          <div className="detail-field">
            <span className="detail-label">Source Kind</span>
            <span className="detail-summary">{source.sourceKind}</span>
          </div>
          <div className="detail-field">
            <span className="detail-label">Added By</span>
            <span className="detail-summary">{source.addedBy}</span>
          </div>
        </div>
        {source.readOnlyReason ? (
          <p className="detail-summary">{source.readOnlyReason}</p>
        ) : null}
      </section>

      {source.archiveMetadata ? (
        <section className="detail-section" aria-labelledby="archive-metadata-heading">
          <div className="detail-section-heading">
            <h3 id="archive-metadata-heading">Archive Metadata</h3>
          </div>
          <div className="detail-field-grid">
            <div className="detail-field">
              <span className="detail-label">Archive Path</span>
              <span className="detail-summary">{source.archiveMetadata.archivePath}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Archive Scope</span>
              <span className="detail-summary">{source.archiveMetadata.scopeLabel}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Manifest Version</span>
              <span className="detail-summary">{source.archiveMetadata.manifestVersion}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Imported At</span>
              <span className="detail-summary">{source.archiveMetadata.importedAt}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Exported At</span>
              <span className="detail-summary">{source.archiveMetadata.exportedAt}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Archived Sessions</span>
              <span className="detail-summary">{source.archiveMetadata.sessionCount}</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="detail-section" aria-labelledby="source-settings-heading">
        <div className="detail-section-heading">
          <h3 id="source-settings-heading">Source Settings</h3>
        </div>

        <div className="detail-field-grid">
          <label className="detail-field">
            <span className="detail-label">Harness</span>
            <select
              aria-label="Harness"
              className="detail-select"
              disabled={isReadOnly}
              onChange={(event) => onAdapterChange(event.target.value)}
              value={source.adapterId}
            >
              {adapterOptions.map((adapter) => (
                <option key={adapter.adapterId} value={adapter.adapterId}>
                  {adapter.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="detail-field">
            <span className="detail-label">Source Name</span>
            <input
              aria-label="Source Name"
              className="detail-input"
              disabled={isReadOnly}
              onChange={(event) => onSourceNameChange(event.target.value)}
              type="text"
              value={source.sourceName ?? ""}
            />
          </label>
        </div>

        <label className="detail-field">
          <span className="detail-label">Source Root Path</span>
          <input
            aria-label="Source Root Path"
            className="detail-input"
            disabled={isReadOnly}
            onChange={(event) => onRootPathChange(event.target.value)}
            ref={pathInputRef}
            type="text"
            value={source.rootPath}
          />
          <span className="detail-helper">
            {isReadOnly
              ? "Imported archives keep the original archive path and remain read-only after import."
              : "Enter a local source root path. Validation runs through the shared source registry."}
          </span>
        </label>

        <label className="detail-switch-row">
          <span>
            <span className="detail-label">Source Enabled</span>
            <span className="detail-helper">
              Disabling a source preserves its registry and cache state but prevents
              scanning.
            </span>
          </span>
          <span className="switch-control">
            <input
              aria-label="Source Enabled"
              checked={source.enabled}
              disabled={isReadOnly}
              onChange={(event) => onEnabledChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
          </span>
        </label>
      </section>

      <section className="detail-section" aria-labelledby="validation-heading">
        <div className="detail-section-heading">
          <h3 id="validation-heading">Validation Status</h3>
          <SourceStatusBadge
            label={source.validation.label}
            title={source.validation.detail}
            tone={showValidationAlert ? "destructive" : "neutral"}
          />
        </div>
        <p className="detail-summary">{source.validation.detail ?? "Validation summary unavailable."}</p>
        {showValidationAlert ? (
          <div className="detail-alert" role="alert">
            <p>{validationFailureCopy}</p>
          </div>
        ) : null}
      </section>

      <section className="detail-section" aria-labelledby="cache-heading">
        <div className="detail-section-heading">
          <h3 id="cache-heading">Cache State</h3>
          <div className="detail-section-badges">
            <SourceStatusBadge
              label={source.scan.label}
              title={source.scan.detail}
              tone={showScanAlert ? "destructive" : "neutral"}
            />
            <SourceStatusBadge label={source.cache.label} title={source.cache.detail} />
            <SourceStatusBadge label={source.watch.label} title={source.watch.detail} />
          </div>
        </div>
        <p className="detail-summary">{source.scan.detail ?? "Scan status unavailable."}</p>
        <p className="detail-summary">{source.cache.detail ?? "Cache status unavailable."}</p>
        <p className="detail-summary">{source.watch.detail ?? "Watch support is unknown."}</p>
        {showScanAlert ? (
          <div className="detail-alert" role="alert">
            <p>{scanFailureCopy}</p>
          </div>
        ) : null}
      </section>

      <section className="detail-section" aria-labelledby="diagnostics-heading">
        <div className="detail-section-heading">
          <h3 id="diagnostics-heading">Source Diagnostics</h3>
          <SourceStatusBadge
            label={`${source.diagnosticCount} Diagnostic${source.diagnosticCount === 1 ? "" : "s"}`}
          />
        </div>

        {source.diagnostics.length === 0 ? (
          <p className="detail-summary">No source diagnostics reported for this data source.</p>
        ) : (
          <ul className="diagnostic-list">
            {source.diagnostics.map((diagnostic) => (
              <li className="diagnostic-item" key={`${diagnostic.code}-${diagnostic.message}`}>
                <div className="diagnostic-heading">
                  <span>{diagnostic.code}</span>
                  <SourceStatusBadge
                    label={diagnostic.severity === "error" ? "Error" : diagnostic.severity === "warning" ? "Warning" : "Info"}
                    tone={diagnostic.severity === "error" ? "destructive" : "neutral"}
                  />
                </div>
                <p>{diagnostic.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-actions" aria-label="Source actions">
        <button
          className={canScan ? "primary-button" : "secondary-button button-disabled"}
          disabled={!canScan || isBusy}
          onClick={onScan}
          type="button"
        >
          {scanButtonLabel}
        </button>
        <button
          className={canScan ? "secondary-button" : "primary-button"}
          disabled={!canValidate || isBusy}
          onClick={onValidate}
          type="button"
        >
          {isReadOnly ? "Validation Unavailable" : "Validate Source"}
        </button>
      </section>
    </aside>
  );
}
