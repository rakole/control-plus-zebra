import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { buildDiagnostics, installBridgeMocks } from "./triage-test-helpers.js";

describe("Diagnostics route", () => {
  beforeEach(() => {
    window.location.hash = "#/diagnostics";
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders grouped diagnostics and supports severity filtering", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByText("Capability Warnings")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox"), "error");
    expect(
      await screen.findByText("No diagnostics match the current filters")
    ).toBeInTheDocument();
  });

  it("keeps unsupported and unknown states visible in grouped diagnostics", async () => {
    cleanup();
    window.location.hash = "#/diagnostics";
    installBridgeMocks({
      diagnostics: buildDiagnostics({
        groups: [
          {
            groupId: "capability:warning",
            title: "Capability Warnings",
            sourceArea: "capability",
            severity: "warning",
            count: 1,
            diagnostics: [
              {
                code: "capability.verificationSignals",
                severity: "warning",
                sourceArea: "capability",
                adapterId: "fake-test",
                adapterDisplayName: "Fake Test Harness",
                message: "Verification Signals is Unknown."
              }
            ]
          }
        ]
      })
    });
    render(<App />);

    expect(await screen.findByText("Verification Signals is Unknown.")).toBeInTheDocument();
  });
});
