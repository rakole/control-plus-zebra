import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("renders grouped diagnostics through shared lists and supports severity filtering", async () => {
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
                code: "capability.gitContextCapture",
                severity: "warning",
                sourceArea: "capability",
                adapterId: "fake-test",
                adapterDisplayName: "Fake Test Harness",
                sessionId: "session-1",
                sessionTitle: "Fixture session",
                projectDisplayName: "Control Plus Zebra",
                message: "Git Context Capture is Unsupported. Git evidence is unavailable."
              }
            ]
          },
          {
            groupId: "cache:error",
            title: "Cache Errors",
            sourceArea: "cache",
            severity: "error",
            count: 1,
            diagnostics: [
              {
                code: "cache.unreadable",
                severity: "error",
                sourceArea: "cache",
                adapterId: "fake-test",
                adapterDisplayName: "Fake Test Harness",
                projectDisplayName: "Control Plus Zebra",
                message: "Cache metadata could not be read."
              }
            ]
          }
        ]
      })
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Diagnostics" })).toBeInTheDocument();
    const route = screen.getByRole("region", { name: "Diagnostics route" });

    const warningGroup = within(route).getByRole("region", { name: "Capability Warnings" });
    expect(within(warningGroup).getByText("Git Context Capture is Unsupported. Git evidence is unavailable.")).toBeInTheDocument();
    expect(within(warningGroup).getByText("Fake Test Harness")).toBeInTheDocument();

    const errorGroup = within(route).getByRole("region", { name: "Cache Errors" });
    expect(within(errorGroup).getByText("Cache metadata could not be read.")).toBeInTheDocument();
    expect(within(errorGroup).getByText("error")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Severity" }), "error");

    expect(screen.queryByRole("region", { name: "Capability Warnings" })).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Cache Errors" })).toBeInTheDocument();
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
