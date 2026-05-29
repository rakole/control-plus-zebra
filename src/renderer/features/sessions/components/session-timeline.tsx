import { useEffect, useState } from "react";

import {
  getSessionTimeline,
  getOutputArtifactPreview,
  loadOutputArtifact
} from "../../../bridge/agent-workbench.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { Timeline } from "../../../components/app/timeline.js";
import { TimelineEvidencePreview } from "../../../components/app/timeline-evidence-preview.js";
import type { SessionDetailView, SessionTimelineEvent } from "../types.js";

interface SessionTimelineProps {
  detail: SessionDetailView;
}

export function SessionTimeline({ detail }: SessionTimelineProps) {
  const [artifactStates, setArtifactStates] = useState<Record<string, ArtifactState>>({});
  const [timeline, setTimeline] = useState(detail.timeline);
  const [pageInfo, setPageInfo] = useState(detail.timelinePageInfo);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sessionId = detail.session.sessionId;

  useEffect(() => {
    setArtifactStates({});
    setTimeline(detail.timeline);
    setPageInfo(detail.timelinePageInfo);
  }, [detail.timeline, detail.timelinePageInfo, sessionId]);

  const loadMoreTimeline = async () => {
    if (!pageInfo?.hasMore || !pageInfo.nextCursor) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const response = await getSessionTimeline({
        sessionId,
        cursor: pageInfo.nextCursor,
        limit: 100
      });

      if (response.ok && response.timeline) {
        const nextTimeline = response.timeline;
        setTimeline((current) => [...current, ...nextTimeline]);
        setPageInfo(response.pageInfo);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const loadArtifact = async (
    event: SessionTimelineEvent,
    mode: "preview" | "load"
  ) => {
    const artifactStateKey = buildArtifactStateKey(sessionId, event.id);

    setArtifactStates((current) => ({
      ...current,
      [artifactStateKey]: { status: "loading", mode }
    }));

    const request = {
      sessionId,
      outputArtifactId: event.id
    };

    try {
      if (mode === "preview") {
        const response = await getOutputArtifactPreview(request);

        if (!response.ok) {
          setArtifactStates((current) => ({
            ...current,
            [artifactStateKey]: { status: "error", message: response.error.message }
          }));
          return;
        }

        setArtifactStates((current) => ({
          ...current,
          [artifactStateKey]: {
            status: "ready",
            result: response.preview
          }
        }));
      } else {
        const response = await loadOutputArtifact(request);

        if (!response.ok) {
          setArtifactStates((current) => ({
            ...current,
            [artifactStateKey]: { status: "error", message: response.error.message }
          }));
          return;
        }

        setArtifactStates((current) => ({
          ...current,
          [artifactStateKey]: {
            status: "ready",
            result: response.artifact
          }
        }));
      }
    } catch {
      setArtifactStates((current) => ({
        ...current,
        [artifactStateKey]: {
          status: "error",
          message: "Output artifact could not load through the preload bridge."
        }
      }));
    }
  };

  return (
    <SectionCard
      title="Session Timeline"
      description="Chronological evidence for the selected local run."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {timeline.length}
            {pageInfo?.totalCount !== undefined ? ` / ${pageInfo.totalCount}` : ""} events
          </Badge>
          {pageInfo?.hasMore ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadMoreTimeline()}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "Loading" : "Load More"}
            </Button>
          ) : null}
        </div>
      }
    >
      <Timeline
        items={timeline.map((event) => ({
          id: event.id,
          eyebrow: event.kind,
          title: event.title,
          timestamp: event.timestamp,
          ...renderTimelineSummary(event),
          metadata: event.metadata,
          ...(event.kind === "output-artifact"
            ? {
                actions: (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void loadArtifact(event, "preview")}
                      disabled={
                        artifactStates[buildArtifactStateKey(sessionId, event.id)]?.status ===
                        "loading"
                      }
                    >
                      Preview
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void loadArtifact(event, "load")}
                      disabled={
                        artifactStates[buildArtifactStateKey(sessionId, event.id)]?.status ===
                        "loading"
                      }
                    >
                      Load
                    </Button>
                  </div>
                ),
                detail: renderArtifactState(
                  artifactStates[buildArtifactStateKey(sessionId, event.id)]
                )
              }
            : {})
        }))}
      />
    </SectionCard>
  );
}

function renderTimelineSummary(event: SessionTimelineEvent) {
  if ((event.kind === "tool-call" || event.kind === "shell-command") && event.summary) {
    return {
      summaryDetail: (
        <TimelineEvidencePreview
          id={event.id}
          label={event.kind === "tool-call" ? "Tool evidence" : "Shell output"}
          value={event.summary}
        />
      )
    };
  }

  return {
    description: event.summary
  };
}

type PreviewResponse = Awaited<ReturnType<typeof getOutputArtifactPreview>>;
type LoadResponse = Awaited<ReturnType<typeof loadOutputArtifact>>;
type ArtifactResult =
  | Extract<PreviewResponse, { ok: true }>["preview"]
  | Extract<LoadResponse, { ok: true }>["artifact"];

type ArtifactState =
  | {
      status: "loading";
      mode: "preview" | "load";
    }
  | {
      status: "ready";
      result: ArtifactResult;
    }
  | {
      status: "error";
      message: string;
    };

function renderArtifactState(state: ArtifactState | undefined) {
  if (!state) {
    return null;
  }

  if (state.status === "loading") {
    return (
      <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {state.mode === "preview" ? "Loading output artifact preview." : "Loading output artifact."}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {state.message}
      </p>
    );
  }

  if (state.result.status === "preview-ready" || state.result.status === "loaded") {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {state.result.status === "preview-ready" ? "Preview Ready" : "Loaded"}
          </Badge>
          {state.result.status === "preview-ready" && state.result.truncated ? (
            <Badge variant="secondary">Truncated</Badge>
          ) : null}
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs text-foreground">
          {state.result.text}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2">
      <p className="text-xs font-medium text-foreground">{humanizeArtifactStatus(state.result.status)}</p>
      <p className="text-xs text-muted-foreground">{state.result.reason}</p>
    </div>
  );
}

function humanizeArtifactStatus(status: ArtifactResult["status"]): string {
  switch (status) {
    case "missing":
      return "Missing";
    case "unavailable":
      return "Unavailable";
    case "unsupported":
      return "Unsupported";
    case "unreadable":
      return "Unreadable";
    case "preview-ready":
      return "Preview Ready";
    case "loaded":
      return "Loaded";
  }
}

function buildArtifactStateKey(sessionId: string, outputArtifactId: string): string {
  return `${sessionId}:${outputArtifactId}`;
}
