import { useEffect, useRef, type KeyboardEvent } from "react";

import type { DataSourceViewModel } from "../data-sources-bridge.js";
import { SourceStatusBadge } from "./SourceStatusBadge.js";

interface DataSourceListProps {
  sources: DataSourceViewModel[];
  selectedSourceId: string | null;
  focusedIndex: number;
  onFocusIndexChange(index: number): void;
  onSelect(sourceId: string): void;
}

export function DataSourceList({
  sources,
  selectedSourceId,
  focusedIndex,
  onFocusIndexChange,
  onSelect
}: DataSourceListProps) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    rowRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onFocusIndexChange(Math.min(focusedIndex + 1, sources.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onFocusIndexChange(Math.max(focusedIndex - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const focusedSource = sources[focusedIndex];

      if (focusedSource) {
        onSelect(focusedSource.sourceId);
      }
    }
  }

  return (
    <div className="source-list" aria-label="Data source summaries" onKeyDown={handleKeyDown}>
      {sources.map((source, index) => {
        const isSelected = source.sourceId === selectedSourceId;
        const title = source.sourceName?.trim() || source.rootPath;

        return (
          <button
            className={isSelected ? "source-row source-row-selected" : "source-row"}
            key={source.sourceId}
            onClick={() => onSelect(source.sourceId)}
            onFocus={() => onFocusIndexChange(index)}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            type="button"
            aria-current={isSelected ? "true" : undefined}
          >
            <span className="source-row-main">
              <span className="session-title">{title}</span>
              <span className="source-row-meta">{source.adapterDisplayName}</span>
              <span className="source-row-path" title={source.rootPath}>
                {source.rootPath}
              </span>
            </span>
            <span className="source-row-badges">
              <SourceStatusBadge label={source.sourceKind} />
              {source.readOnlyLabel ? <SourceStatusBadge label={source.readOnlyLabel} /> : null}
              <SourceStatusBadge label={source.enabledLabel} />
              <SourceStatusBadge
                label={source.validation.label}
                title={source.validation.detail}
                tone={source.validation.label === "Invalid" ? "destructive" : "neutral"}
              />
              <SourceStatusBadge
                label={source.scan.label}
                title={source.scan.detail}
                tone={source.scan.label === "Scan Failed" ? "destructive" : "neutral"}
              />
              <SourceStatusBadge label={source.cache.label} title={source.cache.detail} />
              <SourceStatusBadge label={source.watch.label} title={source.watch.detail} />
              <SourceStatusBadge
                label={`${source.diagnosticCount} Diagnostic${source.diagnosticCount === 1 ? "" : "s"}`}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
