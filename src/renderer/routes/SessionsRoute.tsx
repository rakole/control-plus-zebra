import { useCallback, useEffect, useMemo, useState } from "react";

import { LoadingSkeleton } from "../components/LoadingSkeleton.js";
import { SessionList, type SessionSummary } from "../components/SessionList.js";
import {
  SessionPreview,
  type SessionPreviewView
} from "../components/SessionPreview.js";

const EMPTY_HEADING = "No sessions available";
const EMPTY_BODY =
  "The desktop shell is running, but the bridge returned no session summaries. Reload sessions after the fake-adapter view model is available.";
const ERROR_COPY =
  "Sessions could not load. Check the preload bridge and IPC handler, then reload sessions.";

export function SessionsRoute() {
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
      const response = await window.agentWorkbench.listSessions();

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
  }, []);

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

    window.agentWorkbench
      .getSessionById({ sessionId: selectedSessionId })
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

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
  }

  function changeFocusIndex(index: number) {
    setFocusedIndex(index);
  }

  return (
    <main className="route-shell" aria-labelledby="sessions-title">
      <section className="route-header">
        <div>
          <p className="route-kicker">Local workbench</p>
          <h1 id="sessions-title">Sessions</h1>
        </div>
        <button className="primary-button" onClick={() => void loadSessions()} type="button">
          Reload Sessions
        </button>
      </section>

      {isListLoading ? <LoadingSkeleton /> : null}

      {!isListLoading && loadFailed ? (
        <section className="state-panel state-panel-error" role="alert">
          <h2>{ERROR_COPY}</h2>
        </section>
      ) : null}

      {!isListLoading && !loadFailed && sessions.length === 0 ? (
        <section className="state-panel">
          <h2>{EMPTY_HEADING}</h2>
          <p>{EMPTY_BODY}</p>
        </section>
      ) : null}

      {!isListLoading && !loadFailed && sessions.length > 0 ? (
        <section className="sessions-grid" aria-label="Sessions route">
          <SessionList
            focusedIndex={selectedIndex >= 0 ? focusedIndex : 0}
            onFocusIndexChange={changeFocusIndex}
            onSelect={selectSession}
            selectedSessionId={selectedSessionId}
            sessions={sessions}
          />
          <SessionPreview session={selectedPreview} isLoading={isPreviewLoading} />
        </section>
      ) : null}
    </main>
  );
}
