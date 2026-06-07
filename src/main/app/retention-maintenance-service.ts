import type {
  RetentionJobStatusViewModel,
  SettingsViewModel,
  UpdateSettingsRequest,
  UpdateSettingsResult
} from "../ipc/view-models.js";
import type { SourceId } from "../core/model/identifiers.js";
import { calculateRetentionCutoffIso } from "./app-settings-store.js";
import type { ScanSourceMaintenanceLease } from "./scan-job-runner.js";
import { syncLatestSourceCacheRecordToEntityStore } from "./workbench-entity-store-sync.js";
import type { WorkbenchRuntime } from "./workbench-runtime.js";

export type RetentionMaintenanceListener = (status: RetentionJobStatusViewModel) => void;

export interface RetentionMaintenanceService {
  getSettings(): Promise<SettingsViewModel>;
  getStatus(): RetentionJobStatusViewModel;
  onStatusChanged(listener: RetentionMaintenanceListener): () => void;
  updateSettings(request: UpdateSettingsRequest): Promise<UpdateSettingsResult>;
}

export interface RetentionMaintenanceServiceOptions {
  runtime: WorkbenchRuntime;
}

interface RetentionMaintenanceFailure extends Error {
  completedSources?: number;
  sourceId?: SourceId;
  totalSources?: number;
}

