import { useCallback, useEffect, useRef, useState } from "react";

import {
  addDataSource,
  listDataSources,
  openArchive,
  scanDataSource,
  setDataSourceEnabled,
  updateDataSource,
  validateDataSource,
  type CreateDataSourceRequest,
  type DataSourceAdapterOption,
  type SetDataSourceEnabledRequest,
  type DataSourceViewModel,
  type UpdateDataSourceRequest
} from "../data-sources-bridge.js";
import {
  DataSourceDetail,
  type DataSourceEditorState
} from "../components/DataSourceDetail.js";
import { DataSourceList } from "../components/DataSourceList.js";
import { DataSourcesLoadingSkeleton } from "../components/DataSourcesLoadingSkeleton.js";

const EMPTY_HEADING = "No data sources configured";
const EMPTY_BODY =
  "Add a local harness source or import an archive to populate sessions and project summaries.";
const ERROR_COPY =
  "Data sources could not load. Check the source registry bridge and IPC handler, then reload data sources.";

const defaultValidation = {
  label: "Not Validated" as const,
  detail: "Validate the source before scanning."
};
const defaultScan = {
  label: "Never Scanned" as const,
  detail: "No scan has completed for this data source yet."
};
const defaultCache = {
  label: "Unknown" as const,
  detail: "Cache status is unavailable until a scan completes."
};
const defaultWatch = {
  label: "Watch Unknown" as const,
  detail: "Watch support has not been reported for this data source."
};

