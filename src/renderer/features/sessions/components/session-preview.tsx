import { useEffect, useId, useState } from "react";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileCode2,
  FolderTree,
  MessagesSquare,
  Sparkles,
  TerminalSquare,
  Wrench
} from "lucide-react";

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
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { TooltipProvider } from "../../../components/ui/tooltip.js";
import { formatTokenMetric } from "../../../lib/format-token-metric.js";
import { formatSessionRange } from "../format.js";
import { getSessionPrimaryVerdict, getSessionReason } from "../session-triage-helpers.js";
import { flattenSessionCapabilities, type SessionPreviewView } from "../types.js";

const evidenceSpineItems: Array<{
  key: keyof SessionPreviewView["evidenceMetrics"];
  label: string;
  emptyLabel: string;
  Icon: typeof MessagesSquare;
}> = [
  {
    key: "messages",
    label: "Messages",
    emptyLabel: "No message evidence",
    Icon: MessagesSquare
  },
  {
    key: "toolCalls",
    label: "Tools",
    emptyLabel: "No tool evidence",
    Icon: Wrench
  },
  {
    key: "shellCommands",
    label: "Shell",
    emptyLabel: "No shell evidence",
    Icon: TerminalSquare
  },
  {
    key: "fileMutations",
    label: "Files",
    emptyLabel: "No file evidence",
    Icon: FolderTree
  },
  {
    key: "diagnostics",
    label: "Diagnostics",
    emptyLabel: "No diagnostics",
    Icon: AlertTriangle
  }
];

type EvidenceMetric = SessionPreviewView["evidenceMetrics"][keyof SessionPreviewView["evidenceMetrics"]];
type TriageMetric = SessionPreviewView["triageMetrics"][keyof SessionPreviewView["triageMetrics"]];

