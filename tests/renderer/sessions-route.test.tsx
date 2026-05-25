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

  it("loads session summaries, selects the first preview, and keeps explicit truth states visible", async () => {
    const bridge = installBridgeMocks();
    render(<App />);

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Triage Data" })).toBeInTheDocument();

    const route = screen.getByRole("region", { name: "Sessions route" });
    await screen.findByRole("button", { name: /Fixture session/u });

    expect(bridge.listSessions).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(bridge.getSession).toHaveBeenCalledWith({ sessionId: "session-1" })
    );
    expect(
      within(route).getByRole("heading", { name: "Fixture session" })
    ).toBeInTheDocument();
    expect(within(route).getByText("Capability Coverage")).toBeInTheDocument();
    expect(within(route).getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(within(route).getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("supports keyboard focus movement and selection in the sessions list", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    render(<App />);

    const firstRow = await screen.findByRole("button", { name: /Fixture session/u });
    const secondRow = screen.getByRole("button", { name: /Bridge preview session/u });

    firstRow.focus();
    await user.keyboard("{ArrowDown}");

    expect(secondRow).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(bridge.getSession).toHaveBeenLastCalledWith({ sessionId: "session-2" })
    );
    expect(screen.getByRole("heading", { name: "Bridge preview session" })).toBeInTheDocument();
  });

  it("adds labeled tooltips to session status, metric, and capability bubbles", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Fixture session/u });

    const master = screen.getByRole("region", { name: "Session summaries" });
    const preview = screen.getAllByRole("region", { name: "Selected session preview" })[0]!;
    const sessionRow = within(master).getByRole("button", { name: /Fixture session/u });

    const runAuditBadge = within(sessionRow).getByText("Needs Review");
    expect(runAuditBadge).toHaveAttribute("title", "Run audit status: Needs Review");

    await user.hover(runAuditBadge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Run audit status: Needs Review");

    const commandsBadge = within(sessionRow).getByText("1 commands");
    expect(commandsBadge).toHaveAttribute("title", "Commands: 1");

    const capabilityBadge = within(sessionRow).getByText("Unsupported");
    expect(capabilityBadge).toHaveAttribute(
      "title",
      "Git Context: Unsupported. Git evidence is unavailable."
    );

    const lifecycleBadge = within(preview).getByText("Completed");
    expect(lifecycleBadge).toHaveAttribute("title", "Session lifecycle: Completed");
  });

  it("opens session detail from the selected preview action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Fixture session/u });
    await user.click(await screen.findByRole("button", { name: "Open Session Detail" }));

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Session detail route" })).toBeInTheDocument();
  });

  it("opens run audit from the selected preview action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Fixture session/u });
    await user.click(await screen.findByRole("button", { name: "Open Run Audit" }));

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Run audit route" })).toBeInTheDocument();
  });
});
