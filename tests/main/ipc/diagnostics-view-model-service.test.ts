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

  it("groups source, normalization, and capability diagnostics into sanitized DTOs", async () => {
    const runtime = await createScannedRuntime(tempDirs);
    const service = createDiagnosticsViewModelService({ runtime });
    const diagnostics = await service.listDiagnostics();

    expect(diagnostics.groups.length).toBeGreaterThan(0);
    expect(diagnostics.groups.some((group) => group.sourceArea === "capability")).toBe(true);
    expect(
      diagnostics.groups.every((group) =>
        group.diagnostics.every((diagnostic) => !diagnostic.message.includes("/tmp/"))
      )
    ).toBe(true);
  });
});
