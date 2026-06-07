import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

describe("Settings route", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/#/settings");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("marks the default retention window as selected", async () => {
    installBridgeMocks();

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });

    expect(screen.getByRole("radio", { name: "7 days" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "3 days" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "30 days" })).not.toBeChecked();
  });

  it("confirms destructive retention increases before resubmitting with confirmation", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();

    bridge.updateSettings.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "confirmation-required",
        settings: {
          retentionDays: 7
        },
        requestedSettings: {
          retentionDays: 30
        }
      }
    });

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("radio", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear and Rescan" }));

    expect(bridge.updateSettings).toHaveBeenNthCalledWith(1, {
      retentionDays: 30
    });
    expect(bridge.updateSettings).toHaveBeenNthCalledWith(2, {
      retentionDays: 30,
      confirmDestructiveRescan: true
    });
  });

  it("saves a non-destructive retention reduction without confirmation", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();

    bridge.getSettings.mockResolvedValueOnce({
      ok: true,
      settings: {
        retentionDays: 30
      }
    });
    bridge.updateSettings.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "applied",
        settings: {
          retentionDays: 7
        }
      }
    });

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "7 days" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(bridge.updateSettings).toHaveBeenCalledTimes(1);
    expect(bridge.updateSettings).toHaveBeenCalledWith({
      retentionDays: 7
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "7 days" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  it("shows the blocking overlay as soon as the main process reports job-started", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();

    bridge.updateSettings.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "job-started",
        settings: {
          retentionDays: 7
        },
        job: {
          state: "clearing",
          retentionDays: 30,
          startedAt: "2026-06-06T12:00:00.000Z",
          completedSources: 0,
          totalSources: 1,
          message: "Clearing app-owned session data."
        }
      }
    });

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("radio", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Refreshing Session Data");
    expect(document.querySelector('[data-slot="workbench-shell"]')).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector('[data-slot="workbench-shell"]')).toHaveAttribute("inert");
  });

  it("blocks the app until the initial retention job status has been hydrated", async () => {
    const bridge = installBridgeMocks();
    let resolveRetentionJobStatus: ((value: Awaited<ReturnType<typeof bridge.getRetentionJobStatus>>) => void) | undefined;
    const pendingRetentionJobStatus = new Promise<Awaited<ReturnType<typeof bridge.getRetentionJobStatus>>>(
      (resolve) => {
        resolveRetentionJobStatus = resolve;
      }
    );

    bridge.getRetentionJobStatus.mockReturnValue(pendingRetentionJobStatus);

    render(<App />);

    expect(await screen.findByRole("dialog")).toHaveTextContent("Checking Retention Status");
    expect(document.querySelector('[data-slot="workbench-shell"]')).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector('[data-slot="workbench-shell"]')).toHaveAttribute("inert");

    resolveRetentionJobStatus?.({
      ok: true,
      job: {
        state: "idle"
      }
    });

    await screen.findByRole("heading", { name: "Settings" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("reloads settings after a pre-existing retention job reaches a terminal state", async () => {
    const bridge = installBridgeMocks();
    const retentionListeners: Array<
      Parameters<Window["agentWorkbench"]["onRetentionJobChanged"]>[0]
    > = [];

    bridge.getSettings
      .mockResolvedValueOnce({
        ok: true,
        settings: {
          retentionDays: 7
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        settings: {
          retentionDays: 30
        }
      });
    bridge.getRetentionJobStatus.mockResolvedValue({
      ok: true,
      job: {
        state: "rescanning",
        retentionDays: 30,
        startedAt: "2026-06-06T12:00:00.000Z",
        completedSources: 0,
        totalSources: 1,
        message: "Rescanning local sources with the selected timeframe."
      }
    });
    bridge.onRetentionJobChanged.mockImplementation((callback) => {
      retentionListeners.push(callback);
      return vi.fn();
    });

    render(<App />);
    await waitFor(() => {
      expect(bridge.getSettings).toHaveBeenCalledTimes(1);
    });

    if (retentionListeners.length === 0) {
      throw new Error("Expected Settings route to subscribe to retention job changes.");
    }

    retentionListeners.forEach((listener) =>
      listener({
        state: "idle",
        retentionDays: 30,
        completedAt: "2026-06-06T12:05:00.000Z"
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
    });
  });

  it("ignores invalid dispatched retention job payloads", async () => {
    installBridgeMocks();

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });

    window.dispatchEvent(
      new CustomEvent("agent-workbench:retention-job-status", {
        detail: {
          state: "rescanning",
          retentionDays: 90
        }
      })
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Refreshing Session Data" })).not.toBeInTheDocument();
    });
  });
});