export function DataSourcesRoute() {
  const draftCounterRef = useRef(0);
  const [adapters, setAdapters] = useState<DataSourceAdapterOption[]>([]);
  const [sources, setSources] = useState<DataSourceViewModel[]>([]);
  const [selectedSource, setSelectedSource] = useState<DataSourceEditorState | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [pathAutoFocusKey, setPathAutoFocusKey] = useState<string | null>(null);

  const loadDataSources = useCallback(async (preferredSourceId?: string) => {
    setIsLoading(true);
    setLoadFailed(false);

    try {
      const response = await listDataSources();

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      setAdapters(response.adapters);
      setSources(response.sources);
      setSelectedSource((current) => {
        if (preferredSourceId) {
          const preferred = response.sources.find(
            (source) => source.sourceId === preferredSourceId
          );

          if (preferred) {
            return createEditableSource(preferred);
          }
        }

        if (current?.isDraft) {
          return current;
        }

        if (current) {
          const refreshed = response.sources.find((source) => source.sourceId === current.sourceId);

          if (refreshed) {
            return createEditableSource(refreshed);
          }
        }

        return response.sources[0] ? createEditableSource(response.sources[0]) : null;
      });
      setFocusedIndex(0);
    } catch {
      setAdapters([]);
      setSources([]);
      setSelectedSource((current) => (current?.isDraft ? current : null));
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDataSources();
  }, [loadDataSources]);

  const displaySources = buildDisplaySources(sources, selectedSource);
  const canValidate = Boolean(
    selectedSource &&
      !selectedSource.readOnly &&
      selectedSource.adapterId &&
      selectedSource.rootPath.trim()
  );
  const canScan = Boolean(
    selectedSource &&
      !selectedSource.readOnly &&
      selectedSource.validation.label === "Valid" &&
      selectedSource.enabled &&
      !selectedSource.isDraft
  );

  function handleSelectSource(sourceId: string) {
    const source = displaySources.find((item) => item.sourceId === sourceId);

    if (!source) {
      return;
    }

    setSelectedSource(createEditableSource(source));
    setPathAutoFocusKey(null);
  }

  function updateCurrentSource(
    updater: (current: DataSourceEditorState) => DataSourceEditorState
  ) {
    setSelectedSource((current) => (current ? updater(current) : current));
  }

  function handleAddSource() {
    draftCounterRef.current += 1;
    const selectedAdapter = adapters[0];
    const draft = buildDraftSource(draftCounterRef.current, selectedAdapter);

    setSelectedSource(draft);
    setFocusedIndex(0);
    setPathAutoFocusKey(draft.sourceId);
  }

  function handleAdapterChange(adapterId: string) {
    const adapter = adapters.find((item) => item.adapterId === adapterId);

    updateCurrentSource((current) =>
      markSourceAsDirty({
        ...current,
        adapterId,
        adapterDisplayName: adapter?.displayName ?? current.adapterDisplayName,
        watch: adapter?.watchSupport ?? current.watch
      })
    );
  }

  function handleEnabledChange(enabled: boolean) {
    if (!selectedSource) {
      return;
    }

    const nextSource = {
      ...selectedSource,
      enabled,
      enabledLabel: enabled ? "Enabled" : "Disabled"
    } satisfies DataSourceEditorState;

    setSelectedSource(nextSource);

    if (selectedSource.isDraft) {
      return;
    }

    void persistEnabledState({
      enabled,
      sourceId: nextSource.sourceId
    });
  }

  function handleSourceNameChange(value: string) {
    updateCurrentSource((current) => ({
      ...current,
      sourceName: value
    }));
  }

  function handleRootPathChange(value: string) {
    updateCurrentSource((current) =>
      markSourceAsDirty({
        ...current,
        rootPath: value
      })
    );
  }

  async function persistExistingSource(
    source: DataSourceEditorState
  ): Promise<DataSourceViewModel | null> {
    const response = await updateDataSource(buildUpdateRequest(source));

    if (!response.ok) {
      return null;
    }

    applyUpdatedSource(response.source);
    return response.source;
  }

  async function persistEnabledState(
    request: SetDataSourceEnabledRequest
  ): Promise<DataSourceViewModel | null> {
    const response = await setDataSourceEnabled(request);

    if (!response.ok) {
      return null;
    }

    applyUpdatedSource(response.source);
    return response.source;
  }

  function applyUpdatedSource(source: DataSourceViewModel) {
    setSources((current) => upsertSource(current, source));
    setSelectedSource(createEditableSource(source));
  }

  async function handleValidate() {
    if (!selectedSource || !canValidate) {
      return;
    }

    setIsActionPending(true);

    try {
      let persistedSource: DataSourceViewModel | null = null;

      if (selectedSource.isDraft) {
        const response = await addDataSource(buildCreateRequest(selectedSource));

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        persistedSource = response.source;
        applyUpdatedSource(response.source);
      } else {
        persistedSource = await persistExistingSource(selectedSource);
      }

      if (!persistedSource) {
        throw new Error("Unable to persist data source changes.");
      }

      const validationResponse = await validateDataSource({ sourceId: persistedSource.sourceId });

      if (!validationResponse.ok) {
        throw new Error(validationResponse.error.message);
      }

      applyUpdatedSource(validationResponse.source);
    } catch {
      updateCurrentSource((current) => ({
        ...current,
        validation: {
          label: "Invalid",
          detail: validationFailureFallback(current.rootPath)
        }
      }));
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleScan() {
    if (!selectedSource || !canScan) {
      return;
    }

    setIsActionPending(true);

    updateCurrentSource((current) => ({
      ...current,
      scan: {
        label: "Scanning",
        detail: "Shared scanner orchestration is running for this data source."
      }
    }));

    try {
      const response = await scanDataSource({ sourceId: selectedSource.sourceId });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      applyUpdatedSource(response.source);
    } catch {
      updateCurrentSource((current) => ({
        ...current,
        scan: {
          label: "Scan Failed",
          detail:
            "Review source, adapter, cache, and normalization diagnostics before trying again."
        }
      }));
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleImportArchive() {
    setIsActionPending(true);

    try {
      const response = await openArchive();

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      if (response.archiveImport.status === "imported") {
        await loadDataSources(response.archiveImport.sourceId);
      }
    } finally {
      setIsActionPending(false);
    }
  }

  return (
    <main className="route-shell" aria-labelledby="data-sources-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Local and archived sources</p>
          <h1 id="data-sources-title">Data Sources</h1>
        </div>
        <div className="route-actions">
          <button className="secondary-button" onClick={() => void loadDataSources()} type="button">
            Reload Data Sources
          </button>
          <button className="secondary-button" onClick={handleAddSource} type="button">
            Add Source
          </button>
          <button className="primary-button" onClick={() => void handleImportArchive()} type="button">
            Import Archive
          </button>
        </div>
      </section>

      {isLoading ? <DataSourcesLoadingSkeleton /> : null}

      {!isLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
          <button className="secondary-button" onClick={() => void loadDataSources()} type="button">
            Reload Data Sources
          </button>
        </section>
      ) : null}

      {!isLoading && !loadFailed && displaySources.length === 0 ? (
        <section className="state-panel">
          <h2>{EMPTY_HEADING}</h2>
          <p>{EMPTY_BODY}</p>
        </section>
      ) : null}

      {!isLoading && !loadFailed && displaySources.length > 0 ? (
        <section className="data-sources-grid" aria-label="Data Sources route">
          <DataSourceList
            focusedIndex={focusedIndex}
            onFocusIndexChange={setFocusedIndex}
            onSelect={handleSelectSource}
            selectedSourceId={selectedSource?.sourceId ?? null}
            sources={displaySources}
          />
          <DataSourceDetail
            adapters={adapters}
            canScan={canScan}
            canValidate={canValidate}
            isBusy={isActionPending}
            onAdapterChange={handleAdapterChange}
            onEnabledChange={handleEnabledChange}
            onRootPathChange={handleRootPathChange}
            onScan={() => void handleScan()}
            onSourceNameChange={handleSourceNameChange}
            onValidate={() => void handleValidate()}
            pathAutoFocusKey={pathAutoFocusKey}
            source={selectedSource}
          />
        </section>
      ) : null}
    </main>
  );
}

function buildDisplaySources(
  sources: DataSourceViewModel[],
  selectedSource: DataSourceEditorState | null
): DataSourceViewModel[] {
  if (!selectedSource) {
    return sources;
  }

  if (selectedSource.isDraft) {
    return [selectedSource, ...sources];
  }

  return sources.map((source) =>
    source.sourceId === selectedSource.sourceId ? selectedSource : source
  );
}

function createEditableSource(source: DataSourceViewModel): DataSourceEditorState {
  return {
    ...source,
    diagnostics: [...source.diagnostics]
  };
}

function buildDraftSource(
  counter: number,
  adapter?: DataSourceAdapterOption
): DataSourceEditorState {
  return {
    sourceId: `draft-source-${counter}`,
    adapterId: adapter?.adapterId ?? "",
    adapterDisplayName: adapter?.displayName ?? "Unknown",
    sourceName: "",
    rootPath: "",
    enabled: true,
    enabledLabel: "Enabled",
    sourceKind: "Local Source",
    addedBy: "Configured",
    readOnly: false,
    validation: defaultValidation,
    scan: defaultScan,
    cache: defaultCache,
    watch: adapter?.watchSupport ?? defaultWatch,
    diagnosticCount: 0,
    diagnostics: [],
    hasCompletedScan: false,
    isDraft: true
  };
}

function markSourceAsDirty(source: DataSourceEditorState): DataSourceEditorState {
  const shouldMarkStale =
    source.hasCompletedScan ||
    source.cache.label === "Cached" ||
    source.cache.label === "Stale" ||
    source.scan.label === "Scanned" ||
    source.scan.label === "Scanned with Diagnostics";

  return {
    ...source,
    validation: defaultValidation,
    cache: shouldMarkStale
      ? {
          label: "Stale",
          detail: "Source settings changed. Validate the source, then rescan to refresh cache state."
        }
      : source.cache
  };
}

function buildCreateRequest(source: DataSourceEditorState): CreateDataSourceRequest {
  return {
    adapterId: source.adapterId,
    displayName: normalizeDisplayName(source.sourceName),
    rootPath: source.rootPath,
    enabled: source.enabled
  };
}

function buildUpdateRequest(source: DataSourceEditorState): UpdateDataSourceRequest {
  return {
    sourceId: source.sourceId,
    adapterId: source.adapterId,
    displayName: normalizeDisplayName(source.sourceName),
    rootPath: source.rootPath
  };
}

function normalizeDisplayName(sourceName?: string): string | undefined {
  const normalized = sourceName?.trim();

  return normalized ? normalized : undefined;
}

function upsertSource(
  currentSources: DataSourceViewModel[],
  updatedSource: DataSourceViewModel
): DataSourceViewModel[] {
  const existingIndex = currentSources.findIndex(
    (source) => source.sourceId === updatedSource.sourceId
  );

  if (existingIndex < 0) {
    return [updatedSource, ...currentSources];
  }

  return currentSources.map((source) =>
    source.sourceId === updatedSource.sourceId ? updatedSource : source
  );
}

function validationFailureFallback(rootPath: string): string {
  return rootPath
    ? `Unable to validate ${rootPath}. Review the diagnostics, update the path, then validate again.`
    : "Source validation failed. Update the path, then validate again.";
}
