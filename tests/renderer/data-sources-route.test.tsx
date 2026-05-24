import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";
import type {
  DataSourceAdapterViewModel,
  DataSourcesResponse,
  DataSourceViewModel as IpcDataSourceViewModel
} from "../../src/main/ipc/view-models.js";

const adapters = [
  buildAdapter({
    adapterId: "fixture-harness",
    displayName: "Fixture Harness",
    capabilityGroups: [
      buildCapabilityGroup("discovery", "Discovery", [
        buildCapabilityBadge({
          key: "discovery.sessionDiscovery",
          label: "Session Discovery",
          state: "Supported"
        })
      ]),
      buildCapabilityGroup("live", "Live", [
        buildCapabilityBadge({
          key: "live.watchableArtifacts",
          label: "Watchable Artifacts",
          state: "Supported",
          reason: "Shared watcher plan is available for this harness."
        })
      ])
    ]
  }),
  buildAdapter({
    adapterId: "archive-reader",
    displayName: "Archive Reader",
    capabilityGroups: [
      buildCapabilityGroup("discovery", "Discovery", [
        buildCapabilityBadge({
          key: "discovery.sessionDiscovery",
          label: "Session Discovery",
          state: "Unsupported",
          reason: "This harness does not currently report scan support."
        })
      ]),
      buildCapabilityGroup("live", "Live", [
        buildCapabilityBadge({
          key: "live.watchableArtifacts",
          label: "Watchable Artifacts",
          state: "Unknown",
          reason: "Watch support has not been reported for this harness."
        })
      ])
    ]
  })
];

const firstSource = buildSource({
  sourceId: "source-1",
  adapterId: "fixture-harness",
  adapterDisplayName: "Fixture Harness",
  sourceName: "Fixture Root",
  rootPath: "/Users/rhishi/.fixtures/agent-workbench",
  enabled: true,
  enabledLabel: "Enabled",
  validationStatus: "Valid",
  scanStatus: "Scanned with Diagnostics",
  scanReason: "4 artifacts were normalized with parser warnings.",
  cacheStatus: "Cached",
  watchSupport: "Watch Supported",
  watchReason: "Shared watcher orchestration is available.",
  diagnosticCount: 2,
  diagnostics: [
    {
      code: "source.partial-output",
      severity: "warning",
      message: "One output artifact is intentionally unavailable.",
      sourceArea: "source"
    },
    {
      code: "cache.mtime-shift",
      severity: "info",
      message: "Cache metadata was refreshed after the latest scan.",
      sourceArea: "cache"
    }
  ]
});

const secondSource = buildSource({
  sourceId: "source-2",
  adapterId: "archive-reader",
  adapterDisplayName: "Archive Reader",
  sourceName: "Archive Inbox",
  rootPath: "/Volumes/agent-archives/import",
  enabled: true,
  enabledLabel: "Enabled",
  sourceKind: "Imported Archive",
  addedBy: "Import",
  readOnly: true,
  readOnlyLabel: "Read Only",
  readOnlyReason:
    "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import.",
  archiveMetadata: {
    archivePath: "/Volumes/agent-archives/import/archive.awb-archive.json",
    exportedAt: "2026-05-24T08:00:00.000Z",
    importedAt: "2026-05-24T08:05:00.000Z",
    manifestVersion: 1,
    scopeKind: "project",
    scopeId: "project-1",
    scopeLabel: "Archive Inbox",
    sourceCount: 1,
    sessionCount: 2,
    projectCount: 1,
    rawArtifactCount: 0
  },
  validationStatus: "Unsupported",
  scanStatus: "Unsupported",
  scanReason:
    "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import.",
  cacheStatus: "Cached",
  cacheReason: "Archive contents were imported into the local read-only cache.",
  watchSupport: "Watch Unsupported",
  watchReason:
    "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import.",
  diagnosticCount: 1,
  diagnostics: [
    {
      code: "source.waiting-on-adapter",
      severity: "warning",
      message: "Additional adapter support is still required for this source.",
      sourceArea: "adapter"
    }
  ]
});

