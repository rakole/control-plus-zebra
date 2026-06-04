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
    expect(within(route).getByText("Input")).toBeInTheDocument();
    expect(within(route).getByText("Output")).toBeInTheDocument();
    expect(within(route).getByText("Cached Input")).toBeInTheDocument();

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

  it("keeps overview token breakdown states explicit per metric", async () => {
    installBridgeMocks({
      overview: {
        metrics: {
          totalProjects: { status: "value", displayValue: "2", numericValue: 2 },
          totalSessions: { status: "value", displayValue: "3", numericValue: 3 },
          activeOrRecentSessions: { status: "value", displayValue: "2", numericValue: 2 },
          failedVerification: { status: "value", displayValue: "1", numericValue: 1 },
          cancelledSessions: { status: "value", displayValue: "1", numericValue: 1 },
          needsAttentionSessions: { status: "value", displayValue: "2", numericValue: 2 },
          toolActivity: { status: "value", displayValue: "4", numericValue: 4 }
        },
        usageSummary: {
          models: {
            status: "value",
            displayValue: "gemini-3-flash-preview",
            rawValue: "gemini-3-flash-preview"
          },
          tokenMetrics: {
            totalTokens: { status: "value", displayValue: "560", numericValue: 560 },
            inputTokens: { status: "value", displayValue: "420", numericValue: 420 },
            outputTokens: {
              status: "unknown",
              displayValue: "Unknown",
              reason: "Selected sessions are missing output token counts."
            },
            cacheReadTokens: {
              status: "unsupported",
              displayValue: "Unsupported",
              reason: "Selected sessions do not expose cached input tokens."
            }
          },
          tokenCount: { status: "value", displayValue: "560", numericValue: 560 }
        },
        harnessFilters: [
          { adapterId: "fake-test", label: "Fake Test Harness", sessionCount: 1 },
          { adapterId: "gemini-cli", label: "Gemini CLI", sessionCount: 2 }
        ],
        activity: [{ day: "2026-05-23", sessionCount: 3, needsAttentionCount: 2 }]
      }
    });
    render(<App />);

    const route = await screen.findByRole("region", { name: "Overview route" });

    expect(within(route).getByText("Input")).toBeInTheDocument();
    expect(within(route).getByText("420")).toBeInTheDocument();
    expect(within(route).getByText("Output")).toBeInTheDocument();
    expect(within(route).getByText("Cached Input")).toBeInTheDocument();
    expect(within(route).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(route).getAllByText("Unsupported").length).toBeGreaterThan(0);
  });
});
