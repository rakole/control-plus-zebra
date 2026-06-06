import * as HeatMapModule from "@uiw/react-heat-map";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type SVGProps
} from "react";
import type { HeatMapProps } from "@uiw/react-heat-map";

import {
  getOverviewActivityHeatmap,
  onSourceDataChanged
} from "../../../bridge/agent-workbench.js";
import { ErrorState } from "../../../components/app/error-state.js";
import { LoadingState } from "../../../components/app/loading-state.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";

type HeatmapResponse = Awaited<ReturnType<typeof getOverviewActivityHeatmap>>;
type HeatmapView = Extract<HeatmapResponse, { ok: true }>["heatmap"];

interface OverviewActivityHeatmapProps {
  selectedAdapterId: string;
}

const HEATMAP_ERROR_COPY =
  "Overview activity heatmap could not load. Check the preload bridge and IPC handler, then reload triage data.";

const HEATMAP_STYLE = {
  color: "var(--muted-foreground)",
  "--rhm-text-color": "var(--muted-foreground)",
  "--rhm-rect": "var(--muted)"
} as CSSProperties & Record<`--${string}`, string>;

const HEATMAP_PANEL_COLORS = [
  "var(--muted)",
  "color-mix(in oklch, var(--primary) 18%, var(--background))",
  "color-mix(in oklch, var(--primary) 36%, var(--background))",
  "color-mix(in oklch, var(--primary) 58%, var(--background))",
  "color-mix(in oklch, var(--primary) 82%, var(--background))"
];

const RECT_SIZE = 12;
const RECT_SPACE = 4;
const LEFT_PAD_WITHOUT_WEEK_LABELS = 5;
const HeatMap = HeatMapModule.default as unknown as (props: HeatMapProps) => ReactElement;

export default function OverviewActivityHeatmap({
  selectedAdapterId
}: OverviewActivityHeatmapProps) {
  const [heatmap, setHeatmap] = useState<HeatmapView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const isLiveRefresh = refreshToken > 0;

    if (!isLiveRefresh) {
      setHeatmap(null);
    }

    setIsLoading(!isLiveRefresh);
    setLoadFailed(false);

    getOverviewActivityHeatmap(selectedAdapterId === "all" ? {} : { adapterId: selectedAdapterId })
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setHeatmap(response.heatmap);
      })
      .catch(() => {
        if (isCurrent) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshToken, selectedAdapterId]);

  useEffect(() => {
    return onSourceDataChanged(() => {
      setRefreshToken((current) => current + 1);
    });
  }, []);

  if (isLoading) {
    return <OverviewActivityHeatmapLoadingCard />;
  }

  return (
    <section aria-label="Overview Activity Heatmap">
      <SectionCard
        title={<h2>Activity Heatmap</h2>}
        description="Fixed last 30 days of session volume. Outlined cells mark explicit attention."
        actions={heatmap && shouldShowCoverageState(heatmap.coverageState) ? <TruthStateBadge state={heatmap.coverageState} /> : null}
        contentClassName="space-y-4"
        footer={
          <p className="text-xs text-muted-foreground">
            Last 30 days only. Fuchsia intensity tracks session count.
          </p>
        }
      >
        {loadFailed || !heatmap ? (
          <ErrorState title={HEATMAP_ERROR_COPY} />
        ) : (
          <OverviewActivityHeatmapGrid heatmap={heatmap} />
        )}
      </SectionCard>
    </section>
  );
}

export function OverviewActivityHeatmapLoadingCard() {
  return (
    <section aria-label="Overview Activity Heatmap">
      <SectionCard
        title={<h2>Activity Heatmap</h2>}
        description="Fixed last 30 days of session volume. Outlined cells mark explicit attention."
      >
        <LoadingState
          title="Loading activity heatmap"
          description="Reading the last 30 days of session activity without blocking the rest of Overview."
        />
      </SectionCard>
    </section>
  );
}

function OverviewActivityHeatmapGrid({ heatmap }: { heatmap: HeatmapView }) {
  const bucketByDay = useMemo(
    () => new Map(heatmap.buckets.map((bucket) => [bucket.day, bucket] as const)),
    [heatmap.buckets]
  );
  const firstDay = heatmap.buckets[0]?.day;
  const lastDay = heatmap.buckets.at(-1)?.day;
  const startDate = firstDay ? parseIsoDay(firstDay) : null;
  const endDate = lastDay ? parseIsoDay(lastDay) : null;
  const leadingDayCount = startDate?.getDay() ?? 0;
  const weekCount = Math.ceil((leadingDayCount + heatmap.buckets.length) / 7);
  const svgWidth =
    LEFT_PAD_WITHOUT_WEEK_LABELS + weekCount * (RECT_SIZE + RECT_SPACE);

  if (!startDate || !endDate) {
    return (
      <p className="text-sm text-muted-foreground">
        No recent session activity is available for the last 30 days.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <HeatMap
        aria-label="Last 30 days of activity"
        className="min-w-max"
        endDate={endDate}
        height={84}
        legendCellSize={0}
        monthLabels={false}
        panelColors={HEATMAP_PANEL_COLORS}
        rectProps={{ rx: 3, ry: 3 }}
        rectRender={(
          props: SVGProps<SVGRectElement>,
          valueItem: { count: number; date: string; column: number; row: number; index: number }
        ) => {
          const isoDay = toIsoDay(valueItem.date);
          const bucket = bucketByDay.get(isoDay);

          if (!bucket) {
            return <rect {...props} aria-hidden="true" display="none" focusable="false" />;
          }

          const label = formatBucketLabel(bucket);

          return (
            <rect
              {...props}
              aria-label={label}
              data-testid="overview-activity-heatmap-cell"
              focusable="true"
              role="img"
              stroke={bucket.needsAttentionCount > 0 ? "var(--status-danger)" : "transparent"}
              strokeWidth={bucket.needsAttentionCount > 0 ? 1.5 : 0}
              tabIndex={0}
            >
              <title>{label}</title>
            </rect>
          );
        }}
        rectSize={RECT_SIZE}
        space={RECT_SPACE}
        startDate={startDate}
        style={HEATMAP_STYLE}
        value={heatmap.buckets.map((bucket) => ({
          count: bucket.sessionCount,
          date: toHeatMapDay(bucket.day)
        }))}
        weekLabels={false}
        width={svgWidth}
      />
    </div>
  );
}

function shouldShowCoverageState(coverageState: HeatmapView["coverageState"]) {
  return coverageState.label !== "Available";
}

function parseIsoDay(day: string) {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function toHeatMapDay(day: string) {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return `${year}/${month}/${date}`;
}

function toIsoDay(day: string) {
  const [year = 0, month = 1, date = 1] = day.split("/").map(Number);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${date
    .toString()
    .padStart(2, "0")}`;
}

function formatBucketLabel(bucket: HeatmapView["buckets"][number]) {
  return `${formatLongDate(bucket.day)}: ${formatCount(bucket.sessionCount, "session")}, ${formatNeedsAttentionCount(
    bucket.needsAttentionCount
  )}`;
}

function formatLongDate(day: string) {
  return parseIsoDay(day).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function formatNeedsAttentionCount(value: number) {
  if (value === 1) {
    return "1 session needs attention";
  }

  return `${value} sessions need attention`;
}
