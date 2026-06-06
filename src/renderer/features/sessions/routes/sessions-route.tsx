import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import {
  getSession,
  listSessions,
  onSourceDataChanged
} from "../../../bridge/agent-workbench.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { MasterDetailLayout } from "../../../components/app/master-detail-layout.js";
import { MetricCard } from "../../../components/app/metric-card.js";
import { MetricGrid } from "../../../components/app/metric-grid.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { Toolbar } from "../../../components/app/toolbar.js";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { SessionList } from "../components/session-list.js";
import { SessionPreview } from "../components/session-preview.js";
import {
  compareSessionsByRiskThenNewest,
  summarizeVisibleSessionKpis
} from "../session-triage-helpers.js";
import type {
  ListSessionsPageInfo,
  SessionPreviewView,
  SessionSummary
} from "../types.js";

const EMPTY_HEADING = "No sessions available";
const EMPTY_BODY =
  "The triage shell is running, but no session summaries are available yet. Scan a configured source, then reload triage data.";
const ERROR_COPY =
  "Sessions could not load. Check the preload bridge and IPC handler, then reload triage data.";

type SessionSortOrder = "risk-first" | "newest-first";
type SessionPageSize = 10 | 25 | 50 | 100;

interface CursorHistoryEntry {
  cursor?: string;
  start: number;
}

const DEFAULT_PAGE_SIZE: SessionPageSize = 25;
const PAGE_SIZE_OPTIONS: SessionPageSize[] = [10, 25, 50, 100];
const DEFAULT_SORT_ORDER: SessionSortOrder = "risk-first";

function parseSessionSortOrder(value: string | null): SessionSortOrder {
  return value === "newest-first" ? value : DEFAULT_SORT_ORDER;
}

function parseSessionPageSize(value: string | null): SessionPageSize {
  const parsedValue = Number.parseInt(value ?? "", 10);
  return PAGE_SIZE_OPTIONS.find((option) => option === parsedValue) ?? DEFAULT_PAGE_SIZE;
}

function getSessionSortTimestamp(session: SessionSummary): number {
  const endedAt = Date.parse(session.endedAt ?? "");
  const startedAt = Date.parse(session.startedAt ?? "");
  const latest = Math.max(
    Number.isFinite(endedAt) ? endedAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(startedAt) ? startedAt : Number.NEGATIVE_INFINITY
  );

  return Number.isFinite(latest) ? latest : 0;
}

function compareSessionsByNewest(left: SessionSummary, right: SessionSummary): number {
  const timestampDifference = getSessionSortTimestamp(right) - getSessionSortTimestamp(left);

  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.sessionId.localeCompare(right.sessionId);
}

function sortSessions(sessions: SessionSummary[], sortOrder: SessionSortOrder): SessionSummary[] {
  const sortedSessions = [...sessions];
  sortedSessions.sort(
    sortOrder === "risk-first" ? compareSessionsByRiskThenNewest : compareSessionsByNewest
  );
  return sortedSessions;
}

