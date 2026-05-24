import { useEffect, useRef, type KeyboardEvent } from "react";

import { SourceStateBadge } from "../../../components/app/source-state-badge.js";
import { cn } from "../../../lib/utils.js";
import type { DataSourceViewModel } from "../../../bridge/data-sources.js";
import { formatDiagnosticCount, toneForSourceLabel } from "../status.js";

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
    <div className="flex h-full min-h-0 flex-col" onKeyDown={handleKeyDown}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Data source summaries</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Review local roots, imported archives, and explicit source-state evidence.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-2 p-3">
          {sources.map((source, index) => {
            const isSelected = source.sourceId === selectedSourceId;
            const title = source.sourceName?.trim() || source.rootPath;

            return (
              <button
                key={source.sourceId}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                type="button"
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "w-full rounded-lg border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-muted/30"
                )}
                onClick={() => onSelect(source.sourceId)}
                onFocus={() => onFocusIndexChange(index)}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="truncate text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">{source.adapterDisplayName}</p>
                    <p className="truncate text-xs/relaxed text-muted-foreground" title={source.rootPath}>
                      {source.rootPath}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <SourceStateBadge label={source.sourceKind} />
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
                    <SourceStateBadge
                      label={source.validation.label}
                      title={source.validation.detail}
                      tone={toneForSourceLabel(source.validation.label)}
                    />
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
                    <SourceStateBadge label={formatDiagnosticCount(source.diagnosticCount)} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
