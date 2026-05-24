import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import { buildProject, installBridgeMocks } from "./triage-test-helpers.js";

describe("Projects route", () => {
  beforeEach(() => {
    window.location.hash = "#/projects";
    installBridgeMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders project list/detail surfaces and updates the selected project metadata", async () => {
    installBridgeMocks({
      projects: [
        buildProject(),
        buildProject({
          projectId: "project-2",
          projectName: "agent-workbench-docs",
          repoPath: {
            status: "value",
            displayValue: "/workspace/agent-workbench-docs",
            rawValue: "/workspace/agent-workbench-docs"
          },
          validatedRepoRoot: {
            status: "value",
            displayValue: "/workspace/agent-workbench-docs",
            rawValue: "/workspace/agent-workbench-docs"
          },
          observedHarnesses: ["Fake Test Harness"],
          sessionCount: 1,
          latestVerification: { label: "Unknown", tone: "neutral", reason: "No verification evidence." },
          latestRunAudit: { label: "Active", tone: "info" },
          gitStatus: { label: "Available", tone: "info" },
          githubStatus: { label: "PR Open", tone: "info" },
          branch: { status: "value", displayValue: "feature/docs-sweep" },
          head: { status: "value", displayValue: "def67890" },
          dirtyState: { label: "Clean", tone: "positive" },
          changedFiles: { status: "value", displayValue: "0" },
          untrackedFiles: { status: "value", displayValue: "0" },
          additions: { status: "value", displayValue: "12" },
          deletions: { status: "value", displayValue: "1" },
          remoteUrl: {
            status: "value",
            displayValue: "https://github.com/example/agent-workbench-docs.git"
          },
          pullRequest: { status: "value", displayValue: "#42" },
          checks: { status: "value", displayValue: "Passing" },
          reviewStatus: { status: "value", displayValue: "Approved" },
          archiveExport: {
            scopeKind: "project",
            scopeId: "project-2",
            scopeLabel: "agent-workbench-docs",
            sessionCount: 1,
            sourceCount: 1,
            rawArtifactsAvailable: false,
            rawArtifactCount: 0,
            rawArtifactsReason: "No indexed raw artifacts are available for this archive scope."
          }
        })
      ]
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    const master = screen.getByRole("region", { name: "Projects list" });
    const detail = screen.getByRole("region", { name: "Selected project details" });

    expect(within(master).getByRole("button", { name: /control-plus-zebra/u })).toBeInTheDocument();
    expect(within(master).getByRole("button", { name: /agent-workbench-docs/u })).toBeInTheDocument();

    let repositoryMetadata = within(detail).getByRole("region", { name: "Repository Metadata" });
    expect(within(repositoryMetadata).getAllByText("/workspace/control-plus-zebra").length).toBeGreaterThan(0);
    expect(within(repositoryMetadata).getByText("https://github.com/example/control-plus-zebra.git")).toBeInTheDocument();
    expect(within(repositoryMetadata).getAllByText("No Matching PR").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(within(master).getByRole("button", { name: /agent-workbench-docs/u }));

    expect(within(detail).getByRole("heading", { name: "agent-workbench-docs" })).toBeInTheDocument();
    repositoryMetadata = within(detail).getByRole("region", { name: "Repository Metadata" });
    expect(within(repositoryMetadata).getAllByText("/workspace/agent-workbench-docs").length).toBeGreaterThan(0);
    expect(
      within(repositoryMetadata).getByText("https://github.com/example/agent-workbench-docs.git")
    ).toBeInTheDocument();
    expect(within(repositoryMetadata).getByText("feature/docs-sweep")).toBeInTheDocument();
    expect(within(repositoryMetadata).getByText("#42")).toBeInTheDocument();
    expect(within(repositoryMetadata).getByText("Approved")).toBeInTheDocument();
  });

  it("reuses the shared archive export panel for project archives", async () => {
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export Project Archive" }));

    expect(await screen.findByText("Include Raw Artifacts")).toBeInTheDocument();
    expect(
      await screen.findByText("Raw artifacts may include sensitive local data")
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^Export Project Archive$/u })[1]!);

    expect(bridge.createArchive).toHaveBeenCalledWith({
      scope: { kind: "project", projectId: "project-1" },
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true
    });
  });
});
