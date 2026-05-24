import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

describe("Projects route", () => {
  beforeEach(() => {
    window.location.hash = "#/projects";
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders project rollups with shared git truth and a selected repo detail panel", async () => {
    const bridge = installBridgeMocks();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getAllByText("control-plus-zebra").length).toBeGreaterThan(0);
    expect(screen.getByText(/Branch main/u)).toBeInTheDocument();
    expect(screen.getByText(/Dirty Dirty/u)).toBeInTheDocument();
    expect(screen.getByText("Validated Repo Root")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/example/control-plus-zebra.git")).toBeInTheDocument();
    expect(screen.getAllByText("No Matching PR").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Export Project Archive" }));

    expect(await screen.findByText("Include Raw Artifacts")).toBeInTheDocument();
    expect(
      await screen.findByText("Raw artifacts may include sensitive local data")
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^Export Project Archive$/u })[1]!);

    expect(bridge.createArchive).toHaveBeenCalledWith({
      scope: { kind: "project", projectId: "project-1" },
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true
    });
  });
});
