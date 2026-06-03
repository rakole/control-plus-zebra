import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { buildRunAudit, installBridgeMocks } from "./triage-test-helpers.js";

function hasExactTextContent(expectedText: string) {
  return (_content: string, node: Element | null) => node?.textContent === expectedText;
}

describe("Run audit route", () => {
  beforeEach(() => {
    window.location.hash = "#/sessions/session-1/run-audit";
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders grouped run audit sections and session truth states", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByLabelText("Run audit summary")).toBeInTheDocument();
    expect(screen.getByText("Claim vs Evidence")).toBeInTheDocument();
    expect(screen.getByText("Git / GitHub")).toBeInTheDocument();
    expect(screen.getAllByText("No Matching PR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("https://github.com/example/control-plus-zebra.git")).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText(
        hasExactTextContent("npm run test -- tests/main/core/run-audit-engine.test.ts"),
        { selector: "pre" }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(hasExactTextContent("git status --short"), { selector: "pre" })
    ).toBeInTheDocument();
  });

  it("opens a dialog to show all commands when the session has more than three", async () => {
    installBridgeMocks({
      runAudit: buildRunAudit({
        sections: [
          {
            id: "commands",
            title: "Commands",
            summary: "Show command evidence without replaying raw output.",
            items: [
              { label: "Observed Commands", value: "4", tone: "neutral" },
              { label: "Failed Commands", value: "1", tone: "danger" },
              {
                label: "Recent Commands",
                value: "Recent command activity",
                tone: "neutral",
                kind: "command-list",
                commands: [
                  { command: "wc -l src/mcp/tools/god-review.ts", result: "Unknown" },
                  { command: "touch src/mcp/tools/god-review-types.ts", result: "Unknown" },
                  { command: "npx tsc src/mcp/tools/god-review.ts --noEmit", result: "Failed" },
                  { command: "git status --short", result: "Succeeded" }
                ]
              }
            ]
          }
        ]
      })
    });

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all 4 commands" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "All Session Commands" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View all 4 commands" }));

    expect(await screen.findByRole("heading", { name: "All Session Commands" })).toBeInTheDocument();
    expect(
      screen.getByText(hasExactTextContent("git status --short"), { selector: "pre" })
    ).toBeInTheDocument();
  });

  it("keeps empty recent-command states explicit", async () => {
    installBridgeMocks({
      runAudit: buildRunAudit({
        sections: [
          {
            id: "commands",
            title: "Commands",
            summary: "Show command evidence without replaying raw output.",
            items: [
              { label: "Observed Commands", value: "0", tone: "neutral" },
              { label: "Failed Commands", value: "0", tone: "positive" },
              {
                label: "Recent Commands",
                value: "None",
                tone: "neutral",
                kind: "command-list",
                commands: []
              }
            ]
          }
        ]
      })
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("navigates back to session detail from the run audit route action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Run Audit" });
    await user.click(screen.getByRole("link", { name: "Open Session Detail" }));

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
  });

  it("exports a session archive with the current privacy options", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Run Audit" });

    await user.click(screen.getByRole("button", { name: "Export Session Archive" }));

    expect(await screen.findByText("Include Raw Artifacts")).toBeInTheDocument();
    expect(
      await screen.findByText("Raw artifacts may include sensitive local data")
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^Export Session Archive$/u })[1]!);

    expect(bridge.createArchive).toHaveBeenCalledWith({
      scope: { kind: "session", sessionId: "session-1" },
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true
    });
  });
});
