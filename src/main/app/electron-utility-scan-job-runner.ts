import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDiagnostic } from "../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../core/model/confidence.js";
import type { SourceRegistry } from "../core/registry/source-registry.js";
import type {
  ScanJobRunner,
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
  const activeJobs = new Map<string, Promise<void>>();

  return {
    getActiveScanCount() {
      return activeJobs.size;
    },
    scanSource(sourceId) {
      const existing = activeJobs.get(sourceId);

      if (existing) {
        return existing;
      }

      const job = runWorkerScanJob(options, sourceId).finally(() => {
        activeJobs.delete(sourceId);
      });

      activeJobs.set(sourceId, job);
      return job;
    }
  };
}

async function runWorkerScanJob(
  options: ElectronUtilityScanJobRunnerOptions,
  sourceId: string
): Promise<void> {
  const source = await options.sourceRegistry.getSource(sourceId);

  if (!source) {
    throw new Error(`Source '${sourceId}' does not exist.`);
  }

  const request: ScanSourceWorkerRequest = {
    appDataDir: options.appDataDir,
    projectDir: options.projectDir,
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
