type AgentWorkbenchBridge = Window["agentWorkbench"];
const RETENTION_JOB_STATUS_EVENT = "agent-workbench:retention-job-status";

export type SettingsResponse = Awaited<ReturnType<AgentWorkbenchBridge["getSettings"]>>;
export type UpdateSettingsRequest = Parameters<AgentWorkbenchBridge["updateSettings"]>[0];
export type UpdateSettingsResponse = Awaited<ReturnType<AgentWorkbenchBridge["updateSettings"]>>;
export type RetentionJobStatusResponse = Awaited<
  ReturnType<AgentWorkbenchBridge["getRetentionJobStatus"]>
>;
export type RetentionJobStatus = Extract<RetentionJobStatusResponse, { ok: true }>["job"];

function getBridge(): AgentWorkbenchBridge {
  return window.agentWorkbench;
}

export function getSettings(): Promise<SettingsResponse> {
  return getBridge().getSettings();
}

export function updateSettings(request: UpdateSettingsRequest): Promise<UpdateSettingsResponse> {
  return getBridge().updateSettings(request);
}

export function getRetentionJobStatus(): Promise<RetentionJobStatusResponse> {
  return getBridge().getRetentionJobStatus();
}

export function onRetentionJobChanged(
  callback: Parameters<AgentWorkbenchBridge["onRetentionJobChanged"]>[0]
) {
  return getBridge().onRetentionJobChanged(callback);
}

export function emitRetentionJobStatus(status: RetentionJobStatus): void {
  window.dispatchEvent(
    new CustomEvent<RetentionJobStatus>(RETENTION_JOB_STATUS_EVENT, {
      detail: status
    })
  );
}

export function onRetentionJobStatusDispatched(
  callback: (status: RetentionJobStatus) => void
): () => void {
  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    if (isRetentionJobStatus(event.detail)) {
      callback(event.detail);
    }
  };

  window.addEventListener(RETENTION_JOB_STATUS_EVENT, listener);

  return () => {
    window.removeEventListener(RETENTION_JOB_STATUS_EVENT, listener);
  };
}

function isRetentionJobStatus(value: unknown): value is RetentionJobStatus {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (!["idle", "trimming", "clearing", "rescanning", "failed"].includes(String(candidate.state))) {
    return false;
  }

  return (
    isOptionalRetentionDays(candidate.retentionDays) &&
    isOptionalString(candidate.startedAt) &&
    isOptionalString(candidate.completedAt) &&
    isOptionalNumber(candidate.completedSources) &&
    isOptionalNumber(candidate.totalSources) &&
    isOptionalString(candidate.message)
  );
}

function isOptionalRetentionDays(value: unknown): boolean {
  return value === undefined || value === 3 || value === 7 || value === 30;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}
