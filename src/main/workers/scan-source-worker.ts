import { createWorkbenchRuntime } from "../app/workbench-runtime.js";
import type {
  ScanSourceWorkerRequest,
  ScanSourceWorkerResponse
} from "../app/scan-job-runner.js";

type UtilityProcessLike = NodeJS.Process & {
  parentPort?: {
    postMessage(message: unknown): void;
  };
};

async function main(): Promise<void> {
  const request = parseWorkerRequest(process.argv[2]);
  const runtime = createWorkbenchRuntime({
    appDataDir: request.appDataDir,
    projectDir: request.projectDir
  });

  try {
    await runtime.scanner.scanSource(request.sourceId, {
      ...(request.sessionStartedAtCutoff
        ? { sessionStartedAtCutoff: request.sessionStartedAtCutoff }
        : {})
    });
    postWorkerMessage({
      ok: true,
      sourceId: request.sourceId
    });
    process.exit(0);
  } catch (error) {
    postWorkerMessage({
      ok: false,
      sourceId: request.sourceId,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  } finally {
    runtime.entityStore.close();
  }
}

function parseWorkerRequest(raw: string | undefined): ScanSourceWorkerRequest {
  if (!raw) {
    throw new Error("Scan worker request payload is missing.");
  }

  const parsed = JSON.parse(raw) as Partial<ScanSourceWorkerRequest>;

  if (
    typeof parsed.appDataDir !== "string" ||
    parsed.appDataDir.length === 0 ||
    typeof parsed.projectDir !== "string" ||
    parsed.projectDir.length === 0 ||
    typeof parsed.sourceId !== "string" ||
    parsed.sourceId.length === 0
  ) {
    throw new Error("Scan worker request payload is invalid.");
  }

  return {
    appDataDir: parsed.appDataDir,
    projectDir: parsed.projectDir,
    ...(typeof parsed.sessionStartedAtCutoff === "string" && parsed.sessionStartedAtCutoff.length > 0
      ? { sessionStartedAtCutoff: parsed.sessionStartedAtCutoff }
      : {}),
    sourceId: parsed.sourceId
  };
}

function postWorkerMessage(message: ScanSourceWorkerResponse): void {
  (process as UtilityProcessLike).parentPort?.postMessage(message);
}

void main();
