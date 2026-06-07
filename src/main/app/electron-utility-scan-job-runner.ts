import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDiagnostic } from "../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../core/model/confidence.js";
import type { SourceRegistry } from "../core/registry/source-registry.js";
import type {
  ScanJobRunner,
  ScanSourceMaintenanceLease,
  ScanSourceJobOptions,
  ScanSourceWorkerRequest,
  ScanSourceWorkerResponse
} from "./scan-job-runner.js";

const MAX_FAILURE_MESSAGE_LENGTH = 512;
const MAX_STDERR_PREVIEW_LENGTH = 512;

interface UtilityProcessChild {
  on(event: string, listener: (...args: unknown[]) => void): this;
  stderr?: {
    on(event: "data", listener: (chunk: unknown) => void): void;
  } | null;
}

export interface ElectronUtilityScanJobRunnerOptions {
  appDataDir: string;
  forkUtilityProcess(
    modulePath: string,
    args: string[],
    options: { stdio: "pipe" }
  ): UtilityProcessChild;
  projectDir: string;
  sourceRegistry: SourceRegistry;
  workerScriptPath?: string;
}

export function createElectronUtilityScanJobRunner(
  options: ElectronUtilityScanJobRunnerOptions
): ScanJobRunner {
  const activeScans = new Set<string>();
  const enqueuedJobs = new Map<string, Promise<void>>();
  const sourceMaintenanceLocks = new Map<string, Promise<void>>();

  return {
    acquireSourceMaintenanceLease(sourceId) {
      const priorLock = sourceMaintenanceLocks.get(sourceId);
      const tail = latestQueuedJobForSource(enqueuedJobs, sourceId);
      let releaseBarrier: (() => void) | undefined;
      const released = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const waitForStart = waitForSourceBlockers([priorLock, tail]);
      const maintenanceGate = waitForStart.then(() => released);

      sourceMaintenanceLocks.set(sourceId, maintenanceGate);

      return waitForStart.then((): ScanSourceMaintenanceLease => {
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
      const existing = enqueuedJobs.get(scanKey);

      if (existing) {
        return existing;
      }

      const tail = latestQueuedJobForSource(enqueuedJobs, sourceId);
      const maintenanceLock = scanOptions?.ignoreMaintenanceLease
        ? undefined
        : sourceMaintenanceLocks.get(sourceId);
      const runScan = async () => {
        activeScans.add(scanKey);

        try {
          await runWorkerScanJob(options, sourceId, scanOptions);
        } finally {
          activeScans.delete(scanKey);
          enqueuedJobs.delete(scanKey);
        }
      };
      const blockers = [tail, maintenanceLock];
      const job = blockers.some((blocker) => blocker !== undefined)
        ? waitForSourceBlockers(blockers).then(runScan)
        : runScan();

      enqueuedJobs.set(scanKey, job);
      return job;
    }
  };
}

function latestQueuedJobForSource(
  enqueuedJobs: Map<string, Promise<void>>,
  sourceId: string
): Promise<void> | undefined {
  const sourcePrefix = `${sourceId}::`;
  let latest: Promise<void> | undefined;

  for (const [jobKey, job] of enqueuedJobs) {
    if (jobKey.startsWith(sourcePrefix)) {
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

async function runWorkerScanJob(
  options: ElectronUtilityScanJobRunnerOptions,
  sourceId: string,
  scanOptions?: ScanSourceJobOptions
): Promise<void> {
  const source = await options.sourceRegistry.getSource(sourceId);

  if (!source) {
    throw new Error(`Source '${sourceId}' does not exist.`);
  }

  const request: ScanSourceWorkerRequest = {
    appDataDir: options.appDataDir,
    projectDir: options.projectDir,
    ...(scanOptions?.sessionStartedAtCutoff
      ? { sessionStartedAtCutoff: scanOptions.sessionStartedAtCutoff }
      : {}),
    sourceId
  };
  const child = options.forkUtilityProcess(
    options.workerScriptPath ?? getDefaultWorkerScriptPath(),
    [JSON.stringify(request)],
    { stdio: "pipe" }
  );

  let settled = false;
  let response: ScanSourceWorkerResponse | undefined;
  let stderrPreview = "";

  child.stderr?.on("data", (chunk) => {
    if (stderrPreview.length >= MAX_STDERR_PREVIEW_LENGTH) {
      return;
    }

    stderrPreview = `${stderrPreview}${String(chunk)}`.slice(0, MAX_STDERR_PREVIEW_LENGTH);
  });

  const completion = new Promise<void>((resolve, reject) => {
    const finalize = async (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (!error) {
        resolve();
        return;
      }

      try {
        await markWorkerFailure({
          error,
          source,
          sourceRegistry: options.sourceRegistry,
          stderrPreview
        });
      } catch {
        // Preserve the original worker failure for callers.
      }

      reject(error);
    };

    child.on("message", (message) => {
      response = parseWorkerResponse(message);
    });
    child.on("error", (...args) => {
      void finalize(normalizeWorkerError(args));
    });
    child.on("exit", (code) => {
      if (response?.ok) {
        void finalize(code === 0 ? undefined : new Error(`Scan worker exited with code ${code ?? "unknown"}.`));
        return;
      }

      const message =
        response && !response.ok
          ? response.errorMessage
          : `Scan worker exited before reporting success (code ${code ?? "unknown"}).`;

      void finalize(new Error(composeFailureMessage(message, stderrPreview)));
    });
  });

  return completion;
}

function getDefaultWorkerScriptPath(): string {
  const moduleDirectory =
    typeof __dirname === "string"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));

  return path.join(moduleDirectory, "scan-source-worker.cjs");
}

function parseWorkerResponse(message: unknown): ScanSourceWorkerResponse | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const candidate = message as Partial<ScanSourceWorkerResponse>;

  if (candidate.ok === true && typeof candidate.sourceId === "string") {
    return {
      ok: true,
      sourceId: candidate.sourceId
    };
  }

  if (
    candidate.ok === false &&
    typeof candidate.sourceId === "string" &&
    typeof candidate.errorMessage === "string"
  ) {
    return {
      ok: false,
      errorMessage: candidate.errorMessage,
      sourceId: candidate.sourceId
    };
  }

  return undefined;
}

async function markWorkerFailure(args: {
  error: Error;
  source: Awaited<ReturnType<SourceRegistry["getSource"]>>;
  sourceRegistry: SourceRegistry;
  stderrPreview: string;
}): Promise<void> {
  if (!args.source) {
    return;
  }

  const failureDiagnostic = buildDiagnostic(
    args.source.adapterId,
    "scanner.scan.worker-failed",
    truncateMessage(args.error.message),
    "error",
    "source",
    HIGH_CONFIDENCE,
    {
      sourceId: args.source.sourceId,
      nativeId: args.source.rootPath
    }
  );
  const failureDiagnostics = [...args.source.validation.diagnostics, failureDiagnostic];

  await args.sourceRegistry.saveScanSummary(args.source.sourceId, {
    status: "scan-failed",
    diagnostics: failureDiagnostics
  });
  await args.sourceRegistry.saveCacheSummary(args.source.sourceId, {
    status: "unknown",
    diagnostics: failureDiagnostics
  });
}

function composeFailureMessage(message: string, stderrPreview: string): string {
  if (!stderrPreview.trim()) {
    return truncateMessage(message);
  }

  return truncateMessage(`${message} stderr: ${stderrPreview.trim()}`);
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_FAILURE_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 3)}...`;
}

function normalizeWorkerError(args: unknown[]): Error {
  const [first, second, third] = args;

  if (first instanceof Error) {
    return first;
  }

  const parts = [first, second, third]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value));

  return new Error(parts.length > 0 ? parts.join(" ") : "Scan worker emitted an unknown error.");
}
