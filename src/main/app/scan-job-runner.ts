import { Scanner } from "../core/ingestion/scanner.js";

export interface ScanJobRunner {
  getActiveScanCount(): number;
  scanSource(sourceId: string): Promise<void>;
}

export interface ScanSourceWorkerRequest {
  appDataDir: string;
  projectDir: string;
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

  return {
    getActiveScanCount() {
      return activeScans.size;
    },
    async scanSource(sourceId) {
      activeScans.add(sourceId);

      try {
        await options.getScanner().scanSource(sourceId);
      } finally {
        activeScans.delete(sourceId);
      }
    }
  };
}
