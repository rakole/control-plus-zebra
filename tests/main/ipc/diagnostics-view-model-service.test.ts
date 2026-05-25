import { afterEach, describe, expect, it } from "vitest";

import { createDiagnosticsViewModelService } from "../../../src/main/app/diagnostics-view-model-service.js";
import {
  cleanupTempDirs,
  createScannedRuntime
} from "./triage-test-runtime.js";

describe("diagnostics view model service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("groups source, normalization, and cache diagnostics into sanitized DTOs", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createDiagnosticsViewModelService({ runtime });
    const diagnostics = await service.listDiagnostics();

    expect(diagnostics.groups.length).toBeGreaterThan(0);
    expect(diagnostics.groups.some((group) => group.sourceArea === "capability")).toBe(false);
    expect(
      diagnostics.groups.every((group) =>
        group.diagnostics.every((diagnostic) => !diagnostic.message.includes("/tmp/"))
      )
    ).toBe(true);

    const rows = diagnostics.groups.flatMap((group) => group.diagnostics);
    const rowKeys = rows.map((row) =>
      [
        row.adapterId,
        row.code,
        row.severity,
        row.message,
        row.sessionId ?? "",
        row.sessionTitle ?? "",
        row.projectDisplayName ?? ""
      ].join("\0")
    );

    expect(new Set(rowKeys).size).toBe(rowKeys.length);
    expect(rows.filter((row) => row.sessionId).every((row) => row.sessionTitle)).toBe(true);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "github.pr.no-match",
          severity: "info"
        })
      ])
    );
  });
});
