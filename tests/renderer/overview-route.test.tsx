import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { buildOverviewHeatmap, installBridgeMocks } from "./triage-test-helpers.js";

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("Overview route", () => {
  const originalSvgClientWidth = Object.getOwnPropertyDescriptor(
    SVGSVGElement.prototype,
    "clientWidth"
  );

  beforeEach(() => {
    window.location.hash = "";
    installBridgeMocks();
    Object.defineProperty(SVGSVGElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 85
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();

    if (originalSvgClientWidth) {
      Object.defineProperty(SVGSVGElement.prototype, "clientWidth", originalSvgClientWidth);
    } else {
      delete (SVGSVGElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("renders overview metrics before the heatmap request resolves", async () => {
    const bridge = installBridgeMocks();
    const deferred = createDeferredPromise<{
      ok: true;
      heatmap: ReturnType<typeof buildOverviewHeatmap>;
    }>();
    bridge.getOverviewActivityHeatmap.mockReturnValue(deferred.promise);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();

    const route = screen.getByRole("region", { name: "Overview route" });

    expect(within(route).getByRole("group", { name: "Projects" })).toHaveTextContent("2");
    expect(within(route).getByRole("group", { name: "Sessions" })).toHaveTextContent("3");
    expect(within(route).getByRole("group", { name: "Needs Attention" })).toHaveTextContent("2");

    const heatmapSection = within(route).getByRole("region", {
      name: "Overview Activity Heatmap"
    });
    expect(within(heatmapSection).getByText("Loading activity heatmap")).toBeInTheDocument();

    deferred.resolve({ ok: true, heatmap: buildOverviewHeatmap() });
    await screen.findAllByTestId("overview-activity-heatmap-cell");
  });

  it("renders the heatmap loading state locally and then shows 30 days of activity", async () => {
    const bridge = installBridgeMocks({
      overviewHeatmap: buildOverviewHeatmap({
        coverageState: {
          label: "Unknown",
          tone: "neutral",
          reason: "Activity heatmap includes cache-fallback data for 1 source."
        }
      })
    });
    const deferred = createDeferredPromise<{
      ok: true;
      heatmap: ReturnType<typeof buildOverviewHeatmap>;
    }>();
    bridge.getOverviewActivityHeatmap.mockReturnValue(deferred.promise);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();

    const route = screen.getByRole("region", { name: "Overview route" });
    const heatmapSection = within(route).getByRole("region", {
      name: "Overview Activity Heatmap"
    });
    expect(within(heatmapSection).getByText("Loading activity heatmap")).toBeInTheDocument();

    const harnesses = within(route).getByRole("region", { name: "Observed Harnesses" });
    expect(within(harnesses).getByText("Fake Test Harness")).toBeInTheDocument();
    expect(within(harnesses).getByText("1 session")).toBeInTheDocument();
    expect(within(harnesses).getByText("Gemini CLI")).toBeInTheDocument();
    expect(within(harnesses).getByText("2 sessions")).toBeInTheDocument();

    deferred.resolve({
      ok: true,
      heatmap: buildOverviewHeatmap({
        coverageState: {
          label: "Unknown",
          tone: "neutral",
          reason: "Activity heatmap includes cache-fallback data for 1 source."
        }
      })
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("overview-activity-heatmap-cell")).toHaveLength(30);
    });

    const resolvedHeatmapSection = within(route).getByRole("region", {
      name: "Overview Activity Heatmap"
    });
    expect(within(resolvedHeatmapSection).getByLabelText("Unknown")).toBeInTheDocument();
    expect(
      within(resolvedHeatmapSection).getByLabelText(
        "May 28, 2026: 3 sessions, 2 sessions need attention"
      )
    ).toBeInTheDocument();
  });
});
