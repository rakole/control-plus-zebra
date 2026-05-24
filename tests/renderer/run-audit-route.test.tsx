import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

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
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/example/control-plus-zebra.git")).toBeInTheDocument();
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
