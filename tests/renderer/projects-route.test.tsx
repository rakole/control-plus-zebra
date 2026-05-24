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

  it("renders project rollups with explicit phase 7 placeholders", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("control-plus-zebra")).toBeInTheDocument();
    expect(screen.getByText(/Branch Unknown/u)).toBeInTheDocument();
    expect(screen.getByText(/HEAD Unknown/u)).toBeInTheDocument();
    expect(screen.getByText(/Dirty Unknown/u)).toBeInTheDocument();
  });
});
