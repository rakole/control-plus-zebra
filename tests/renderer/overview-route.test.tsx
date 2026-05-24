import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { installBridgeMocks } from "./triage-test-helpers.js";

describe("Overview route", () => {
  beforeEach(() => {
    window.location.hash = "";
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("redirects root to overview and renders shared metric cards and metadata regions", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();

    const route = screen.getByRole("region", { name: "Overview route" });

    expect(within(route).getByRole("group", { name: "Projects" })).toHaveTextContent("2");
    expect(within(route).getByRole("group", { name: "Sessions" })).toHaveTextContent("3");
    expect(within(route).getByRole("group", { name: "Needs Attention" })).toHaveTextContent("2");

    const harnesses = within(route).getByRole("region", { name: "Observed Harnesses" });
    expect(within(harnesses).getByText("Fake Test Harness")).toBeInTheDocument();
    expect(within(harnesses).getByText("1 session")).toBeInTheDocument();
    expect(within(harnesses).getByText("Gemini CLI")).toBeInTheDocument();
    expect(within(harnesses).getByText("2 sessions")).toBeInTheDocument();

    const activity = within(route).getByRole("region", { name: "Recent Activity" });
    expect(within(activity).getByText("2026-05-23")).toBeInTheDocument();
    expect(within(activity).getByText("3 sessions")).toBeInTheDocument();
    expect(within(activity).getByText("2 need attention")).toBeInTheDocument();
  });
});
