import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import {
  buildSessionPreview,
  buildSessionSummary,
  installBridgeMocks
} from "./triage-test-helpers.js";

describe("Sessions route", () => {
  beforeEach(() => {
    window.location.hash = "#/sessions";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders live triage navigation and loads summaries through the preload bridge", async () => {
    const bridge = installBridgeMocks();
    render(<App />);

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Triage Data" })).toBeInTheDocument();

    await screen.findByRole("button", { name: /Fixture session/u });

    expect(bridge.listSessions).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(bridge.getSessionById).toHaveBeenCalledWith({ sessionId: "session-1" })
    );
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("updates the selected preview when a second row is clicked", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Bridge preview session/u }));

    await waitFor(() =>
      expect(bridge.getSessionById).toHaveBeenLastCalledWith({ sessionId: "session-2" })
    );
    expect(screen.getByRole("heading", { name: "Bridge preview session" })).toBeInTheDocument();
  });

  it("keeps unsupported and unknown capability states explicit", async () => {
    installBridgeMocks({
      firstSession: buildSessionSummary({
        verificationState: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
        runAuditState: { label: "Needs Review", tone: "warning" }
      }),
      firstPreview: buildSessionPreview({
        verificationState: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
        runAuditState: { label: "Needs Review", tone: "warning" }
      })
    });
    render(<App />);

    await screen.findByRole("button", { name: /Fixture session/u });

    const route = screen.getByLabelText("Sessions route");
    expect(within(route).getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(within(route).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(route).queryByText("Passed")).not.toBeInTheDocument();
    expect(within(route).queryByText("Clean")).not.toBeInTheDocument();
  });

  it("reloads sessions through the read-only list method", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Fixture session/u });
    await user.click(screen.getByRole("button", { name: "Reload Triage Data" }));

    await waitFor(() => expect(bridge.listSessions).toHaveBeenCalledTimes(2));
    expect(window.agentWorkbench).not.toHaveProperty("launchSession");
    expect(window.agentWorkbench).not.toHaveProperty("approveSession");
    expect(window.agentWorkbench).not.toHaveProperty("rejectSession");
  });
});
