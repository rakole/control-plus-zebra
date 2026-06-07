import { Scanner } from "../core/ingestion/scanner.js";

export interface ScanJobRunner {
  acquireSourceMaintenanceLease(sourceId: string): Promise<ScanSourceMaintenanceLease>;
  getActiveScanCount(): number;
  scanSource(sourceId: string, options?: ScanSourceJobOptions): Promise<void>;
}

export interface ScanSourceMaintenanceLease {
  release(): void;
}

export interface ScanSourceJobOptions {
  ignoreMaintenanceLease?: boolean;
  sessionStartedAtCutoff?: string;
}

export interface ScanSourceWorkerRequest {
  appDataDir: string;
  projectDir: string;
  sessionStartedAtCutoff?: string;
  sourceId: string;
}

export interface ScanSourceWorkerSuccess {
  ok: true;
  sourceId: string;
}

export interface ScanSourceWorkerFailure {
  ok: false;
  errorMessage: string;
  sourceId: string;
}

export type ScanSourceWorkerResponse = ScanSourceWorkerFailure | ScanSourceWorkerSuccess;

export function createInProcessScanJobRunner(options: {
  getScanner(): Scanner;
}): ScanJobRunner {
  const activeScans = new Set<string>();
  const enqueuedScans = new Map<string, Promise<void>>();
  const sourceMaintenanceLocks = new Map<string, Promise<void>>();

  return {
    acquireSourceMaintenanceLease(sourceId) {
      const priorLock = sourceMaintenanceLocks.get(sourceId);
      const tail = latestQueuedScanForSource(enqueuedScans, sourceId);
      let releaseBarrier: (() => void) | undefined;
      const released = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const waitForStart = waitForSourceBlockers([priorLock, tail]);
      const maintenanceGate = waitForStart.then(() => released);

      sourceMaintenanceLocks.set(sourceId, maintenanceGate);

      return waitForStart.then(() => {
        let releasedOnce = false;

        return {
          release() {
            if (releasedOnce) {
              return;
            }

            releasedOnce = true;
            releaseBarrier?.();

            if (sourceMaintenanceLocks.get(sourceId) === maintenanceGate) {
              sourceMaintenanceLocks.delete(sourceId);
            }
          }
        };
      });
    },
    getActiveScanCount() {
      return activeScans.size;
    },
    scanSource(sourceId, scanOptions) {
      const scanKey = createScanJobKey(sourceId, scanOptions);
      const existing = enqueuedScans.get(scanKey);

      if (existing) {
        return existing;
      }

      const tail = latestQueuedScanForSource(enqueuedScans, sourceId);
      const maintenanceLock = scanOptions?.ignoreMaintenanceLease
        ? undefined
        : sourceMaintenanceLocks.get(sourceId);
      const runScan = async () => {
        activeScans.add(scanKey);

        try {
          await options.getScanner().scanSource(sourceId, scanOptions);
        } finally {
          activeScans.delete(scanKey);
          enqueuedScans.delete(scanKey);
        }
      };
      const blockers = [tail, maintenanceLock];
      const job = blockers.some((blocker) => blocker !== undefined)
        ? waitForSourceBlockers(blockers).then(runScan)
        : runScan();

      enqueuedScans.set(scanKey, job);

      return job;
    }
  };
}

function latestQueuedScanForSource(
  enqueuedScans: Map<string, Promise<void>>,
  sourceId: string
): Promise<void> | undefined {
  const sourcePrefix = `${sourceId}::`;
  let latest: Promise<void> | undefined;

  for (const [scanKey, job] of enqueuedScans) {
    if (scanKey.startsWith(sourcePrefix)) {
      latest = job;
    }
  }

  return latest;
}

function createScanJobKey(sourceId: string, scanOptions?: ScanSourceJobOptions): string {
  return `${sourceId}::${scanOptions?.sessionStartedAtCutoff ?? ""}`;
}

function waitForSourceBlockers(
  blockers: Array<Promise<void> | undefined>
): Promise<void> {
  return Promise.all(blockers.filter((blocker): blocker is Promise<void> => blocker !== undefined)).then(
    () => undefined,
    swallowQueuedFailure
  );
}

function swallowQueuedFailure(): void {
  // Later same-source scans still need a chance to run after an earlier failure.
}
