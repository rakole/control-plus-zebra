export function LoadingSkeleton() {
  return (
    <section className="sessions-grid" aria-label="Sessions loading">
      <div className="session-list" aria-label="Loading session summaries">
        {[0, 1, 2].map((index) => (
          <div className="session-row skeleton-row" key={index}>
            <div className="skeleton-copy">
              <span className="skeleton-line skeleton-line-title" />
              <span className="skeleton-line skeleton-line-meta" />
            </div>
            <span className="skeleton-pill" />
          </div>
        ))}
      </div>

      <aside className="preview-panel skeleton-preview" aria-label="Loading selected session preview">
        <span className="skeleton-line skeleton-line-meta" />
        <span className="skeleton-line skeleton-line-heading" />
        <span className="skeleton-line skeleton-line-wide" />
        <span className="skeleton-line skeleton-line-wide" />
      </aside>
    </section>
  );
}
