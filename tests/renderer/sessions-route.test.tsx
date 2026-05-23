import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";

const firstSession = buildSession({
  sessionId: "session-1",
  title: "Fixture import session",
  lifecycleStatus: "completed",
  capabilityBadges: [
    {
      key: "messageCapture",
      label: "Message Capture",
      state: "Supported"
    },
    {
      key: "gitContextCapture",
      label: "Git Context Capture",
      state: "Unsupported",
      reason: "Git evidence is unavailable."
    }
  ]
});

const secondSession = buildSession({
  sessionId: "session-2",
  title: "Bridge preview session",
  lifecycleStatus: "active",
  capabilityBadges: [
    {
      key: "verificationSignals",
      label: "Verification Signals",
      state: "Unknown",
      reason: "Verification evidence is indeterminate."
    }
  ]
});

const firstPreview = {
  ...firstSession,
  projectName: "Control Plus Zebra",
  diagnostics: [
    {
      code: "fake.partial-evidence",
      severity: "warning",
      message: "Some evidence is intentionally unavailable."
    }
  ]
};

const secondPreview = {
  ...secondSession,
  projectName: "Control Plus Zebra",
  diagnostics: []
};

describe("Sessions route", () => {
  const listSessions = vi.fn();
  const getSessionById = vi.fn();

  beforeEach(() => {
    window.location.hash = "";
    listSessions.mockResolvedValue({
      ok: true,
      sessions: [firstSession, secondSession]
    });
    getSessionById.mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        ok: true,
        session: sessionId === secondSession.sessionId ? secondPreview : firstPreview
      })
    );

    Object.defineProperty(window, "agentWorkbench", {
      configurable: true,
      value: {
        getShellState: vi.fn(),
        listSessions,
        getSessionById
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Sessions-first shell and loads summaries through the preload bridge", async () => {
    render(<App />);

    expect(screen.getByText("Overview").closest("[aria-disabled='true']")).not.toBeNull();
    expect(screen.getByText("Projects").closest("[aria-disabled='true']")).not.toBeNull();
    expect(screen.getByText("Diagnostics").closest("[aria-disabled='true']")).not.toBeNull();
    expect(screen.getAllByTitle("Available in a later phase")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Reload Sessions" })).toBeInTheDocument();

    await screen.findByRole("button", { name: /Fixture import session/u });

    expect(listSessions).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(getSessionById).toHaveBeenCalledWith({ sessionId: firstSession.sessionId })
    );
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("updates the selected preview when a second row is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Bridge preview session/u }));

    await waitFor(() =>
      expect(getSessionById).toHaveBeenLastCalledWith({ sessionId: secondSession.sessionId })
    );
    expect(screen.getByRole("heading", { name: "Bridge preview session" })).toBeInTheDocument();
  });

  it("selects the next focused row with ArrowDown followed by Enter", async () => {
    const user = userEvent.setup();
    render(<App />);

    const firstRow = await screen.findByRole("button", { name: /Fixture import session/u });
    firstRow.focus();
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(getSessionById).toHaveBeenLastCalledWith({ sessionId: secondSession.sessionId })
    );
    expect(screen.getByRole("heading", { name: "Bridge preview session" })).toBeInTheDocument();
  });

  it("reloads sessions through the read-only list method", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Fixture import session/u });
    await user.click(screen.getByRole("button", { name: "Reload Sessions" }));

    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    expect(getSessionById).toHaveBeenCalled();
    expect(window.agentWorkbench).not.toHaveProperty("launchSession");
    expect(window.agentWorkbench).not.toHaveProperty("approveSession");
    expect(window.agentWorkbench).not.toHaveProperty("rejectSession");
  });

  it("renders the exact empty state copy", async () => {
    listSessions.mockResolvedValueOnce({ ok: true, sessions: [] });

    render(<App />);

    expect(await screen.findByText("No sessions available")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The desktop shell is running, but the bridge returned no session summaries. Reload sessions after the fake-adapter view model is available."
      )
    ).toBeInTheDocument();
  });

  it("renders the exact sanitized error copy without leaking raw details", async () => {
    listSessions.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "sessions.list.failed",
        message: "Internal raw path /tmp/private/fixture.json"
      }
    });

    render(<App />);

    expect(
      await screen.findByText(
        "Sessions could not load. Check the preload bridge and IPC handler, then reload sessions."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/tmp\/private/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/fixture\.json/u)).not.toBeInTheDocument();
  });

  it("keeps unsupported and unknown capability states explicit", async () => {
    render(<App />);

    await screen.findByRole("button", { name: /Fixture import session/u });

    const route = screen.getByLabelText("Sessions route");
    expect(within(route).getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(within(route).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(route).queryByText("Passed")).not.toBeInTheDocument();
    expect(within(route).queryByText("Clean")).not.toBeInTheDocument();
  });
});

function buildSession(overrides: Partial<SessionFixture>) {
  return {
    adapterId: "adapter-test",
    adapterDisplayName: "Fixture Harness",
    sourceId: "source-1",
    sessionId: "session-1",
    nativeSessionId: "native-1",
    title: "Fixture session",
    lifecycleStatus: "completed",
    startedAt: "2026-05-23T10:00:00.000Z",
    endedAt: "2026-05-23T10:08:00.000Z",
    capabilityBadges: [
      {
        key: "messageCapture",
        label: "Message Capture",
        state: "Supported"
      }
    ],
    diagnosticWarningCount: 1,
    evidenceSummary: {
      messages: 3,
      toolCalls: 2,
      shellCommands: 1,
      outputArtifacts: 1,
      fileMutations: 1,
      diagnostics: 1
    },
    ...overrides
  };
}

type SessionFixture = {
  adapterId: string;
  adapterDisplayName: string;
  sourceId: string;
  sessionId: string;
  nativeSessionId: string;
  title: string;
  lifecycleStatus: "active" | "completed" | "cancelled" | "unknown";
  startedAt: string;
  endedAt: string;
  capabilityBadges: Array<{
    key: string;
    label: string;
    state: "Supported" | "Unsupported" | "Unknown";
    reason?: string;
  }>;
  diagnosticWarningCount: number;
  evidenceSummary: {
    messages: number;
    toolCalls: number;
    shellCommands: number;
    outputArtifacts: number;
    fileMutations: number;
    diagnostics: number;
  };
};
