import { cleanup, render, screen } from "@testing-library/react";
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

  it("renders grouped claim-vs-evidence sections and shared git snapshot fields", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByText("Claim vs Evidence")).toBeInTheDocument();
    expect(screen.getByText("Git / GitHub")).toBeInTheDocument();
    expect(screen.getAllByText("No Matching PR").length).toBeGreaterThan(0);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/example/control-plus-zebra.git")).toBeInTheDocument();
  });
});
