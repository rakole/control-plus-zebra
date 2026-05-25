import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

describe("Session detail route", () => {
  beforeEach(() => {
    window.location.hash = "#/sessions/session-1";
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the summary rail and timeline from session detail data", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
    expect(screen.getByLabelText("Session detail summary")).toBeInTheDocument();
    expect(screen.getByText("Capability Coverage")).toBeInTheDocument();
    expect(screen.getByText("Session Timeline")).toBeInTheDocument();
    expect(screen.getByText("npm run typecheck")).toBeInTheDocument();
    expect(screen.getByText("Type checking passed.")).toBeInTheDocument();
    expect(screen.getByText("Output artifact")).toBeInTheDocument();
  });

  it("loads output artifact previews through the public bridge", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Session Detail" });
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(window.agentWorkbench.getOutputArtifactPreview).toHaveBeenCalledWith({
      sessionId: "session-1",
      outputArtifactId: "artifact-1"
    });
    expect(await screen.findByText("Preview Ready")).toBeInTheDocument();
    expect(screen.getAllByText("Type checking passed.").length).toBeGreaterThan(0);
  });

  it("opens run audit from the detail route action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Session Detail" });
    await user.click(screen.getByRole("link", { name: "Open Run Audit" }));

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
  });
});
