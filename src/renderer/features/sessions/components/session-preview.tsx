import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { CapabilityBadge } from "../../../components/app/capability-badge.js";
import { EmptyState } from "../../../components/app/empty-state.js";
import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { StatusChipTooltip } from "../../../components/app/status-chip-tooltip.js";
import {
  getCapabilityTooltip,
  getMetricTooltip,
  getTruthTooltip
} from "../../../components/app/status-chip-tooltips.js";
import { Toolbar } from "../../../components/app/toolbar.js";
import { TruthStateBadge } from "../../../components/app/truth-state-badge.js";
import { TooltipProvider } from "../../../components/ui/tooltip.js";
import { formatTimestamp } from "../format.js";
import { flattenSessionCapabilities, type SessionPreviewView } from "../types.js";

const evidenceLabels: Array<{
  key: keyof SessionPreviewView["evidenceMetrics"];
  label: string;
}> = [
  { key: "messages", label: "Messages" },
  { key: "toolCalls", label: "Tool calls" },
  { key: "shellCommands", label: "Shell command evidence" },
  { key: "outputArtifacts", label: "Output artifacts" },
  { key: "fileMutations", label: "File mutations" },
  { key: "diagnostics", label: "Diagnostics" }
];

interface SessionPreviewProps {
  session: SessionPreviewView | null;
  isLoading?: boolean | undefined;
  onOpenDetail?: (() => void) | undefined;
  onOpenRunAudit?: (() => void) | undefined;
}

export function SessionPreview({
  session,
  isLoading = false,
  onOpenDetail,
  onOpenRunAudit
}: SessionPreviewProps) {
  if (isLoading) {
    return (
      <section aria-label="Selected session preview loading" className="space-y-4 p-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }

  if (!session) {
    return (
      <section aria-label="Selected session preview" className="flex h-full items-center p-4">
        <EmptyState
          title="Select a session to inspect its summary."
          description="Preview state, evidence volume, and capability gaps before opening the deeper routes."
        />
      </section>
    );
  }

  const capabilityGaps = flattenSessionCapabilities(session.capabilityGroups).filter(
    (badge) => badge.state !== "Supported"
  );
  const truthBadges = [
    { key: "run-audit", label: "Run audit status", state: session.runAuditState },
    {
      key: "verification",
      label: "Verification status",
      state: session.verificationState
    }
  ];

  return (
    <TooltipProvider>
      <section aria-label="Selected session preview" className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
              {session.adapterDisplayName}
            </p>
            <h2 className="text-lg font-semibold text-foreground">{session.title}</h2>
            <p className="text-sm text-muted-foreground">
              {session.projectDisplayName ?? "Unknown"} · {session.nativeSessionId}
            </p>
          </div>
          <StatusChipTooltip
            tooltip={getTruthTooltip("Session lifecycle", session.lifecycleState)}
          >
            <TruthStateBadge
              state={session.lifecycleState}
              tooltip={getTruthTooltip("Session lifecycle", session.lifecycleState)}
            />
          </StatusChipTooltip>
        </div>

        <Toolbar ariaLabel="Session preview actions" className="border-0 bg-transparent px-0 py-0">
          <Button onClick={onOpenDetail} type="button" variant="outline">
            Open Session Detail
          </Button>
          <Button onClick={onOpenRunAudit} type="button" variant="outline">
            Open Run Audit
          </Button>
        </Toolbar>

        <div className="flex flex-wrap gap-2">
          {truthBadges.map(({ key, label, state }) => {
            const tooltip = getTruthTooltip(label, state);

            return (
              <StatusChipTooltip key={key} tooltip={tooltip}>
                <TruthStateBadge state={state} tooltip={tooltip} />
              </StatusChipTooltip>
            );
          })}
        </div>

        <MetadataGrid
          items={[
            { label: "Harness", value: session.adapterDisplayName },
            { label: "Started", value: formatTimestamp(session.startedAt) ?? "Unknown" },
            { label: "Ended", value: formatTimestamp(session.endedAt) ?? "Unknown" },
            { label: "Project", value: session.projectDisplayName ?? "Unknown" },
            { label: "Models", value: session.usageSummary.models.displayValue },
            { label: "Tokens", value: session.usageSummary.tokenCount.displayValue },
            { label: "Verification", value: session.verificationState.label },
            { label: "Run Audit", value: session.runAuditState.label }
          ]}
        />

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Capability Coverage</h3>
          <div className="flex flex-wrap gap-2">
            {(capabilityGaps.length > 0
              ? capabilityGaps
              : flattenSessionCapabilities(session.capabilityGroups).slice(0, 1)
            ).map((badge) => {
              const tooltip = getCapabilityTooltip(badge);

              return (
                <div
                  key={badge.key}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">{badge.label}</span>
                  <StatusChipTooltip tooltip={tooltip}>
                    <CapabilityBadge
                      label={badge.label}
                      state={badge.state}
                      tooltip={tooltip}
                      {...(badge.reason ? { reason: badge.reason } : {})}
                    />
                  </StatusChipTooltip>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Evidence Summary</h3>
            <p className="text-xs/relaxed text-muted-foreground">
              {session.firstUserPrompt ?? "No user prompt captured."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {evidenceLabels.map((item) => {
              const tooltip = getMetricTooltip(item.label, session.evidenceMetrics[item.key]);

              return (
                <StatusChipTooltip key={item.key} tooltip={tooltip}>
                  <Badge variant="outline" title={tooltip}>
                    {item.label}: {session.evidenceMetrics[item.key].displayValue}
                  </Badge>
                </StatusChipTooltip>
              );
            })}
          </div>
        </section>
      </section>
    </TooltipProvider>
  );
}