export function createRetentionMaintenanceService({
  runtime
}: RetentionMaintenanceServiceOptions): RetentionMaintenanceService {
  const listeners = new Set<RetentionMaintenanceListener>();
  let activeJob: Promise<void> | undefined;
  let status: RetentionJobStatusViewModel = {
    state: "idle"
  };

  function notify(nextStatus: RetentionJobStatusViewModel) {
    status = nextStatus;

    for (const listener of listeners) {
      listener(status);
    }
  }

  async function localScannedSourceIds(): Promise<SourceId[]> {
    const sources = await runtime.sourceRegistry.listSources();

    return sources
      .filter(
        (source) =>
          source.sourceKind === "local-root" &&
          !source.readOnly &&
          source.enabled &&
          source.validation.status === "valid" &&
          (source.scan.status === "cached" ||
            source.scan.status === "scanned-with-diagnostics" ||
            source.cache.status === "cached" ||
            source.cache.status === "stale")
      )
      .map((source) => source.sourceId);
  }

  function startJob(
    phase: Extract<RetentionJobStatusViewModel["state"], "trimming" | "clearing" | "rescanning">,
    retentionDays: SettingsViewModel["retentionDays"],
    operation: () => Promise<void>
  ): Promise<void> | undefined {
    if (activeJob) {
      return undefined;
    }

    const startedAt = new Date().toISOString();

    notify({
      state: phase,
      retentionDays,
      startedAt,
      message: phase === "trimming" ? "Trimming stored sessions." : "Refreshing stored sessions."
    });

    activeJob = operation()
      .then(() => {
        notify({
          state: "idle",
          retentionDays,
          completedAt: new Date().toISOString()
        });
      })
      .catch((error) => {
        const failure = error as RetentionMaintenanceFailure;

        notify({
          state: "failed",
          retentionDays,
          startedAt,
          ...(failure.completedSources !== undefined
            ? { completedSources: failure.completedSources }
            : status.completedSources !== undefined
              ? { completedSources: status.completedSources }
              : {}),
          ...(failure.totalSources !== undefined
            ? { totalSources: failure.totalSources }
            : status.totalSources !== undefined
              ? { totalSources: status.totalSources }
              : {}),
          completedAt: new Date().toISOString(),
          message:
            error instanceof Error ? error.message : "Retention maintenance failed."
        });
      })
      .finally(() => {
        activeJob = undefined;
      });

    return activeJob;
  }

  async function clearLocalSourceData(sourceId: SourceId) {
    await runtime.cacheStore.replaceSourceRecords([sourceId], []);
    await runtime.rawArtifactIndex.replaceSourceEntries(sourceId, []);
    await runtime.entityStore.clearCurrentIngestRun({ sourceId });
    await runtime.entityStore.cleanupStaleRuns({
      beforeUpdatedAt: new Date().toISOString(),
      preservePublished: false,
      sourceId
    });
    const source = await runtime.sourceRegistry.getSource(sourceId);

    if (!source) {
      return;
    }

    await runtime.sourceRegistry.saveScanSummary(sourceId, {
      status: "never-scanned",
      diagnostics: source.scan.diagnostics,
      reason: "Stored source data was cleared for retention maintenance."
    });
    await runtime.sourceRegistry.saveCacheSummary(sourceId, {
      status: "unknown",
      diagnostics: source.cache.diagnostics,
      reason: "Stored source data was cleared for retention maintenance."
    });
  }

  async function rescanSource(
    sourceId: SourceId,
    sessionStartedAtCutoff: string
  ) {
    await runtime.scanJobRunner.scanSource(sourceId, {
      ignoreMaintenanceLease: true,
      sessionStartedAtCutoff
    });
    await syncLatestSourceCacheRecordToEntityStore(runtime, sourceId);
  }

  async function acquireMaintenanceLeases(sourceIds: SourceId[]): Promise<() => void> {
    const leases: ScanSourceMaintenanceLease[] = [];

    try {
      for (const sourceId of sourceIds) {
        leases.push(await runtime.scanJobRunner.acquireSourceMaintenanceLease(sourceId));
      }
    } catch (error) {
      releaseMaintenanceLeases(leases);
      throw error;
    }

    return () => {
      releaseMaintenanceLeases(leases);
    };
  }

  async function rebuildLocalSources(
    sourceIds: SourceId[],
    retentionDays: SettingsViewModel["retentionDays"]
  ) {
    const startedAt = status.startedAt ?? new Date().toISOString();
    const sessionStartedAtCutoff = calculateRetentionCutoffIso(retentionDays);
    let completedSources = 0;

    for (const sourceId of sourceIds) {
      notify({
        state: "clearing",
        retentionDays,
        startedAt,
        completedSources,
        totalSources: sourceIds.length,
        message: "Clearing app-owned session data."
      });
      try {
        await clearLocalSourceData(sourceId);
      } catch (error) {
        throw buildRetentionMaintenanceFailure(error, {
          completedSources,
          phase: "clearing",
          sourceId,
          totalSources: sourceIds.length
        });
      }

      notify({
        state: "rescanning",
        retentionDays,
        startedAt,
        completedSources,
        totalSources: sourceIds.length,
        message: "Rescanning local sources with the selected timeframe."
      });
      try {
        await rescanSource(sourceId, sessionStartedAtCutoff);
      } catch (error) {
        throw buildRetentionMaintenanceFailure(error, {
          completedSources,
          phase: "rescanning",
          sourceId,
          totalSources: sourceIds.length
        });
      }
      completedSources += 1;

      notify({
        state: "rescanning",
        retentionDays,
        startedAt,
        completedSources,
        totalSources: sourceIds.length,
        message: "Rescanning local sources with the selected timeframe."
      });
    }
  }

  return {
    async getSettings() {
      return runtime.appSettingsStore.load();
    },
    getStatus() {
      return status;
    },
    onStatusChanged(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    async updateSettings(request) {
      if (activeJob) {
        return {
          status: "job-started",
          settings: await runtime.appSettingsStore.load(),
          job: status
        };
      }

      const current = await runtime.appSettingsStore.load();
      const next = {
        retentionDays: request.retentionDays
      };

      if (next.retentionDays === current.retentionDays) {
        return {
          status: "applied",
          settings: current
        };
      }

      const sourceIds = await localScannedSourceIds();
      const isIncrease = next.retentionDays > current.retentionDays;

      if (isIncrease && sourceIds.length > 0 && !request.confirmDestructiveRescan) {
        return {
          status: "confirmation-required",
          settings: current,
          requestedSettings: next
        };
      }

      if (sourceIds.length === 0) {
        await runtime.appSettingsStore.save(next);

        return {
          status: "applied",
          settings: next
        };
      }

      startJob(isIncrease ? "clearing" : "trimming", next.retentionDays, async () => {
        const releaseMaintenanceLeasesForJob = await acquireMaintenanceLeases(sourceIds);

        try {
          await rebuildLocalSources(sourceIds, next.retentionDays);
          await runtime.appSettingsStore.save(next);
        } finally {
          releaseMaintenanceLeasesForJob();
        }
      });

      return {
        status: "job-started",
        settings: current,
        job: {
          ...status
        }
      };
    }
  };
}

function buildRetentionMaintenanceFailure(
  error: unknown,
  context: {
    completedSources: number;
    phase: "clearing" | "rescanning";
    sourceId: SourceId;
    totalSources: number;
  }
): RetentionMaintenanceFailure {
  const detail =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Retention maintenance failed.";
  const failure = new Error(
    `${context.phase === "clearing" ? "Clearing" : "Rescanning"} source '${context.sourceId}' failed after ${
      context.completedSources
    } of ${context.totalSources} sources completed: ${detail}`
  ) as RetentionMaintenanceFailure;

  failure.completedSources = context.completedSources;
  failure.sourceId = context.sourceId;
  failure.totalSources = context.totalSources;

  return failure;
}

function releaseMaintenanceLeases(leases: ScanSourceMaintenanceLease[]): void {
  for (const lease of leases.reverse()) {
    lease.release();
  }
}
