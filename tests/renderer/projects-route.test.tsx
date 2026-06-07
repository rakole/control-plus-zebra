import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildProject, installBridgeMocks } from "./triage-test-helpers.js";

type BuildFlagGlobal = typeof globalThis & {
  __AW_FEATURE_GITHUB_UI__?: boolean;
};

async function renderProjectsApp(
  args: {
    githubUiEnabled?: boolean;
    projects?: NonNullable<
      Parameters<typeof installBridgeMocks>[0]
    >["projects"];
  } = {},
) {
  vi.resetModules();
  (globalThis as BuildFlagGlobal).__AW_FEATURE_GITHUB_UI__ =
    args.githubUiEnabled ?? false;
  installBridgeMocks(args.projects ? { projects: args.projects } : {});
  const { App } = await import("../../src/renderer/App.js");

  return render(<App />);
}

describe("Projects route", () => {
  beforeEach(() => {
    window.location.hash = "#/projects";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    (globalThis as BuildFlagGlobal).__AW_FEATURE_GITHUB_UI__ = false;
  });

  it(
    "renders project list/detail surfaces and updates the selected project metadata",
    async () => {
    await renderProjectsApp({
      projects: [
        buildProject(),
        buildProject({
          projectId: "project-2",
          projectDisplayName: "agent-workbench-docs",
          primaryRootPath: {
            status: "value",
            displayValue: "/workspace/agent-workbench-docs",
            rawValue: "/workspace/agent-workbench-docs",
          },
          validatedRepoRoot: {
            status: "value",
            displayValue: "/workspace/agent-workbench-docs",
            rawValue: "/workspace/agent-workbench-docs",
          },
          observedHarnesses: ["Fake Test Harness"],
          sessionCount: 1,
          latestVerification: {
            label: "Unknown",
            tone: "neutral",
            reason: "No verification evidence.",
          },
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
            displayValue: "https://github.com/example/agent-workbench-docs.git",
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
            rawArtifactsReason:
              "No indexed raw artifacts are available for this archive scope.",
          },
        }),
      ],
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Projects" }),
    ).toBeInTheDocument();

    const master = screen.getByRole("region", { name: "Projects list" });
    const detail = screen.getByRole("region", {
      name: "Selected project details",
    });

    expect(
      within(master).getByRole("button", { name: /control-plus-zebra/u }),
    ).toBeInTheDocument();
    expect(
      within(master).getByRole("button", { name: /agent-workbench-docs/u }),
    ).toBeInTheDocument();

    let repositoryMetadata = within(detail).getByRole("region", {
      name: "Repository Metadata",
    });
    expect(
      within(repositoryMetadata).getAllByText("/workspace/control-plus-zebra")
        .length,
    ).toBeGreaterThan(0);
    expect(within(repositoryMetadata).getByText("main")).toBeInTheDocument();
    expect(
      within(repositoryMetadata).getByText("abc12345"),
    ).toBeInTheDocument();
    expect(
      within(repositoryMetadata).queryByText(
        "https://github.com/example/control-plus-zebra.git",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(repositoryMetadata).queryByText("No Matching PR"),
    ).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      within(master).getByRole("button", { name: /agent-workbench-docs/u }),
    );

    expect(
      within(detail).getByRole("heading", { name: "agent-workbench-docs" }),
    ).toBeInTheDocument();
    repositoryMetadata = within(detail).getByRole("region", {
      name: "Repository Metadata",
    });
    expect(
      within(repositoryMetadata).getAllByText("/workspace/agent-workbench-docs")
        .length,
    ).toBeGreaterThan(0);
    expect(
      within(repositoryMetadata).getByText("feature/docs-sweep"),
    ).toBeInTheDocument();
    expect(
      within(repositoryMetadata).getByText("def67890"),
    ).toBeInTheDocument();
    expect(
      within(repositoryMetadata).queryByText(
        "https://github.com/example/agent-workbench-docs.git",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(repositoryMetadata).queryByText("#42"),
    ).not.toBeInTheDocument();
    expect(
      within(repositoryMetadata).queryByText("Approved"),
    ).not.toBeInTheDocument();
    expect(
      within(repositoryMetadata).queryByText("Passing"),
    ).not.toBeInTheDocument();
    },
    15000,
  );

  it(
    "keeps GitHub project fields hidden by default, including custom-hosted GitHub remotes",
    async () => {
    await renderProjectsApp({
      projects: [
        buildProject({
          latestVerification: { label: "Not Run", tone: "neutral" },
          gitStatus: { label: "Available", tone: "info" },
          githubStatus: {
            label: "No Matching PR",
            tone: "neutral",
            reason:
              "No matching pull request was found for the current remote and branch snapshot.",
          },
          dirtyState: { label: "Unknown", tone: "neutral" },
          remoteUrl: {
            status: "value",
            displayValue:
              "ssh://git@github.company.example/example/control-plus-zebra.git",
          },
          pullRequest: { status: "value", displayValue: "No Matching PR" },
          checks: { status: "value", displayValue: "No Matching PR" },
          reviewStatus: { status: "value", displayValue: "No Matching PR" },
        }),
      ],
    });

    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Projects" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "control-plus-zebra",
      }),
    ).toBeInTheDocument();

    const master = screen.getByRole("region", { name: "Projects list" });
    const detail = screen.getByRole("region", {
      name: "Selected project details",
    });
    const projectCard = within(master).getByRole("button", {
      name: /control-plus-zebra/u,
    });

    expect(within(projectCard).queryByText("Unknown")).not.toBeInTheDocument();

    const runAuditBadge = within(projectCard).getByText("Needs Review");
    expect(runAuditBadge).toHaveAttribute(
      "title",
      "Run audit status: Needs Review",
    );

    await user.hover(runAuditBadge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Run audit status: Needs Review",
    );

    expect(within(projectCard).getByText("Not Run")).toHaveAttribute(
      "title",
      "Verification status: Not Run",
    );
    expect(within(projectCard).getByText("Branch main")).toHaveAttribute(
      "title",
      "Branch: main",
    );
    expect(
      within(projectCard).queryByTitle("GitHub status: No Matching PR"),
    ).not.toBeInTheDocument();
    expect(within(projectCard).queryByText(/^PR /u)).not.toBeInTheDocument();

    const detailBadge = within(detail).getByText("Available");
    expect(detailBadge).toHaveAttribute("title", "Git status: Available");
    expect(
      within(detail).queryByTitle("GitHub status: No Matching PR"),
    ).not.toBeInTheDocument();
    expect(
      within(detail).queryByTitle("Dirty state: Unknown"),
    ).not.toBeInTheDocument();
    expect(
      within(detail).queryByText(
        "ssh://git@github.company.example/example/control-plus-zebra.git",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(detail).queryByText("No Matching PR"),
    ).not.toBeInTheDocument();

    await user.hover(detailBadge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Git status: Available",
    );
    },
    15000,
  );

  it(
    "keeps generic custom remotes visible while GitHub project fields stay hidden by default",
    async () => {
    await renderProjectsApp({
      projects: [
        buildProject({
          latestVerification: { label: "Not Run", tone: "neutral" },
          gitStatus: { label: "Available", tone: "info" },
          githubStatus: {
            label: "No Matching PR",
            tone: "neutral",
            reason:
              "No matching pull request was found for the current remote and branch snapshot.",
          },
          dirtyState: { label: "Unknown", tone: "neutral" },
          remoteUrl: {
            status: "value",
            displayValue:
              "ssh://git@git.company.example/example/control-plus-zebra.git",
          },
          pullRequest: { status: "value", displayValue: "No Matching PR" },
          checks: { status: "value", displayValue: "No Matching PR" },
          reviewStatus: { status: "value", displayValue: "No Matching PR" },
        }),
      ],
    });

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "control-plus-zebra",
      }),
    ).toBeInTheDocument();

    const detail = screen.getByRole("region", {
      name: "Selected project details",
    });

    expect(
      within(detail).getByText(
        "ssh://git@git.company.example/example/control-plus-zebra.git",
      ),
    ).toBeInTheDocument();
    expect(
      within(detail).queryByText("No Matching PR"),
    ).not.toBeInTheDocument();
    },
    15000,
  );

  it(
    "renders GitHub project fields when the GitHub UI flag is enabled",
    async () => {
    await renderProjectsApp({
      githubUiEnabled: true,
      projects: [
        buildProject({
          githubStatus: { label: "PR Open", tone: "info" },
          remoteUrl: {
            status: "value",
            displayValue:
              "ssh://git@git.company.example/example/control-plus-zebra.git",
          },
          pullRequest: { status: "value", displayValue: "#42 Upgrade UI lock" },
          checks: { status: "value", displayValue: "Passing" },
          reviewStatus: { status: "value", displayValue: "Approved" },
        }),
      ],
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Projects" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep shared git, GitHub, and archive-export truth visible across observed project summaries.",
      ),
    ).toBeInTheDocument();

    const master = screen.getByRole("region", { name: "Projects list" });
    const detail = screen.getByRole("region", {
      name: "Selected project details",
    });
    const projectCard = within(master).getByRole("button", {
      name: /control-plus-zebra/u,
    });
    const repositoryMetadata = within(detail).getByRole("region", {
      name: "Repository Metadata",
    });

    expect(
      within(projectCard).getByTitle("GitHub status: PR Open"),
    ).toBeInTheDocument();
    expect(
      within(projectCard).getByText("PR #42 Upgrade UI lock"),
    ).toBeInTheDocument();
    expect(
      within(repositoryMetadata).getByText(
        "ssh://git@git.company.example/example/control-plus-zebra.git",
      ),
    ).toBeInTheDocument();
    expect(
      within(repositoryMetadata).getByText("#42 Upgrade UI lock"),
    ).toBeInTheDocument();
    expect(within(repositoryMetadata).getByText("Passing")).toBeInTheDocument();
    expect(
      within(repositoryMetadata).getByText("Approved"),
    ).toBeInTheDocument();
    },
    15000,
  );

  it("reuses the shared archive export panel for project archives", async () => {
    vi.resetModules();
    (globalThis as BuildFlagGlobal).__AW_FEATURE_GITHUB_UI__ = false;
    const bridge = installBridgeMocks();
    const user = userEvent.setup();
    const { App } = await import("../../src/renderer/App.js");
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Projects" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Export Project Archive" }),
    );

    expect(
      await screen.findByText("Include Raw Artifacts"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Raw artifacts may include sensitive local data"),
    ).toBeInTheDocument();

    await user.click(
      screen.getAllByRole("button", { name: /^Export Project Archive$/u })[1]!,
    );

    expect(bridge.createArchive).toHaveBeenCalledWith({
      scope: { kind: "project", projectId: "project-1" },
      includeRawArtifacts: false,
      privacyWarningAcknowledged: true,
    });
  }, 15000);
});
