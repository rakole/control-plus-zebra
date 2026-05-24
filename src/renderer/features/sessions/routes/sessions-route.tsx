import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { getSession, listSessions } from "../../../bridge/agent-workbench.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { MasterDetailLayout } from "../../../components/app/master-detail-layout.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import { Toolbar } from "../../../components/app/toolbar.js";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { SessionList } from "../components/session-list.js";
import { SessionPreview } from "../components/session-preview.js";
import type { SessionPreviewView, SessionSummary } from "../types.js";

const EMPTY_HEADING = "No sessions available";
const EMPTY_BODY =
  "The triage shell is running, but no session summaries are available yet. Scan a configured source, then reload triage data.";
const ERROR_COPY =
  "Sessions could not load. Check the preload bridge and IPC handler, then reload triage data.";

export function SessionsRoute() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAdapterId = searchParams.get("adapterId") ?? "all";
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedPreview, setSelectedPreview] = useState<SessionPreviewView | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const selectedIndex = useMemo(
    () => sessions.findIndex((session) => session.sessionId === selectedSessionId),
    [selectedSessionId, sessions]
  );

  const loadSessions = useCallback(async () => {
    setIsListLoading(true);
    setLoadFailed(false);

    try {
      const response = await listSessions(
        selectedAdapterId === "all" ? {} : { adapterId: selectedAdapterId }
      );

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      setSessions(response.sessions);
      setFocusedIndex(0);
      setSelectedSessionId((current) => {
        if (current && response.sessions.some((session) => session.sessionId === current)) {
          return current;
        }

        return response.sessions[0]?.sessionId ?? null;
      });
    } catch {
      setSessions([]);
      setSelectedSessionId(null);
      setSelectedPreview(null);
      setLoadFailed(true);
    } finally {
      setIsListLoading(false);
    }
  }, [selectedAdapterId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

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

  function handleAdapterChange(adapterId: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (adapterId === "all") {
        next.delete("adapterId");
      } else {
        next.set("adapterId", adapterId);
      }

      return next;
    });
  }

  function sessionRoute(path: string): string {
    const query = selectedAdapterId === "all" ? "" : `?adapterId=${encodeURIComponent(selectedAdapterId)}`;

    return `${path}${query}`;
  }

  return (
    <RoutePage aria-label="Sessions route">
      <PageHeader
        actions={
          <Toolbar ariaLabel="Sessions filters" className="justify-end">
            <label className="grid gap-1 text-xs text-muted-foreground">
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
            <Button onClick={() => void loadSessions()} type="button">
              Reload Triage Data
            </Button>
          </Toolbar>
        }
        eyebrow="Local workbench"
        title="Sessions"
      />

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
        <MasterDetailLayout
          masterLabel="Session summaries"
          detailLabel="Selected session preview"
          master={
            <SessionList
              focusedIndex={selectedIndex >= 0 ? focusedIndex : 0}
              onFocusIndexChange={setFocusedIndex}
              onSelect={setSelectedSessionId}
              selectedSessionId={selectedSessionId}
              sessions={sessions}
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
      ) : null}
    </RoutePage>
  );
}
