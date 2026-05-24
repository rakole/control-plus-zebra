import { cleanup, render, screen } from "@testing-library/react";
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
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getAllByText("control-plus-zebra").length).toBeGreaterThan(0);
    expect(screen.getByText(/Branch main/u)).toBeInTheDocument();
    expect(screen.getByText(/Dirty Dirty/u)).toBeInTheDocument();
    expect(screen.getByText("Validated Repo Root")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/example/control-plus-zebra.git")).toBeInTheDocument();
  });
});
