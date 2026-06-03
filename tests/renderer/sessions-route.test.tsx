import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import {
  buildSessionPreview,
  buildSessionSummary,
  installBridgeMocks
} from "./triage-test-helpers.js";

describe("Sessions route", () => {
  beforeEach(() => {
    window.location.hash = "#/sessions";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads session summaries, selects the first preview, and keeps explicit truth states visible", async () => {
    const user = userEvent.setup();
    const bridge = installBridgeMocks();
    render(<App />);

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Triage Data" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Sessions toolbar" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort sessions" })).toHaveValue("risk-first");

    const route = screen.getByRole("region", { name: "Sessions route" });
    const inbox = await screen.findByRole("region", { name: "Session inbox" });
    await screen.findByRole("button", { name: /Bridge preview session/u });

    expect(bridge.listSessions).toHaveBeenCalledTimes(1);
    expect(bridge.listSessions).toHaveBeenCalledWith({ limit: 25 });
    await waitFor(() =>
      expect(bridge.getSession).toHaveBeenCalledWith({ sessionId: "session-2" })
    );
    expect(
      within(route).getByRole("heading", { name: "Bridge preview session" })
    ).toBeInTheDocument();
    expect(screen.getByText("Visible page totals")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Needs review" })).getByText("2")).toBeInTheDocument();
    expect(within(inbox).queryByText("Unsupported")).not.toBeInTheDocument();
    expect(within(route).getByText("Status Signals vs Evidence")).toBeInTheDocument();
    expect(within(route).getByText("Evidence Spine")).toBeInTheDocument();
    expect(within(route).getByText("Capability Coverage")).toBeInTheDocument();
    const capabilityDisclosure = within(route).getByRole("button", { name: "View details" });
    const capabilityPanel = document.getElementById(
      capabilityDisclosure.getAttribute("aria-controls") ?? ""
    );
    expect(capabilityDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(capabilityPanel).not.toBeNull();
    expect(capabilityPanel).toHaveAttribute("aria-hidden", "true");
    expect(capabilityPanel).toHaveClass("hidden");
    expect(within(route).getAllByText("Unknown").length).toBeGreaterThan(0);

    await user.click(capabilityDisclosure);

    expect(capabilityDisclosure).toHaveAttribute("aria-expanded", "true");
    expect(capabilityPanel).toHaveAttribute("aria-hidden", "false");
    expect(capabilityPanel).not.toHaveClass("hidden");
    expect(within(route).getByLabelText("Git Context: Unsupported")).toBeInTheDocument();
    expect(within(route).getAllByText("Unsupported").length).toBeGreaterThan(0);
  });

  it("uses honest empty states when preview evidence detail is not exposed", async () => {
    const sparseSession = buildSessionSummary({
      sessionId: "session-sparse",
      nativeSessionId: "native-sparse",
      title: "Sparse evidence session",
      attentionReasons: [],
      diagnosticWarningCount: 0,
      evidenceSummary: {
        messages: 1,
        toolCalls: 0,
        shellCommands: 0,
        outputArtifacts: 0,
        fileMutations: 0,
        diagnostics: 0
      },
      evidenceMetrics: {
        messages: { status: "value", displayValue: "1", numericValue: 1 },
        toolCalls: { status: "value", displayValue: "0", numericValue: 0 },
        shellCommands: { status: "value", displayValue: "0", numericValue: 0 },
        outputArtifacts: { status: "unsupported", displayValue: "Unsupported" },
        fileMutations: { status: "value", displayValue: "0", numericValue: 0 },
        diagnostics: { status: "value", displayValue: "0", numericValue: 0 }
      },
      triageMetrics: {
        toolCalls: { status: "value", displayValue: "0", numericValue: 0 },
        fileMutations: { status: "value", displayValue: "0", numericValue: 0 },
        commands: { status: "value", displayValue: "0", numericValue: 0 },
        failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
        tokenCount: { status: "value", displayValue: "42", numericValue: 42 }
      }
    });
    installBridgeMocks({
      firstSession: sparseSession,
      firstPreview: buildSessionPreview({ ...sparseSession, diagnostics: [] }),
      sessions: [sparseSession]
    });
    render(<App />);

    await screen.findByRole("button", { name: /Sparse evidence session/u });

    expect(
      screen.getByText("No diagnostics were exposed for this session preview.")
    ).toBeInTheDocument();
    expect(screen.getByText("No file mutations were recorded.")).toBeInTheDocument();
    expect(screen.getByText("No artifact evidence exposed.")).toBeInTheDocument();
  });

  it("keeps unknown failed-command states explicit instead of coercing them to zero or failure copy", async () => {
    const sessionWithUnknownFailures = buildSessionSummary({
      sessionId: "session-unknown-failures",
      nativeSessionId: "native-unknown-failures",
      title: "Unknown command status session",
      triageMetrics: {
        toolCalls: { status: "value", displayValue: "1", numericValue: 1 },
        fileMutations: { status: "value", displayValue: "0", numericValue: 0 },
        commands: { status: "unknown", displayValue: "Unknown" },
        failedCommands: { status: "unknown", displayValue: "Unknown" },
        tokenCount: { status: "value", displayValue: "42", numericValue: 42 }
      }
    });

    installBridgeMocks({
      firstSession: sessionWithUnknownFailures,
      firstPreview: buildSessionPreview({
        ...sessionWithUnknownFailures,
        diagnostics: []
      }),
      sessions: [sessionWithUnknownFailures]
    });
    render(<App />);

    await screen.findByRole("button", { name: /Unknown command status session/u });

    expect(screen.queryByText("Unknown failed")).not.toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("No failed command detail was exposed for this session.")).toBeInTheDocument();
  });

  it("supports keyboard focus movement and selection in the sessions list", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    render(<App />);

    const firstRow = await screen.findByRole("button", { name: /Bridge preview session/u });
    const secondRow = screen.getByRole("button", { name: /Fixture session/u });

    firstRow.focus();
    await user.keyboard("{ArrowDown}");

    expect(secondRow).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(bridge.getSession).toHaveBeenLastCalledWith({ sessionId: "session-1" })
    );
    expect(bridge.getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Fixture session" })).toBeInTheDocument();
  });

  it("renders loading state while the list request is in flight", () => {
    const bridge = installBridgeMocks();
    bridge.listSessions.mockImplementation(
      () =>
        new Promise(() => {
          return undefined;
        })
    );

    render(<App />);

    expect(screen.getByRole("toolbar", { name: "Sessions toolbar" })).toBeInTheDocument();
    expect(screen.getByText("Loading sessions")).toBeInTheDocument();
    expect(screen.queryByText("Visible page totals")).not.toBeInTheDocument();
  });

  it("renders the error state without showing KPI cards when list loading fails", async () => {
    const bridge = installBridgeMocks();
    bridge.listSessions.mockResolvedValue({
      ok: false,
      error: { message: "Bridge unavailable" }
    });

    render(<App />);

    expect(await screen.findByText(/Sessions could not load\./u)).toBeInTheDocument();
    expect(screen.queryByText("Visible page totals")).not.toBeInTheDocument();
  });

  it("renders the empty state without showing KPI cards when no sessions are available", async () => {
    const bridge = installBridgeMocks();
    bridge.listSessions.mockResolvedValue({
      ok: true,
      sessions: []
    });

    render(<App />);

    expect(await screen.findByText("No sessions available")).toBeInTheDocument();
    expect(screen.queryByText("Visible page totals")).not.toBeInTheDocument();
  });

  it("opens session detail from the selected preview action", async () => {
    const user = userEvent.setup();
    installBridgeMocks();
    render(<App />);

    await screen.findByRole("button", { name: /Bridge preview session/u });
    await user.click(await screen.findByRole("button", { name: "Open Session Detail" }));

    expect(await screen.findByRole("heading", { name: "Session Detail" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Session detail route" })).toBeInTheDocument();
  });

  it("opens run audit from the selected preview action", async () => {
    const user = userEvent.setup();
    installBridgeMocks();
    render(<App />);

    await screen.findByRole("button", { name: /Bridge preview session/u });
    await user.click(await screen.findByRole("button", { name: "Open Run Audit" }));

    expect(await screen.findByRole("heading", { name: "Run Audit" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Run audit route" })).toBeInTheDocument();
  });

  it("realigns focused keyboard navigation after sort changes without refetching or reloading the preview", async () => {
    const user = userEvent.setup();
    const cleanSession = buildSessionSummary({
      sessionId: "session-clean",
      nativeSessionId: "native-clean",
      title: "Clean trailing session",
      endedAt: "2026-05-23T12:00:00.000Z",
      runAuditState: { label: "Clean", tone: "positive" },
      verificationState: { label: "Passed", tone: "positive" },
      attentionReasons: [],
      triageMetrics: {
        toolCalls: { status: "value", displayValue: "2", numericValue: 2 },
        fileMutations: { status: "value", displayValue: "3", numericValue: 3 },
        commands: { status: "value", displayValue: "1", numericValue: 1 },
        failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
        tokenCount: { status: "value", displayValue: "280", numericValue: 280 }
      }
    });
    const activeSession = buildSessionSummary({
      sessionId: "session-active",
      nativeSessionId: "native-active",
      title: "Active sort leader",
      lifecycleStatus: "active",
      lifecycleState: { label: "Active", tone: "info" },
      startedAt: "2026-05-23T08:00:00.000Z",
      endedAt: "",
      runAuditState: { label: "Active", tone: "info" },
      verificationState: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
      attentionReasons: ["No Verification"],
      triageMetrics: {
        toolCalls: { status: "value", displayValue: "2", numericValue: 2 },
        fileMutations: { status: "value", displayValue: "2", numericValue: 2 },
        commands: { status: "value", displayValue: "1", numericValue: 1 },
        failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
        tokenCount: { status: "value", displayValue: "280", numericValue: 280 }
      }
    });
    const failedSession = buildSessionSummary({
      sessionId: "session-failed",
      nativeSessionId: "native-failed",
      title: "Failed command second",
      startedAt: "2026-05-23T09:45:00.000Z",
      endedAt: "2026-05-23T10:30:00.000Z",
      runAuditState: { label: "Failed Verification", tone: "danger" },
      verificationState: { label: "Failed", tone: "danger" },
      attentionReasons: ["Failed Verification"],
      triageMetrics: {
        toolCalls: { status: "value", displayValue: "4", numericValue: 4 },
        fileMutations: { status: "value", displayValue: "5", numericValue: 5 },
        commands: { status: "value", displayValue: "3", numericValue: 3 },
        failedCommands: { status: "value", displayValue: "2", numericValue: 2 },
        tokenCount: { status: "value", displayValue: "280", numericValue: 280 }
      }
    });
    const reviewSession = buildSessionSummary({
      sessionId: "session-review",
      nativeSessionId: "native-review",
      title: "Needs review third",
      startedAt: "2026-05-23T10:15:00.000Z",
      endedAt: "2026-05-23T11:00:00.000Z",
      runAuditState: { label: "Needs Review", tone: "warning" },
      verificationState: { label: "Not Run", tone: "warning" },
      attentionReasons: ["No Verification"],
      triageMetrics: {
        toolCalls: { status: "value", displayValue: "3", numericValue: 3 },
        fileMutations: { status: "value", displayValue: "1", numericValue: 1 },
        commands: { status: "value", displayValue: "1", numericValue: 1 },
        failedCommands: { status: "value", displayValue: "0", numericValue: 0 },
        tokenCount: { status: "value", displayValue: "280", numericValue: 280 }
      }
    });
    const cleanSessionPreview = buildSessionPreview(cleanSession);
    const activeSessionPreview = buildSessionPreview({ ...activeSession, diagnostics: [] });
    const failedSessionPreview = buildSessionPreview({ ...failedSession, diagnostics: [] });
    const reviewSessionPreview = buildSessionPreview({ ...reviewSession, diagnostics: [] });
    const sessionPreviewById: Record<string, ReturnType<typeof buildSessionPreview>> = {
      [cleanSession.sessionId]: cleanSessionPreview,
      [activeSession.sessionId]: activeSessionPreview,
      [failedSession.sessionId]: failedSessionPreview,
      [reviewSession.sessionId]: reviewSessionPreview
    };

    const bridge = installBridgeMocks({
      firstSession: cleanSession,
      firstPreview: cleanSessionPreview,
      secondSession: activeSession,
      secondPreview: activeSessionPreview,
      sessions: [cleanSession, reviewSession, activeSession, failedSession]
    });
    bridge.getSession.mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        ok: true,
        session: sessionPreviewById[sessionId] ?? cleanSessionPreview
      })
    );
    render(<App />);

    const masterPane = await screen.findByRole("region", { name: "Session inbox" });
    const initialOrder = within(masterPane)
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");

    expect(initialOrder[0]).toContain("Active sort leader");
    expect(initialOrder[1]).toContain("Failed command second");
    expect(initialOrder[2]).toContain("Needs review third");
    expect(initialOrder[3]).toContain("Clean trailing session");
    expect(await screen.findByRole("heading", { name: "Active sort leader" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Needs review" })).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Failed commands" })).getByText("2")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Not verified / not run" })).getByText("2")
    ).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Files changed" })).getByText("11")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Active now" })).getByText("1")).toBeInTheDocument();

    const sortControl = screen.getByRole("combobox", { name: "Sort sessions" });
    const initialFocusedRow = within(masterPane).getByRole("button", { name: /Active sort leader/u });
    initialFocusedRow.focus();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort sessions" }), "newest-first");

    await waitFor(() => {
      const newestFirstOrder = within(masterPane)
        .getAllByRole("button")
        .map((button) => button.textContent ?? "");

      expect(newestFirstOrder[0]).toContain("Clean trailing session");
      expect(newestFirstOrder[1]).toContain("Needs review third");
      expect(newestFirstOrder[2]).toContain("Failed command second");
      expect(newestFirstOrder[3]).toContain("Active sort leader");
    });

    expect(sortControl).toHaveValue("newest-first");
    expect(bridge.listSessions).toHaveBeenCalledTimes(2);
    expect(bridge.getSession).toHaveBeenCalledTimes(1);

    await user.keyboard("{ArrowDown}");

    within(masterPane).getByRole("button", { name: /Needs review third/u });

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(bridge.getSession).toHaveBeenLastCalledWith({ sessionId: "session-review" })
    );
    expect(bridge.getSession).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("heading", { name: "Needs review third" })).toBeInTheDocument();
  });

  it("keeps the harness filter and reload behavior working", async () => {
    const user = userEvent.setup();
    const fakeSession = buildSessionSummary();
    const geminiSession = buildSessionSummary({
      sessionId: "session-gemini",
      nativeSessionId: "native-gemini",
      title: "Gemini filtered session",
      adapterId: "gemini-cli",
      adapterDisplayName: "Gemini CLI"
    });
    const bridge = installBridgeMocks({
      firstSession: fakeSession,
      firstPreview: buildSessionPreview(fakeSession),
      secondSession: geminiSession,
      secondPreview: buildSessionPreview({ ...geminiSession, diagnostics: [] }),
      sessions: [fakeSession, geminiSession]
    });
    const sessions = [fakeSession, geminiSession];

    bridge.listSessions.mockImplementation(
      async (request?: { adapterId?: string }) =>
        ({
          ok: true,
          sessions:
            request?.adapterId == null
              ? sessions
              : sessions.filter((session) => session.adapterId === request.adapterId)
        }) as const
    );

    render(<App />);

    await screen.findByRole("button", { name: /Fixture session/u });

    await user.selectOptions(screen.getByRole("combobox", { name: "Harness" }), "gemini-cli");

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        adapterId: "gemini-cli",
        limit: 25
      })
    );
    expect(screen.queryByRole("button", { name: /Fixture session/u })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gemini filtered session/u })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reload Triage Data" }));

    await waitFor(() => expect(bridge.listSessions).toHaveBeenCalledTimes(3));
    expect(bridge.listSessions).toHaveBeenLastCalledWith({
      adapterId: "gemini-cli",
      limit: 25
    });
  });

  it("uses pageInfo.nextCursor for Next, keeps Prev local, and never renders fake numbered pages", async () => {
    const user = userEvent.setup();
    const firstSession = buildSessionSummary({
      sessionId: "session-page-1a",
      nativeSessionId: "native-page-1a",
      title: "Page one first"
    });
    const secondSession = buildSessionSummary({
      sessionId: "session-page-1b",
      nativeSessionId: "native-page-1b",
      title: "Page one second"
    });
    const thirdSession = buildSessionSummary({
      sessionId: "session-page-2a",
      nativeSessionId: "native-page-2a",
      title: "Page two only"
    });
    const bridge = installBridgeMocks({
      firstSession,
      firstPreview: buildSessionPreview(firstSession),
      secondSession,
      secondPreview: buildSessionPreview(secondSession),
      sessions: [firstSession, secondSession]
    });
    const pageTwoCursor = "opaque-page-two";

    bridge.listSessions.mockImplementation(
      async (request?: { adapterId?: string; cursor?: string; limit?: number }) => {
        if (request?.cursor === pageTwoCursor) {
          return {
            ok: true,
            sessions: [thirdSession],
            pageInfo: {
              hasMore: false,
              totalCount: 3
            }
          } as const;
        }

        return {
          ok: true,
          sessions: [firstSession, secondSession],
          pageInfo: {
            hasMore: true,
            nextCursor: pageTwoCursor,
            totalCount: 3
          }
        } as const;
      }
    );
    bridge.getSession.mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({
        ok: true,
        session: buildSessionPreview(
          sessionId === thirdSession.sessionId ? thirdSession : sessionId === secondSession.sessionId ? secondSession : firstSession
        )
      })
    );

    render(<App />);

    await screen.findByRole("button", { name: /Page one first/u });

    const pagination = screen.getByRole("navigation", { name: "Sessions pagination" });
    const prevButton = within(pagination).getByRole("button", { name: "Prev" });
    const nextButton = within(pagination).getByRole("button", { name: "Next" });

    expect(bridge.listSessions).toHaveBeenCalledWith({ limit: 25 });
    expect(screen.getByText("1-2 of 3")).toBeInTheDocument();
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeEnabled();
    expect(within(pagination).queryByRole("button", { name: /^\d+$/u })).not.toBeInTheDocument();
    expect(
      bridge.listSessions.mock.calls.every(
        ([request]) =>
          typeof request === "object" &&
          request !== null &&
          "limit" in request &&
          typeof (request as { limit?: unknown }).limit === "number"
      )
    ).toBe(true);

    await user.click(nextButton);

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        cursor: pageTwoCursor,
        limit: 25
      })
    );
    expect(await screen.findByRole("button", { name: /Page two only/u })).toBeInTheDocument();
    expect(screen.getByText("3-3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Prev" }));

    await waitFor(() => expect(bridge.listSessions).toHaveBeenLastCalledWith({ limit: 25 }));
    expect(await screen.findByRole("button", { name: /Page one first/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
  });

  it("ignores rapid repeated Next clicks while a cursor load is pending", async () => {
    const user = userEvent.setup();
    const firstSession = buildSessionSummary({
      sessionId: "session-rapid-1",
      nativeSessionId: "native-rapid-1",
      title: "Rapid page one"
    });
    const secondSession = buildSessionSummary({
      sessionId: "session-rapid-2",
      nativeSessionId: "native-rapid-2",
      title: "Rapid page two"
    });
    const bridge = installBridgeMocks({
      firstSession,
      firstPreview: buildSessionPreview(firstSession),
      secondSession,
      secondPreview: buildSessionPreview(secondSession),
      sessions: [firstSession]
    });
    const pageTwoCursor = "opaque-rapid-page-two";
    let resolvePageTwo!: (value: {
      ok: true;
      sessions: typeof firstSession[];
      pageInfo: { hasMore: false; totalCount: number };
    }) => void;

    bridge.listSessions.mockImplementation(
      async (request?: { cursor?: string; limit?: number }) => {
        if (request?.cursor === pageTwoCursor) {
          return await new Promise<{
            ok: true;
            sessions: typeof firstSession[];
            pageInfo: { hasMore: false; totalCount: number };
          }>((resolve) => {
            resolvePageTwo = resolve;
          });
        }

        return {
          ok: true,
          sessions: [firstSession],
          pageInfo: {
            hasMore: true,
            nextCursor: pageTwoCursor,
            totalCount: 2
          }
        } as const;
      }
    );

    render(<App />);

    const nextButton = await screen.findByRole("button", { name: "Next" });

    await user.dblClick(nextButton);

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenNthCalledWith(2, {
        cursor: pageTwoCursor,
        limit: 25
      })
    );
    expect(bridge.listSessions).toHaveBeenCalledTimes(2);
    expect(nextButton).toBeDisabled();

    resolvePageTwo({
      ok: true,
      sessions: [secondSession],
      pageInfo: {
        hasMore: false,
        totalCount: 2
      }
    });

    expect(await screen.findByRole("button", { name: /Rapid page two/u })).toBeInTheDocument();
    expect(screen.getByText("2-2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Prev" }));

    await waitFor(() => expect(bridge.listSessions).toHaveBeenLastCalledWith({ limit: 25 }));
    expect(bridge.listSessions).toHaveBeenCalledTimes(3);
    expect(await screen.findByRole("button", { name: /Rapid page one/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
  });

  it("resets to the first page for page-size, sort, and adapter changes, and does not persist cursor history in the URL", async () => {
    const user = userEvent.setup();
    const firstSession = buildSessionSummary({ title: "Reset first page" });
    const secondSession = buildSessionSummary({
      sessionId: "session-next",
      nativeSessionId: "native-next",
      title: "Reset second page"
    });
    const geminiSession = buildSessionSummary({
      sessionId: "session-gemini-reset",
      nativeSessionId: "native-gemini-reset",
      title: "Gemini reset session",
      adapterId: "gemini-cli",
      adapterDisplayName: "Gemini CLI"
    });
    const bridge = installBridgeMocks({
      firstSession,
      firstPreview: buildSessionPreview(firstSession),
      secondSession: geminiSession,
      secondPreview: buildSessionPreview(geminiSession),
      sessions: [firstSession, geminiSession]
    });
    const pageTwoCursor = "opaque-reset-page-two";

    bridge.listSessions.mockImplementation(
      async (request?: { adapterId?: string; cursor?: string; limit?: number }) => {
        if (request?.adapterId === "gemini-cli") {
          return {
            ok: true,
            sessions: [geminiSession],
            pageInfo: {
              hasMore: false,
              totalCount: 1
            }
          } as const;
        }

        if (request?.cursor === pageTwoCursor) {
          return {
            ok: true,
            sessions: [secondSession],
            pageInfo: {
              hasMore: false,
              totalCount: 2
            }
          } as const;
        }

        return {
          ok: true,
          sessions: [firstSession, geminiSession],
          pageInfo: {
            hasMore: true,
            nextCursor: pageTwoCursor,
            totalCount: 3
          }
        } as const;
      }
    );

    render(<App />);

    const nextButton = await screen.findByRole("button", { name: "Next" });
    await user.click(nextButton);

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        cursor: pageTwoCursor,
        limit: 25
      })
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Page size" }), "50");

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        limit: 50
      })
    );
    expect(window.location.hash).toContain("pageSize=50");
    expect(window.location.hash).not.toContain("cursor=");
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort sessions" }), "newest-first");

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        limit: 50
      })
    );
    expect(window.location.hash).toContain("pageSize=50");
    expect(window.location.hash).toContain("sort=newest-first");
    expect(window.location.hash).not.toContain("cursor=");

    await user.selectOptions(screen.getByRole("combobox", { name: "Harness" }), "gemini-cli");

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        adapterId: "gemini-cli",
        limit: 50
      })
    );
    expect(window.location.hash).toContain("adapterId=gemini-cli");
    expect(window.location.hash).toContain("pageSize=50");
    expect(window.location.hash).toContain("sort=newest-first");
    expect(window.location.hash).not.toContain("cursor=");
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
  });

  it("clears local Prev history after reload while keeping the current cursor-backed page", async () => {
    const user = userEvent.setup();
    const firstSession = buildSessionSummary({ title: "Reload first page" });
    const secondSession = buildSessionSummary({
      sessionId: "session-reload-next",
      nativeSessionId: "native-reload-next",
      title: "Reload second page"
    });
    const bridge = installBridgeMocks({
      firstSession,
      firstPreview: buildSessionPreview(firstSession),
      secondSession,
      secondPreview: buildSessionPreview(secondSession),
      sessions: [firstSession]
    });
    const pageTwoCursor = "opaque-reload-page-two";

    bridge.listSessions.mockImplementation(
      async (request?: { cursor?: string; limit?: number }) => {
        if (request?.cursor === pageTwoCursor) {
          return {
            ok: true,
            sessions: [secondSession],
            pageInfo: {
              hasMore: false,
              totalCount: 2
            }
          } as const;
        }

        return {
          ok: true,
          sessions: [firstSession],
          pageInfo: {
            hasMore: true,
            nextCursor: pageTwoCursor,
            totalCount: 2
          }
        } as const;
      }
    );

    render(<App />);

    const nextButton = await screen.findByRole("button", { name: "Next" });

    await user.click(nextButton);

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        cursor: pageTwoCursor,
        limit: 25
      })
    );
    expect(screen.getByRole("button", { name: "Prev" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Reload Triage Data" }));

    await waitFor(() =>
      expect(bridge.listSessions).toHaveBeenLastCalledWith({
        cursor: pageTwoCursor,
        limit: 25
      })
    );
    expect(await screen.findByRole("button", { name: /Reload second page/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
  });
});