function getMetricNumericValue(metric: EvidenceMetric | TriageMetric): number {
  if (typeof metric.numericValue === "number" && Number.isFinite(metric.numericValue)) {
    return metric.numericValue;
  }

  const parsed = Number.parseInt(metric.displayValue, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getMetricDisplay(metric: EvidenceMetric, emptyLabel: string): string {
  if (metric.status === "value") {
    return metric.displayValue;
  }

  if (metric.status === "not-run") {
    return "Not run";
  }

  return emptyLabel;
}

function getMetricAccentClass(
  key: keyof SessionPreviewView["evidenceMetrics"],
  metric: EvidenceMetric
): string {
  if (metric.status !== "value") {
    return "border-dashed border-border/70 bg-background/60";
  }

  if (key === "diagnostics" && getMetricNumericValue(metric) > 0) {
    return "border-amber-500/40 bg-amber-500/8";
  }

  return "border-border bg-muted/20";
}

function formatDiagnosticSeverity(
  severity: SessionPreviewView["diagnostics"][number]["severity"]
): string {
  switch (severity) {
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

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
  const capabilityDetailsId = useId();
  const [isCapabilityExpanded, setIsCapabilityExpanded] = useState(false);

  useEffect(() => {
    setIsCapabilityExpanded(false);
  }, [session?.sessionId]);

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
          description="Preview the verdict, evidence trail, and capability coverage before opening the deeper routes."
        />
      </section>
    );
  }

  const primaryVerdict = getSessionPrimaryVerdict(session);
  const primaryReason = getSessionReason(session);
  const failedCommandMetric = session.triageMetrics.failedCommands;
  const failedCommandCount = getMetricNumericValue(session.triageMetrics.failedCommands);
  const fileMutationMetric = session.evidenceMetrics.fileMutations;
  const fileMutationCount = getMetricNumericValue(session.evidenceMetrics.fileMutations);
  const capabilities = flattenSessionCapabilities(session.capabilityGroups);
  const capabilityGaps = capabilities.filter((capability) => capability.state !== "Supported");
  const supportedCapabilityCount = capabilities.filter(
    (capability) => capability.state === "Supported"
  ).length;
  const statusSignalSummary =
    session.attentionReasons.length > 0
      ? session.attentionReasons.join(" · ")
      : session.lifecycleState.reason ?? "No additional attention signal exposed.";
  const tokenMetricItems = [
    { label: "Total Tokens", value: formatTokenMetric(session.usageSummary.tokenMetrics.totalTokens) },
    { label: "Input", value: formatTokenMetric(session.usageSummary.tokenMetrics.inputTokens) },
    { label: "Output", value: formatTokenMetric(session.usageSummary.tokenMetrics.outputTokens) },
    { label: "Thoughts", value: formatTokenMetric(session.usageSummary.tokenMetrics.thoughtTokens) },
    {
      label: "Cached Input (subset of Input)",
      value: formatTokenMetric(session.usageSummary.tokenMetrics.cacheReadTokens)
    }
  ];
  const metadataItems = [
    { label: "Models", value: session.usageSummary.models.displayValue },
    ...tokenMetricItems,
    { label: "Session ID", value: session.sessionId },
    {
      label: "Native Session ID",
      value: session.nativeSessionId ?? "No exposed native session ID."
    },
    { label: "Source ID", value: session.sourceId },
    {
      label: "First Prompt",
      value: session.firstUserPrompt ?? "No prompt preview exposed."
    },
    {
      label: "Output Artifacts",
      value: getMetricDisplay(session.evidenceMetrics.outputArtifacts, "No artifact evidence exposed.")
    },
    {
      label: "Diagnostic Warnings",
      value:
        session.diagnosticWarningCount > 0
          ? String(session.diagnosticWarningCount)
          : "No diagnostic warnings exposed."
    }
  ];
  return (
    <TooltipProvider>
      <section aria-label="Selected session preview" className="space-y-5 p-4">
        <section className="space-y-4 rounded-lg border border-border bg-card/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChipTooltip
                  tooltip={getTruthTooltip("Primary verdict", primaryVerdict)}
                >
                  <TruthStateBadge
                    state={primaryVerdict}
                    tooltip={getTruthTooltip("Primary verdict", primaryVerdict)}
                  />
                </StatusChipTooltip>
                <span className="text-xs text-muted-foreground">{primaryReason}</span>
              </div>
              <div className="space-y-1">
                <p className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                  {session.adapterDisplayName}
                </p>
                <h2 className="text-lg font-semibold text-foreground">{session.title}</h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Project: {session.projectDisplayName ?? "Unknown"}</Badge>
                <Badge variant="outline">Time: {formatSessionRange(session)}</Badge>
                <Badge variant="outline">Model: {session.usageSummary.models.displayValue}</Badge>
                <Badge variant="outline">
                  Input: {formatTokenMetric(session.usageSummary.tokenMetrics.inputTokens)}
                </Badge>
                <Badge variant="outline">
                  Output: {formatTokenMetric(session.usageSummary.tokenMetrics.outputTokens)}
                </Badge>
                <Badge variant="outline">
                  Thoughts: {formatTokenMetric(session.usageSummary.tokenMetrics.thoughtTokens)}
                </Badge>
                <Badge variant="outline">
                  Cached Input: {formatTokenMetric(session.usageSummary.tokenMetrics.cacheReadTokens)}
                </Badge>
              </div>
            </div>
            <Toolbar
              ariaLabel="Session preview actions"
              className="border-0 bg-transparent px-0 py-0"
            >
              <Button onClick={onOpenDetail} type="button">
                Open Session Detail
              </Button>
              <Button onClick={onOpenRunAudit} type="button">
                Open Run Audit
              </Button>
            </Toolbar>
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Status Signals vs Evidence</h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Compare exposed status signals against the current verification and run-audit truth.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Status Signal
                </span>
                <StatusChipTooltip
                  tooltip={getTruthTooltip("Session lifecycle", session.lifecycleState)}
                >
                  <TruthStateBadge
                    state={session.lifecycleState}
                    tooltip={getTruthTooltip("Session lifecycle", session.lifecycleState)}
                  />
                </StatusChipTooltip>
              </div>
              <p className="text-sm text-muted-foreground">{statusSignalSummary}</p>
            </div>
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Verification
                </span>
                <StatusChipTooltip
                  tooltip={getTruthTooltip("Verification status", session.verificationState)}
                >
                  <TruthStateBadge
                    state={session.verificationState}
                    tooltip={getTruthTooltip("Verification status", session.verificationState)}
                  />
                </StatusChipTooltip>
              </div>
              <p className="text-sm text-muted-foreground">
                {session.verificationState.reason ?? "No verification detail exposed in this preview."}
              </p>
            </div>
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Run Audit
                </span>
                <StatusChipTooltip
                  tooltip={getTruthTooltip("Run audit status", session.runAuditState)}
                >
                  <TruthStateBadge
                    state={session.runAuditState}
                    tooltip={getTruthTooltip("Run audit status", session.runAuditState)}
                  />
                </StatusChipTooltip>
              </div>
              <p className="text-sm text-muted-foreground">
                {session.runAuditState.reason ?? "No run-audit detail exposed in this preview."}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Evidence Spine</h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Evidence volume across the preview fields that shape triage.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {evidenceSpineItems.map(({ key, label, emptyLabel, Icon }) => {
              const metric = session.evidenceMetrics[key];
              const tooltip = getMetricTooltip(label, metric);

              return (
                <StatusChipTooltip key={key} tooltip={tooltip}>
                  <div
                    className={`space-y-2 rounded-lg border p-3 ${getMetricAccentClass(key, metric)}`}
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Icon className="size-4" />
                      <span className="text-xs font-medium uppercase">{label}</span>
                    </div>
                    <p className="text-lg font-semibold text-foreground" title={tooltip}>
                      {getMetricDisplay(metric, emptyLabel)}
                    </p>
                  </div>
                </StatusChipTooltip>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Diagnostics and Failure Proxy</h3>
            <p className="text-xs/relaxed text-muted-foreground">
              This preview exposes failed-command counts and diagnostics, not full command details.
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TerminalSquare className="size-4" />
                <span className="text-xs font-medium uppercase">Failed Commands</span>
              </div>
              <p
                className="text-lg font-semibold text-foreground"
                title={getMetricTooltip("Failed commands", failedCommandMetric, "failed")}
              >
                {failedCommandMetric.status === "value" && Number.isFinite(failedCommandCount)
                  ? failedCommandCount
                  : failedCommandMetric.displayValue}
              </p>
              <p className="text-sm text-muted-foreground">
                {failedCommandMetric.status === "value" &&
                Number.isFinite(failedCommandCount) &&
                failedCommandCount > 0
                  ? "Command names and exit details are not exposed here. Open Run Audit for the deeper route."
                  : failedCommandMetric.status === "value"
                    ? "No failed commands were recorded."
                    : failedCommandMetric.status === "not-run"
                      ? "Command execution was not run for this session."
                      : "No failed command detail was exposed for this session."}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4" />
                <span className="text-xs font-medium uppercase">Diagnostics</span>
              </div>
              {session.diagnostics.length > 0 ? (
                <ul className="space-y-2">
                  {session.diagnostics.map((diagnostic) => (
                    <li
                      key={`${diagnostic.code}-${diagnostic.message}`}
                      className="rounded-md border border-border bg-background/70 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {formatDiagnosticSeverity(diagnostic.severity)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{diagnostic.code}</span>
                      </div>
                      <p className="mt-2 text-sm text-foreground">{diagnostic.message}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No diagnostics were exposed for this session preview.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Evidence and Usage Metadata</h3>
            <p className="text-xs/relaxed text-muted-foreground">
              Provenance and usage details exposed on the preview DTO.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileCode2 className="size-4" />
              <span className="text-xs font-medium uppercase">Files and Mutations</span>
            </div>
            <p
              className="mt-2 text-lg font-semibold text-foreground"
              title={getMetricTooltip("File mutations", fileMutationMetric, "files")}
            >
              {fileMutationMetric.status === "value" && Number.isFinite(fileMutationCount)
                ? fileMutationCount
                : fileMutationMetric.displayValue}
            </p>
            <p className="text-sm text-muted-foreground">
              {fileMutationMetric.status === "value" &&
              Number.isFinite(fileMutationCount) &&
              fileMutationCount > 0
                ? "File mutations were recorded, but this preview does not expose touched paths or diff detail."
                : fileMutationMetric.status === "value"
                  ? "No file mutations were recorded."
                  : fileMutationMetric.status === "not-run"
                    ? "File mutation tracking was not run for this session."
                    : "No file mutation evidence was exposed for this session preview."}
            </p>
          </div>
          <MetadataGrid items={metadataItems} />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">Capability Coverage</h3>
              <p className="text-xs text-muted-foreground">
                {supportedCapabilityCount} / {capabilities.length} supported
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {capabilityGaps.slice(0, 2).map((capability) => {
                const tooltip = getCapabilityTooltip(capability);

                return (
                  <StatusChipTooltip key={capability.key} tooltip={tooltip}>
                    <CapabilityBadge
                      label={capability.label}
                      state={capability.state}
                      tooltip={tooltip}
                      {...(capability.reason ? { reason: capability.reason } : {})}
                    />
                  </StatusChipTooltip>
                );
              })}
              <Button
                aria-controls={capabilityDetailsId}
                aria-expanded={isCapabilityExpanded}
                onClick={() => setIsCapabilityExpanded((current) => !current)}
                size="sm"
                type="button"
                variant="outline"
              >
                {isCapabilityExpanded ? (
                  <>
                    Hide details
                    <ChevronUp />
                  </>
                ) : (
                  <>
                    View details
                    <ChevronDown />
                  </>
                )}
              </Button>
            </div>
          </div>
          <div
            aria-hidden={!isCapabilityExpanded}
            className={isCapabilityExpanded ? "space-y-3" : "hidden"}
            id={capabilityDetailsId}
          >
            {session.capabilityGroups.length > 0 ? (
              session.capabilityGroups.map((group) => (
                <div
                  key={group.key}
                  className="space-y-2 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="size-4" />
                    <span className="text-xs font-medium uppercase">{group.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.capabilities.map((capability) => {
                      const tooltip = getCapabilityTooltip(capability);

                      return (
                        <StatusChipTooltip key={capability.key} tooltip={tooltip}>
                          <CapabilityBadge
                            label={capability.label}
                            state={capability.state}
                            tooltip={tooltip}
                            {...(capability.reason ? { reason: capability.reason } : {})}
                          />
                        </StatusChipTooltip>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No capability coverage was exposed.</p>
            )}
          </div>
        </section>
      </section>
    </TooltipProvider>
  );
}