describe("Data Sources route", () => {
  const listDataSources = vi.fn();
  const addDataSource = vi.fn();
  const openArchiveBridge = vi.fn();
  const updateDataSource = vi.fn();
  const setDataSourceEnabled = vi.fn();
  const validateDataSource = vi.fn();
  const scanDataSource = vi.fn();

  beforeEach(() => {
    window.location.hash = "#/data-sources";

    listDataSources.mockResolvedValue(buildDataSourcesResponse([firstSource, secondSource]));
    addDataSource.mockImplementation(({ adapterId, displayName, rootPath, enabled }) =>
      Promise.resolve(
        buildDataSourcesResponse([
          buildSource({
            sourceId: "source-new",
            adapterId,
            adapterDisplayName:
              adapters.find((adapter) => adapter.adapterId === adapterId)?.displayName ??
              "Fixture Harness",
            sourceName: displayName,
            rootPath,
            enabled,
            enabledLabel: enabled ? "Enabled" : "Disabled",
            validationStatus: "Not Validated",
            scanStatus: "Never Scanned",
            cacheStatus: "Unknown",
            watchSupport: "Watch Supported",
            watchReason: "Shared watcher plan is available for this harness.",
            diagnosticCount: 0,
            diagnostics: []
          }),
          firstSource,
          secondSource
        ])
      )
    );
    updateDataSource.mockImplementation(({ sourceId, adapterId, displayName, rootPath }) =>
      Promise.resolve(
        buildDataSourcesResponse([
          buildSource({
            sourceId,
            adapterId,
            adapterDisplayName:
              adapters.find((adapter) => adapter.adapterId === adapterId)?.displayName ??
              "Fixture Harness",
            sourceName: displayName,
            rootPath,
            enabled: true,
            enabledLabel: "Enabled",
            validationStatus: "Not Validated",
            scanStatus: "Never Scanned",
            cacheStatus: "Unknown",
            watchSupport: "Watch Supported",
            watchReason: "Shared watcher plan is available for this harness.",
            diagnosticCount: 0,
            diagnostics: []
          }),
          secondSource
        ])
      )
    );
    setDataSourceEnabled.mockImplementation(({ sourceId, enabled }) =>
      Promise.resolve(
        buildDataSourcesResponse([
          buildSource({
            ...firstSource,
            sourceId,
            enabled,
            enabledLabel: enabled ? "Enabled" : "Disabled"
          }),
          secondSource
        ])
      )
    );
    validateDataSource.mockResolvedValue(
      buildDataSourcesResponse([
        buildSource({
          sourceId: "source-new",
          adapterId: "fixture-harness",
          adapterDisplayName: "Fixture Harness",
          sourceName: "Fresh Source",
          rootPath: "/tmp/fresh-source",
          enabled: true,
          enabledLabel: "Enabled",
          validationStatus: "Valid",
          scanStatus: "Never Scanned",
          cacheStatus: "Unknown",
          watchSupport: "Watch Supported",
          watchReason: "Shared watcher plan is available for this harness.",
          diagnosticCount: 0,
          diagnostics: []
        }),
        firstSource,
        secondSource
      ])
    );
    scanDataSource.mockResolvedValue(
      buildDataSourcesResponse([
        buildSource({
          sourceId: "source-new",
          adapterId: "fixture-harness",
          adapterDisplayName: "Fixture Harness",
          sourceName: "Fresh Source",
          rootPath: "/tmp/fresh-source",
          enabled: true,
          enabledLabel: "Enabled",
          validationStatus: "Valid",
          scanStatus: "Scanned with Diagnostics",
          scanReason: "Normalization completed with one parser warning.",
          cacheStatus: "Cached",
          watchSupport: "Watch Supported",
          watchReason: "Shared watcher plan is available for this harness.",
          diagnosticCount: 1,
          diagnostics: [
            {
              code: "scan.normalized-with-warning",
              severity: "warning",
              message: "One artifact emitted a non-blocking parser warning.",
              sourceArea: "normalization"
            }
          ]
        }),
        firstSource,
        secondSource
      ])
    );
    openArchiveBridge.mockResolvedValue({
      ok: true,
      archiveImport: {
        status: "cancelled"
      }
    });

    Object.defineProperty(window, "agentWorkbench", {
      configurable: true,
      value: {
        getShellState: vi.fn(),
        openArchive: openArchiveBridge,
        listSessions: vi.fn(),
        getSessionById: vi.fn(),
        listDataSources,
        addDataSource,
        updateDataSource,
        setDataSourceEnabled,
        validateDataSource,
        scanDataSource
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("list and detail rendering", () => {
    it("loads source summaries through the bridge and renders explicit truth states", async () => {
      renderDataSourcesRoute();

      expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
      expect(screen.getByText("Local and archived sources")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Source" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import Archive" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload Data Sources" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Data Sources" })).toHaveAttribute(
        "aria-current",
        "page"
      );
      expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();

      const route = await screen.findByLabelText("Data Sources route");
      expect(listDataSources).toHaveBeenCalledTimes(1);

      const list = within(route).getByLabelText("Data source summaries");
      expect(within(list).getByRole("button", { name: /Fixture Root/u })).toBeInTheDocument();
      expect(within(list).getByRole("button", { name: /Archive Inbox/u })).toBeInTheDocument();
      expect(within(list).getAllByText("Unsupported").length).toBeGreaterThan(0);
      expect(within(list).getAllByText("Imported Archive").length).toBeGreaterThan(0);
      expect(within(list).getAllByText("Read Only").length).toBeGreaterThan(0);
      expect(within(list).getAllByText("Cached").length).toBeGreaterThan(0);
      expect(within(route).queryByText("Passed")).not.toBeInTheDocument();
      expect(within(route).queryByText("Clean")).not.toBeInTheDocument();
    });

    it("renders the selected source form, statuses, diagnostics, and enabled switch", async () => {
      renderDataSourcesRoute();

      await screen.findByRole("button", { name: /Fixture Root/u });

      expect(
        screen.getByRole("heading", { name: "Fixture Root" })
      ).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Harness" })).toHaveValue("fixture-harness");
      expect(screen.getByRole("textbox", { name: "Source Name" })).toHaveValue("Fixture Root");
      expect(screen.getByRole("textbox", { name: "Source Root Path" })).toHaveValue(
        "/Users/rhishi/.fixtures/agent-workbench"
      );
      expect(screen.getByRole("switch", { name: "Source Enabled" })).toBeChecked();

      expect(screen.getByRole("heading", { name: "Source Metadata" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Source Settings" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Validation Status" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Cache State" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Source Diagnostics" })).toBeInTheDocument();

      expect(screen.getByText("source.partial-output")).toBeInTheDocument();
      expect(screen.getByText("One output artifact is intentionally unavailable.")).toBeInTheDocument();
      expect(screen.getByText("cache.mtime-shift")).toBeInTheDocument();
      expect(screen.getByText("Cache metadata was refreshed after the latest scan.")).toBeInTheDocument();
      expect(screen.getAllByText("2 Diagnostics").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Rescan Source" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Validate Source" })).toBeEnabled();
    });
  });

  it("selects the next source with ArrowDown followed by Enter", async () => {
    const user = userEvent.setup();
    renderDataSourcesRoute();

    const firstRow = await screen.findByRole("button", { name: /Fixture Root/u });
    firstRow.focus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByRole("heading", { name: "Archive Inbox" })).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import."
      )
    ).not.toHaveLength(0);
    expect(screen.getAllByText("Imported Archive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Read Only").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Validation Unavailable" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Source Enabled" })).toBeDisabled();
  });

  it("imports an archive through the bridge and selects the imported source detail", async () => {
    const user = userEvent.setup();
    const importedSource = buildSource({
      sourceId: "source-archive-new",
      adapterId: "archive-reader",
      adapterDisplayName: "Archive Reader",
      sourceName: "Imported Project Archive",
      rootPath: "/tmp/imported.awb-archive.json",
      sourceKind: "Imported Archive",
      addedBy: "Import",
      readOnly: true,
      readOnlyLabel: "Read Only",
      readOnlyReason:
        "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import.",
      archiveMetadata: {
        archivePath: "/tmp/imported.awb-archive.json",
        exportedAt: "2026-05-24T08:00:00.000Z",
        importedAt: "2026-05-24T08:05:00.000Z",
        manifestVersion: 1,
        scopeKind: "project",
        scopeId: "project-1",
        scopeLabel: "Control Plus Zebra",
        sourceCount: 1,
        sessionCount: 2,
        projectCount: 1,
        rawArtifactCount: 0
      },
      validationStatus: "Unsupported",
      scanStatus: "Unsupported",
      cacheStatus: "Cached",
      cacheReason: "Archive contents were imported into the local read-only cache.",
      watchSupport: "Watch Unsupported",
      watchReason:
        "Imported archives are read-only sources. Live validate, scan, watch, git, and GitHub operations stay disabled after import."
    });

    openArchiveBridge.mockResolvedValueOnce({
      ok: true,
      archiveImport: {
        status: "imported",
        archivePath: "/tmp/imported.awb-archive.json",
        manifestVersion: 1,
        sourceId: "source-archive-new"
      }
    });
    listDataSources.mockResolvedValueOnce(buildDataSourcesResponse([firstSource, secondSource]));
    listDataSources.mockResolvedValueOnce(
      buildDataSourcesResponse([importedSource, firstSource, secondSource])
    );

    renderDataSourcesRoute();

    await screen.findByRole("button", { name: /Fixture Root/u });
    await user.click(screen.getByRole("button", { name: "Import Archive" }));

    await waitFor(() => expect(openArchiveBridge).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("heading", { name: "Imported Project Archive" })
    ).toBeInTheDocument();
    expect(screen.getByText("Control Plus Zebra")).toBeInTheDocument();
  });

  describe("draft and mutation flows", () => {
    it("creates a draft source with a focused root-path field and shared form controls", async () => {
      const user = userEvent.setup();
      renderDataSourcesRoute();

      await screen.findByRole("button", { name: /Fixture Root/u });
      await user.click(screen.getByRole("button", { name: "Add Source" }));

      expect(screen.getByRole("heading", { name: "Draft source" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Harness" })).toHaveValue("fixture-harness");
      expect(screen.getByRole("textbox", { name: "Source Name" })).toHaveValue("");
      expect(screen.getByRole("textbox", { name: "Source Root Path" })).toHaveFocus();
      expect(screen.getByRole("switch", { name: "Source Enabled" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Validate Source" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Scan Source" })).toBeDisabled();
    });

    it("validates a new draft source before scan becomes available", async () => {
      const user = userEvent.setup();
      renderDataSourcesRoute();

      await screen.findByRole("button", { name: /Fixture Root/u });
      await user.click(screen.getByRole("button", { name: "Add Source" }));

      await user.clear(screen.getByRole("textbox", { name: "Source Name" }));
      await user.type(screen.getByRole("textbox", { name: "Source Name" }), "Fresh Source");
      await user.type(screen.getByRole("textbox", { name: "Source Root Path" }), "/tmp/fresh-source");

      const validateButton = screen.getByRole("button", { name: "Validate Source" });
      expect(validateButton).toBeEnabled();

      await user.click(validateButton);

      await waitFor(() =>
        expect(addDataSource).toHaveBeenCalledWith({
          adapterId: "fixture-harness",
          displayName: "Fresh Source",
          enabled: true,
          rootPath: "/tmp/fresh-source"
        })
      );
      await waitFor(() =>
        expect(validateDataSource).toHaveBeenCalledWith({ sourceId: "source-new" })
      );

      expect(scanDataSource).not.toHaveBeenCalled();
      expect(
        screen.getByText("Source root validated through the shared source registry.")
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Scan Source" })).toBeEnabled();
    });

    it("runs scan on the validated source and renders returned diagnostics", async () => {
      const user = userEvent.setup();
      renderDataSourcesRoute();

      await screen.findByRole("button", { name: /Fixture Root/u });
      await user.click(screen.getByRole("button", { name: "Add Source" }));
      await user.type(screen.getByRole("textbox", { name: "Source Name" }), "Fresh Source");
      await user.type(screen.getByRole("textbox", { name: "Source Root Path" }), "/tmp/fresh-source");
      await user.click(screen.getByRole("button", { name: "Validate Source" }));

      await waitFor(() =>
        expect(validateDataSource).toHaveBeenCalledWith({ sourceId: "source-new" })
      );

      await user.click(screen.getByRole("button", { name: "Scan Source" }));

      await waitFor(() => expect(scanDataSource).toHaveBeenCalledWith({ sourceId: "source-new" }));
      expect(await screen.findByRole("button", { name: "Rescan Source" })).toBeInTheDocument();
      expect(
        screen.getByText("Normalization completed with one parser warning.")
      ).toBeInTheDocument();
      expect(screen.getByText("scan.normalized-with-warning")).toBeInTheDocument();
      expect(
        screen.getByText("One artifact emitted a non-blocking parser warning.")
      ).toBeInTheDocument();
    });

    it("persists existing source enabled toggles through the dedicated preload method", async () => {
      const user = userEvent.setup();
      renderDataSourcesRoute();

      const enabledSwitch = await screen.findByRole("switch", { name: "Source Enabled" });
      expect(enabledSwitch).toBeChecked();

      await user.click(enabledSwitch);

      await waitFor(() =>
        expect(setDataSourceEnabled).toHaveBeenCalledWith({
          enabled: false,
          sourceId: "source-1"
        })
      );
      expect(updateDataSource).not.toHaveBeenCalled();
    });
  });

  it("renders the exact empty state copy", async () => {
    listDataSources.mockResolvedValueOnce(buildDataSourcesResponse([]));

    renderDataSourcesRoute();

    expect(await screen.findByText("No data sources configured")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add a local harness source or import an archive to populate sessions and project summaries."
      )
    ).toBeInTheDocument();
  });

  it("renders the exact sanitized load error copy", async () => {
    listDataSources.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "data-sources.list.failed",
        message: "Raw path leak /Users/private/source-root"
      }
    } satisfies DataSourcesResponse);

    renderDataSourcesRoute();

    expect(
      await screen.findByText(
        "Data sources could not load. Check the source registry bridge and IPC handler, then reload data sources."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/Users\/private/u)).not.toBeInTheDocument();
  });

  it("shows validation and scan failure copy when the selected source reports failed states", async () => {
    listDataSources.mockResolvedValueOnce(
      buildDataSourcesResponse([
        buildSource({
          sourceId: "source-3",
          adapterId: "fixture-harness",
          adapterDisplayName: "Fixture Harness",
          sourceName: "Broken Source",
          rootPath: "/tmp/broken-source",
          enabled: true,
          enabledLabel: "Enabled",
          validationStatus: "Validation Failed",
          scanStatus: "Scan Failed",
          scanReason:
            "Review source, adapter, cache, and normalization diagnostics before trying again.",
          cacheStatus: "Unknown",
          watchSupport: "Watch Unsupported",
          watchReason: "Shared watching is unsupported for this source.",
          diagnosticCount: 1,
          diagnostics: [
            {
              code: "source.invalid-root",
              severity: "error",
              message: "The configured source root is missing required artifacts.",
              sourceArea: "source"
            }
          ]
        })
      ])
    );

    renderDataSourcesRoute();

    expect(
      await screen.findByText(/Source validation failed\. Review the diagnostics/u)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Scan failed. Review source, adapter, cache, and normalization diagnostics, then rescan when the source is ready."
      )
    ).toBeInTheDocument();
  });
});

