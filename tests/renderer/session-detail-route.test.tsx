import { cleanup, render, screen } from "@testing-library/react";
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

  it("renders the summary rail and mixed timeline", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
    expect(screen.getByLabelText("Session detail summary")).toBeInTheDocument();
    expect(screen.getByText("Session Timeline")).toBeInTheDocument();
    expect(screen.getByText("npm run typecheck")).toBeInTheDocument();
  });
});