export function SessionsRoute() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAdapterId = searchParams.get("adapterId") ?? "all";
  const sortOrder = parseSessionSortOrder(searchParams.get("sort"));
  const pageSize = parseSessionPageSize(searchParams.get("pageSize"));
  const focusedSessionIdRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [pageInfo, setPageInfo] = useState<ListSessionsPageInfo | undefined>(undefined);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedPreview, setSelectedPreview] = useState<SessionPreviewView | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [currentPage, setCurrentPage] = useState<CursorHistoryEntry>({ start: 1 });
  const [previousPages, setPreviousPages] = useState<CursorHistoryEntry[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const pageNavigationPendingRef = useRef(false);
  const preserveFocusOnNextLoadRef = useRef(false);
  const [isPageNavigationPending, setIsPageNavigationPending] = useState(false);

  const visibleSessions = useMemo(() => sortSessions(sessions, sortOrder), [sessions, sortOrder]);

  const selectedIndex = useMemo(
    () => visibleSessions.findIndex((session) => session.sessionId === selectedSessionId),
    [selectedSessionId, visibleSessions]
  );

  const visibleSessionKpis = useMemo(
    () => summarizeVisibleSessionKpis(visibleSessions),
    [visibleSessions]
  );

  const handleFocusIndexChange = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      focusedSessionIdRef.current = visibleSessions[index]?.sessionId ?? null;
    },
    [visibleSessions]
  );

  const loadSessions = useCallback(async () => {
    setIsListLoading(true);
    setLoadFailed(false);

    try {
      const response = await listSessions({
        ...(selectedAdapterId === "all" ? {} : { adapterId: selectedAdapterId }),
        limit: pageSize,
        ...(currentPage.cursor ? { cursor: currentPage.cursor } : {})
      });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const sortedSessions = sortSessions(response.sessions, sortOrder);
      const shouldPreserveFocus = preserveFocusOnNextLoadRef.current;
      preserveFocusOnNextLoadRef.current = false;
      const previousFocusedSessionId = focusedSessionIdRef.current;
      const nextFocusedSessionId =
        shouldPreserveFocus &&
        previousFocusedSessionId &&
        response.sessions.some((session) => session.sessionId === previousFocusedSessionId)
          ? previousFocusedSessionId
          : sortedSessions[0]?.sessionId ?? null;
      const nextFocusedIndex =
        nextFocusedSessionId === null
          ? 0
          : Math.max(
              0,
              sortedSessions.findIndex((session) => session.sessionId === nextFocusedSessionId)
            );

      setSessions(response.sessions);
      setPageInfo(response.pageInfo);
      focusedSessionIdRef.current = nextFocusedSessionId;
      setFocusedIndex(nextFocusedIndex);
      setSelectedSessionId((current) => {
        if (current && response.sessions.some((session) => session.sessionId === current)) {
          return current;
        }

        return sortedSessions[0]?.sessionId ?? null;
      });
    } catch {
      setSessions([]);
      setPageInfo(undefined);
      setSelectedSessionId(null);
      setSelectedPreview(null);
      setLoadFailed(true);
    } finally {
      preserveFocusOnNextLoadRef.current = false;
      pageNavigationPendingRef.current = false;
      setIsPageNavigationPending(false);
      setIsListLoading(false);
    }
  }, [currentPage.cursor, pageSize, selectedAdapterId, sortOrder]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions, reloadToken]);

  useEffect(() => {
    return onSourceDataChanged(() => {
      preserveFocusOnNextLoadRef.current = true;
      setReloadToken((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedPreview(null);
      return;
    }

    let isCurrent = true;
    setIsPreviewLoading(true);
    setLoadFailed(false);

    getSession({ sessionId: selectedSessionId })
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setSelectedPreview(response.session);
      })
      .catch(() => {
        if (isCurrent) {
          setSelectedPreview(null);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsPreviewLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (visibleSessions.length === 0) {
      focusedSessionIdRef.current = null;

      if (focusedIndex !== 0) {
        setFocusedIndex(0);
      }

      return;
    }

    const focusedSessionId = focusedSessionIdRef.current;
    const focusedSessionIndex =
      focusedSessionId == null
        ? -1
        : visibleSessions.findIndex((session) => session.sessionId === focusedSessionId);
    const selectedSessionIndex =
      selectedSessionId == null
        ? -1
        : visibleSessions.findIndex((session) => session.sessionId === selectedSessionId);
    const nextFocusedIndex =
      focusedSessionIndex >= 0
        ? focusedSessionIndex
        : selectedSessionIndex >= 0
          ? selectedSessionIndex
          : Math.min(focusedIndex, visibleSessions.length - 1);

    focusedSessionIdRef.current = visibleSessions[nextFocusedIndex]?.sessionId ?? null;

    if (nextFocusedIndex !== focusedIndex) {
      setFocusedIndex(nextFocusedIndex);
    }
  }, [focusedIndex, selectedSessionId, visibleSessions]);

  const harnessFilters = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();

    for (const session of sessions) {
      const current = counts.get(session.adapterId) ?? {
        label: session.adapterDisplayName,
        count: 0
      };

      current.count += 1;
      counts.set(session.adapterId, current);
    }

    return [...counts.entries()].map(([adapterId, value]) => ({
      adapterId,
      label: value.label,
      count: value.count
    }));
  }, [sessions]);

  const pageRangeText = useMemo(() => {
    if (sessions.length === 0) {
      return "0 loaded";
    }

    const start = currentPage.start;
    const end = currentPage.start + sessions.length - 1;

    if (pageInfo?.totalCount !== undefined) {
      return `${start}-${Math.min(end, pageInfo.totalCount)} of ${pageInfo.totalCount}`;
    }

    return pageInfo?.hasMore ? `${start}-${end} loaded, more available` : `${start}-${end} loaded`;
  }, [currentPage.start, pageInfo, sessions.length]);

  const hasPreviousPage = previousPages.length > 0;
  const hasNextPage = Boolean(pageInfo?.hasMore && pageInfo.nextCursor);

  function updateRouteState(nextState: {
    adapterId?: string;
    pageSize?: SessionPageSize;
    sort?: SessionSortOrder;
  }) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const nextAdapterId = nextState.adapterId ?? selectedAdapterId;
      const nextPageSize = nextState.pageSize ?? pageSize;
      const nextSortOrder = nextState.sort ?? sortOrder;

      if (nextAdapterId === "all") {
        next.delete("adapterId");
      } else {
        next.set("adapterId", nextAdapterId);
      }

      if (nextPageSize === DEFAULT_PAGE_SIZE) {
        next.delete("pageSize");
      } else {
        next.set("pageSize", String(nextPageSize));
      }

      if (nextSortOrder === DEFAULT_SORT_ORDER) {
        next.delete("sort");
      } else {
        next.set("sort", nextSortOrder);
      }

      return next;
    });
  }

  function handleAdapterChange(adapterId: string) {
    setCurrentPage({ start: 1 });
    setPreviousPages([]);
    updateRouteState({ adapterId });
  }

  function sessionRoute(path: string): string {
    const next = new URLSearchParams();

    if (selectedAdapterId !== "all") {
      next.set("adapterId", selectedAdapterId);
    }

    if (pageSize !== DEFAULT_PAGE_SIZE) {
      next.set("pageSize", String(pageSize));
    }

    if (sortOrder !== DEFAULT_SORT_ORDER) {
      next.set("sort", sortOrder);
    }

    const query = next.toString();

    return query.length > 0 ? `${path}?${query}` : path;
  }

  function handleSortChange(nextSortOrder: SessionSortOrder) {
    setCurrentPage({ start: 1 });
    setPreviousPages([]);
    updateRouteState({ sort: nextSortOrder });
  }

  function handlePageSizeChange(nextPageSize: SessionPageSize) {
    setCurrentPage({ start: 1 });
    setPreviousPages([]);
    updateRouteState({ pageSize: nextPageSize });
  }

  function handleReload() {
    setPreviousPages([]);
    setReloadToken((current) => current + 1);
  }

  function handleNextPage() {
    if (!pageInfo?.nextCursor || sessions.length === 0 || pageNavigationPendingRef.current) {
      return;
    }

    pageNavigationPendingRef.current = true;
    setIsPageNavigationPending(true);
    setPreviousPages((current) => [...current, currentPage]);
    setCurrentPage({
      cursor: pageInfo.nextCursor,
      start: currentPage.start + sessions.length
    });
  }

  function handlePreviousPage() {
    if (!hasPreviousPage || pageNavigationPendingRef.current) {
      return;
    }

    pageNavigationPendingRef.current = true;
    setIsPageNavigationPending(true);
    setPreviousPages((current) => {
      const nextHistory = current.slice(0, -1);
      const previousPage = current.at(-1);

      if (previousPage) {
        setCurrentPage(previousPage);
      }

      return nextHistory;
    });
  }

  return (
    <RoutePage aria-label="Sessions route">
      <PageHeader
        eyebrow="Local workbench"
        description="Triage agent runs by evidence, not vibes."
        title="Sessions"
      />

      <Toolbar ariaLabel="Sessions toolbar" className="gap-3">
        <label className="grid min-w-[11rem] flex-1 gap-1 text-xs text-muted-foreground sm:flex-none">
          <span className="font-medium text-foreground">Harness</span>
          <NativeSelect
            aria-label="Harness"
            onChange={(event) => handleAdapterChange(event.target.value)}
            value={selectedAdapterId}
          >
            <option value="all">All Harnesses</option>
            {harnessFilters.map((filter) => (
              <option key={filter.adapterId} value={filter.adapterId}>
                {filter.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid min-w-[13rem] gap-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Sort</span>
          <NativeSelect
            aria-label="Sort sessions"
            onChange={(event) => handleSortChange(event.target.value as SessionSortOrder)}
            value={sortOrder}
          >
            <option value="risk-first">Risk first (visible page)</option>
            <option value="newest-first">Newest first (visible page)</option>
          </NativeSelect>
        </label>
        <label className="grid min-w-[8rem] gap-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Page size</span>
          <NativeSelect
            aria-label="Page size"
            onChange={(event) => handlePageSizeChange(Number.parseInt(event.target.value, 10) as SessionPageSize)}
            value={String(pageSize)}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button className="sm:ml-auto" onClick={handleReload} type="button">
          Reload Triage Data
        </Button>
      </Toolbar>

      {isListLoading ? (
        <LoadingState
          title="Loading sessions"
          description="Reading normalized session summaries and the selected preview."
        />
      ) : null}

      {!isListLoading && loadFailed ? <ErrorState title={ERROR_COPY} /> : null}

      {!isListLoading && !loadFailed && sessions.length === 0 ? (
        <EmptyState title={EMPTY_HEADING} description={EMPTY_BODY} />
      ) : null}

      {!isListLoading && !loadFailed && sessions.length > 0 ? (
        <div className="space-y-4">
          <section aria-label="Visible session KPIs" className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="text-sm font-medium text-foreground">Visible page totals</h2>
              <p className="text-xs text-muted-foreground">
                Current loaded sessions only.
              </p>
            </div>
            <MetricGrid aria-label="Session KPI strip" className="lg:grid-cols-3 xl:grid-cols-5">
              <MetricCard
                customSize
                glowColor="orange"
                label="Needs review"
                supportingText="Visible sessions requiring follow-up."
                value={visibleSessionKpis.needsReview}
                variant="glow"
              />
              <MetricCard
                customSize
                glowColor="red"
                label="Failed commands"
                supportingText="Visible failed command total."
                value={visibleSessionKpis.failedCommands}
                variant="glow"
              />
              <MetricCard
                customSize
                glowColor="purple"
                label="Not verified / not run"
                supportingText="Visible sessions without a settled verification result."
                value={visibleSessionKpis.notVerifiedOrNotRun}
                variant="glow"
              />
              <MetricCard
                customSize
                glowColor="blue"
                label="Files changed"
                supportingText="Visible file mutation total."
                value={visibleSessionKpis.filesChanged}
                variant="glow"
              />
              <MetricCard
                customSize
                glowColor="green"
                label="Active now"
                supportingText="Visible sessions still in progress."
                value={visibleSessionKpis.activeNow}
                variant="glow"
              />
            </MetricGrid>
          </section>

          <section
            aria-label="Sessions pagination"
            className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">Visible page</h2>
              <p className="text-xs text-muted-foreground">{pageRangeText}</p>
            </div>
            <nav aria-label="Sessions pagination" className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePreviousPage}
                disabled={!hasPreviousPage || isListLoading || isPageNavigationPending}
              >
                Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleNextPage}
                disabled={!hasNextPage || isListLoading || isPageNavigationPending}
              >
                Next
              </Button>
            </nav>
          </section>

          <MasterDetailLayout
            masterLabel="Session inbox"
            detailLabel="Selected session preview"
            master={
              <SessionList
                focusedIndex={selectedIndex >= 0 ? focusedIndex : 0}
                onFocusIndexChange={handleFocusIndexChange}
                onSelect={setSelectedSessionId}
                selectedSessionId={selectedSessionId}
                sessions={visibleSessions}
              />
            }
            detail={
              <SessionPreview
                isLoading={isPreviewLoading}
                onOpenDetail={
                  selectedSessionId
                    ? () => navigate(sessionRoute(`/sessions/${selectedSessionId}`))
                    : undefined
                }
                onOpenRunAudit={
                  selectedSessionId
                    ? () => navigate(sessionRoute(`/sessions/${selectedSessionId}/run-audit`))
                    : undefined
                }
                session={selectedPreview}
              />
            }
          />
        </div>
      ) : null}
    </RoutePage>
  );
}