function renderDataSourcesRoute() {
  render(<App />);
}

function buildDataSourcesResponse(
  sources: IpcDataSourceViewModel[],
  adapterList: DataSourceAdapterViewModel[] = adapters
): DataSourcesResponse {
  return {
    ok: true,
    dataSources: {
      adapters: adapterList,
      sources
    }
  };
}

function buildAdapter(
  overrides: Partial<DataSourceAdapterViewModel>
): DataSourceAdapterViewModel {
  return {
    adapterId: "fixture-harness",
    displayName: "Fixture Harness",
    capabilityGroups: [],
    defaultRoots: [],
    ...overrides
  };
}

function buildCapabilityBadge(
  overrides: Partial<DataSourceAdapterViewModel["capabilityGroups"][number]["capabilities"][number]>
) {
  return {
    key: "live.watchableArtifacts",
    label: "Watchable Artifacts",
    state: "Unknown" as const,
    ...overrides
  };
}

function buildCapabilityGroup(
  key: DataSourceAdapterViewModel["capabilityGroups"][number]["key"],
  label: string,
  capabilities: DataSourceAdapterViewModel["capabilityGroups"][number]["capabilities"]
) {
  return { key, label, capabilities };
}

function buildSource(
  overrides: Partial<IpcDataSourceViewModel>
): IpcDataSourceViewModel {
  return {
    sourceId: "source-1",
    adapterId: "fixture-harness",
    adapterDisplayName: "Fixture Harness",
    sourceName: "Fixture Root",
    rootPath: "/tmp/source-root",
    enabled: true,
    enabledLabel: "Enabled",
    sourceKind: "Local Source",
    addedBy: "Configured",
    readOnly: false,
    validationStatus: "Valid",
    scanStatus: "Never Scanned",
    cacheStatus: "Unknown",
    watchSupport: "Watch Unknown",
    diagnosticCount: 0,
    capabilityGroups: [],
    diagnostics: [],
    ...overrides
  };
}
