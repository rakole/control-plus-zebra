import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { buildSessionDetail, installBridgeMocks } from "./triage-test-helpers.js";

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

  it("contains tool and shell timeline evidence without changing normal summaries", async () => {
    const user = userEvent.setup();
    const toolEvidence = `{"fileDiff":"${"tool change ".repeat(40)}"}`;
    const shellOutput = `[[{"text":"${"shell output ".repeat(40)}"}]]`;
    const detail = buildSessionDetail({
      timeline: [
        {
          id: "event-message-summary",
          kind: "message",
          timestamp: "2026-05-23T10:00:01.000Z",
          title: "User message",
          summary: "Short user note.",
          metadata: [{ label: "Role", value: "User" }]
        },
        {
          id: "event-tool-evidence",
          kind: "tool-call",
          timestamp: "2026-05-23T10:00:02.000Z",
          title: "write_file",
          summary: toolEvidence,
          metadata: [{ label: "Status", value: "Completed" }]
        },
        {
          id: "event-shell-evidence",
          kind: "shell-command",
          timestamp: "2026-05-23T10:00:03.000Z",
          title: "npm test",
          summary: shellOutput,
          metadata: [{ label: "Result", value: "Passed" }]
        },
        {
          id: "artifact-summary",
          kind: "output-artifact",
          timestamp: "2026-05-23T10:00:04.000Z",
          title: "Output artifact",
          summary: "Output artifact summary.",
          metadata: [{ label: "Kind", value: "Plain Text" }]
        }
      ]
    });
    installBridgeMocks({ detail });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
    expect(screen.getByText("Short user note.")).toBeInTheDocument();
    expect(screen.getByText("Output artifact summary.")).toBeInTheDocument();

    const toolPreview = screen.getByRole("group", { name: "Tool evidence" });
    const shellPreview = screen.getByRole("group", { name: "Shell output" });
    expect(within(toolPreview).getByText(toolEvidence)).toBeInTheDocument();
    expect(within(shellPreview).getByText(shellOutput)).toBeInTheDocument();

    const toolToggle = within(toolPreview).getByRole("button", { name: /show more/i });
    const shellToggle = within(shellPreview).getByRole("button", { name: /show more/i });
    expect(toolToggle).toHaveAttribute("aria-expanded", "false");
    expect(shellToggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toolToggle);

    expect(toolToggle).toHaveAttribute("aria-expanded", "true");
    expect(within(toolPreview).getByRole("button", { name: /show less/i })).toBeInTheDocument();
    expect(shellToggle).toHaveAttribute("aria-expanded", "false");
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

  it("loads additional timeline events with an opaque cursor", async () => {
    const user = userEvent.setup();
    const nextCursor = "eyJ2ZXJzaW9uIjoxLCJrZXlzZXQiOnsiZXZlbnRJZCI6ImV2ZW50LTEifX0";
    const firstEvent = {
      id: "event-page-1",
      kind: "message",
      timestamp: "2026-05-23T10:00:01.000Z",
      title: "First page event",
      summary: "Initial timeline page.",
      metadata: [{ label: "Role", value: "User" }]
    };
    const secondEvent = {
      ...firstEvent,
      id: "event-page-2",
      title: "Second page event",
      summary: "Loaded timeline page."
    };
    const detail = buildSessionDetail({
      timeline: [firstEvent],
      timelinePageInfo: {
        hasMore: true,
        nextCursor,
        totalCount: 2
      }
    });
    const bridge = installBridgeMocks({ detail });

    bridge.getSessionTimeline.mockImplementation(({ cursor }: { cursor?: string }) =>
      Promise.resolve({
        ok: true,
        timeline: cursor ? [secondEvent] : [firstEvent],
        pageInfo: cursor
          ? {
              hasMore: false,
              totalCount: 2
            }
          : {
              hasMore: true,
              nextCursor,
              totalCount: 2
            }
      })
    );
    render(<App />);

    expect(await screen.findByText("First page event")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load More" }));

    expect(await screen.findByText("Second page event")).toBeInTheDocument();
    expect(bridge.getSessionTimeline).toHaveBeenCalledWith({
      sessionId: "session-1",
      cursor: nextCursor,
      limit: 100
    });
  });
});
