export function DataSourcesLoadingSkeleton() {
  return (
    <section className="data-sources-grid" aria-label="Data Sources loading">
      <div className="source-list" aria-label="Loading data sources">
        {[0, 1, 2].map((index) => (
          <div className="source-row skeleton-row" key={index}>
            <div className="skeleton-copy">
              <span className="skeleton-line skeleton-line-title" />
              <span className="skeleton-line skeleton-line-meta" />
              <span className="skeleton-line skeleton-line-meta" />
            </div>
            <div className="source-row-badges">
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
            </div>
          </div>
        ))}
      </div>

      <aside className="source-detail-panel skeleton-preview" aria-label="Loading selected data source">
        <span className="skeleton-line skeleton-line-meta" />
        <span className="skeleton-line skeleton-line-heading" />
        <span className="skeleton-line skeleton-line-wide" />
        <span className="skeleton-line skeleton-line-wide" />
        <span className="skeleton-line skeleton-line-wide" />
      </aside>
    </section>
  );
}
