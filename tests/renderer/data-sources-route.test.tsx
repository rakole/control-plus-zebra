import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.js";

const adapters = [
  {
    adapterId: "fixture-harness",
    displayName: "Fixture Harness",
    watchSupport: {
      label: "Watch Supported",
      detail: "Shared watcher plan is available for this harness."
    }
  },
  {
    adapterId: "archive-reader",
    displayName: "Archive Reader",
    watchSupport: {
      label: "Watch Unknown",
      detail: "Watch support has not been reported for this harness."
    }
  }
];

const firstSource = buildSource({
  sourceId: "source-1",
  adapterId: "fixture-harness",
  adapterDisplayName: "Fixture Harness",
  sourceName: "Fixture Root",
  rootPath: "/Users/rhishi/.fixtures/agent-workbench",
  enabled: true,
  enabledLabel: "Enabled",
  validation: {
    label: "Valid",
    detail: "Source root validated through the shared source registry."
  },
  scan: {
    label: "Scanned with Diagnostics",
    detail: "4 artifacts were normalized with parser warnings."
  },
  cache: {
    label: "Cached",
    detail: "Cache snapshot is current for the latest scan."
  },
  watch: {
    label: "Watch Supported",
    detail: "Shared watcher orchestration is available."
  },
  diagnosticCount: 2,
  diagnostics: [
    {
      code: "source.partial-output",
      severity: "warning",
      message: "One output artifact is intentionally unavailable."
    },
    {
      code: "cache.mtime-shift",
      severity: "info",
      message: "Cache metadata was refreshed after the latest scan."
    }
  ],
  hasCompletedScan: true
});

const secondSource = buildSource({
  sourceId: "source-2",
  adapterId: "archive-reader",
  adapterDisplayName: "Archive Reader",
  sourceName: "Archive Inbox",
  rootPath: "/Volumes/agent-archives/import",
  enabled: false,
  enabledLabel: "Disabled",
  validation: {
    label: "Unknown",
    detail: "Validation results are unavailable for this source."
  },
  scan: {
    label: "Unsupported",
    detail: "This harness does not currently report scan support."
  },
  cache: {
    label: "Stale",
    detail: "Source settings changed. Validate the source, then rescan to refresh cache state."
  },
  watch: {
    label: "Watch Unknown",
    detail: "Watch support has not been reported for this source."
  },
  diagnosticCount: 1,
  diagnostics: [
    {
      code: "source.waiting-on-adapter",
      severity: "warning",
      message: "Additional adapter support is still required for this source."
    }
  ]
});

describe("Data Sources route", () => {
  const listDataSources = vi.fn();
  const createDataSource = vi.fn();
  const updateDataSource = vi.fn();
  const validateDataSource = vi.fn();
  const scanDataSource = vi.fn();

  beforeEach(() => {
    window.location.hash = "#/data-sources";
    listDataSources.mockResolvedValue({
      ok: true,
      adapters,
      sources: [firstSource, secondSource]
    });
    createDataSource.mockImplementation(({ adapterId, displayName, rootPath, enabled }) =>
      Promise.resolve({
        ok: true,
        source: buildSource({
          sourceId: "source-new",
          adapterId,
          adapterDisplayName:
            adapters.find((adapter) => adapter.adapterId === adapterId)?.displayName ??
            "Fixture Harness",
          sourceName: displayName,
          rootPath,
          enabled,
          enabledLabel: enabled ? "Enabled" : "Disabled",
          validation: {
            label: "Not Validated",
            detail: "Validate the source before scanning."
          },
          scan: {
            label: "Never Scanned",
            detail: "No scan has completed for this data source yet."
          },
          cache: {
            label: "Unknown",
            detail: "Cache status is unavailable until a scan completes."
          },
          watch: {
            label: "Watch Supported",
            detail: "Shared watcher plan is available for this harness."
          },
          diagnosticCount: 0,
          diagnostics: []
        })
      })
    );
    updateDataSource.mockImplementation(
      ({ sourceId, adapterId, displayName, rootPath, enabled }) =>
        Promise.resolve({
          ok: true,
          source: buildSource({
            sourceId,
            adapterId,
            adapterDisplayName:
              adapters.find((adapter) => adapter.adapterId === adapterId)?.displayName ??
              "Fixture Harness",
            sourceName: displayName,
            rootPath,
            enabled,
            enabledLabel: enabled ? "Enabled" : "Disabled",
            validation: {
              label: "Not Validated",
              detail: "Validate the source before scanning."
            },
            scan: {
              label: "Never Scanned",
              detail: "No scan has completed for this data source yet."
            },
            cache: {
              label: "Unknown",
              detail: "Cache status is unavailable until a scan completes."
            },
            watch: {
              label: "Watch Supported",
              detail: "Shared watcher plan is available for this harness."
            },
            diagnosticCount: 0,
            diagnostics: []
          })
        })
    );
    validateDataSource.mockResolvedValue({
      ok: true,
      source: buildSource({
        sourceId: "source-new",
        adapterId: "fixture-harness",
        adapterDisplayName: "Fixture Harness",
        sourceName: "Fresh Source",
        rootPath: "/tmp/fresh-source",
        enabled: true,
        enabledLabel: "Enabled",
        validation: {
          label: "Valid",
          detail: "Source root validated through the shared source registry."
        },
        scan: {
          label: "Never Scanned",
          detail: "No scan has completed for this data source yet."
        },
        cache: {
          label: "Unknown",
          detail: "Cache status is unavailable until a scan completes."
        },
        watch: {
          label: "Watch Supported",
          detail: "Shared watcher plan is available for this harness."
        },
        diagnosticCount: 0,
        diagnostics: []
      })
    });
    scanDataSource.mockResolvedValue({
      ok: true,
      source: buildSource({
        sourceId: "source-new",
        adapterId: "fixture-harness",
        adapterDisplayName: "Fixture Harness",
        sourceName: "Fresh Source",
        rootPath: "/tmp/fresh-source",
        enabled: true,
        enabledLabel: "Enabled",
        validation: {
          label: "Valid",
          detail: "Source root validated through the shared source registry."
        },
        scan: {
          label: "Scanned with Diagnostics",
          detail: "Normalization completed with one parser warning."
        },
        cache: {
          label: "Cached",
          detail: "Cache snapshot is current for the latest scan."
        },
        watch: {
          label: "Watch Supported",
          detail: "Shared watcher plan is available for this harness."
        },
        diagnosticCount: 1,
        diagnostics: [
          {
            code: "scan.normalized-with-warning",
            severity: "warning",
            message: "One artifact emitted a non-blocking parser warning."
          }
        ],
        hasCompletedScan: true
      })
    });

    Object.defineProperty(window, "agentWorkbench", {
      configurable: true,
      value: {
        getShellState: vi.fn(),
        listSessions: vi.fn(),
        getSessionById: vi.fn(),
        listDataSources,
        createDataSource,
        updateDataSource,
        validateDataSource,
        scanDataSource
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Data Sources route and loads source summaries through the bridge", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    expect(screen.getByText("Local sources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Source" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Data Sources" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data Sources" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();

    const route = await screen.findByLabelText("Data Sources route");
    expect(listDataSources).toHaveBeenCalledTimes(1);

    expect(within(route).getByRole("button", { name: /Fixture Root/u })).toBeInTheDocument();
    expect(within(route).getByRole("button", { name: /Archive Inbox/u })).toBeInTheDocument();
    expect(within(route).getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(within(route).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(route).getByText("Stale")).toBeInTheDocument();
    expect(within(route).queryByText("Passed")).not.toBeInTheDocument();
    expect(within(route).queryByText("Clean")).not.toBeInTheDocument();
  });

  it("selects the next source with ArrowDown followed by Enter", async () => {
    const user = userEvent.setup();
    render(<App />);

    const firstRow = await screen.findByRole("button", { name: /Fixture Root/u });
    firstRow.focus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByRole("heading", { name: "Archive Inbox" })).toBeInTheDocument();
    expect(screen.getByText("Validation results are unavailable for this source.")).toBeInTheDocument();
  });

  it("creates a draft source, validates it, and scans only after validation succeeds", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Fixture Root/u });

    await user.click(screen.getByRole("button", { name: "Add Source" }));

    const pathInput = screen.getByRole("textbox", { name: "Source Root Path" });
    expect(pathInput).toHaveFocus();
    expect(screen.getByRole("button", { name: "Validate Source" })).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Source Name" }));
    await user.type(screen.getByRole("textbox", { name: "Source Name" }), "Fresh Source");
    await user.type(pathInput, "/tmp/fresh-source");

    await user.click(screen.getByRole("button", { name: "Validate Source" }));

    await waitFor(() => expect(createDataSource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(validateDataSource).toHaveBeenCalledWith({ sourceId: "source-new" }));
    expect(scanDataSource).not.toHaveBeenCalled();
    expect(screen.getByText("Source root validated through the shared source registry.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Scan Source" }));

    await waitFor(() => expect(scanDataSource).toHaveBeenCalledWith({ sourceId: "source-new" }));
    expect(await screen.findByRole("button", { name: "Rescan Source" })).toBeInTheDocument();
    expect(screen.getByText("Normalization completed with one parser warning.")).toBeInTheDocument();
  });

  it("renders the exact empty state copy", async () => {
    listDataSources.mockResolvedValueOnce({
      ok: true,
      adapters,
      sources: []
    });

    render(<App />);

    expect(await screen.findByText("No data sources configured")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add a harness source root, validate it, then scan it to populate local sessions."
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
    });

    render(<App />);

    expect(
      await screen.findByText(
        "Data sources could not load. Check the source registry bridge and IPC handler, then reload data sources."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/Users\/private/u)).not.toBeInTheDocument();
  });

  it("shows validation and scan failure copy when the selected source reports failed states", async () => {
    listDataSources.mockResolvedValueOnce({
      ok: true,
      adapters,
      sources: [
        buildSource({
          sourceId: "source-3",
          adapterId: "fixture-harness",
          adapterDisplayName: "Fixture Harness",
          sourceName: "Broken Source",
          rootPath: "/tmp/broken-source",
          enabled: true,
          enabledLabel: "Enabled",
          validation: {
            label: "Invalid",
            detail: "Source validation failed for the current root path."
          },
          scan: {
            label: "Scan Failed",
            detail:
              "Review source, adapter, cache, and normalization diagnostics before trying again."
          },
          cache: {
            label: "Unknown",
            detail: "Cache status is unavailable until a scan completes."
          },
          watch: {
            label: "Watch Unsupported",
            detail: "Shared watching is unsupported for this source."
          },
          diagnosticCount: 1,
          diagnostics: [
            {
              code: "source.invalid-root",
              severity: "error",
              message: "The configured source root is missing required artifacts."
            }
          ]
        })
      ]
    });

    render(<App />);

    expect(await screen.findByText(/Source validation failed\. Review the diagnostics/u)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Scan failed. Review source, adapter, cache, and normalization diagnostics, then rescan when the source is ready."
      )
    ).toBeInTheDocument();
  });
});

function buildSource(overrides: Partial<DataSourceFixture>) {
  return {
    sourceId: "source-1",
    adapterId: "fixture-harness",
    adapterDisplayName: "Fixture Harness",
    sourceName: "Fixture Root",
    rootPath: "/tmp/source-root",
    enabled: true,
    enabledLabel: "Enabled",
    validation: {
      label: "Valid",
      detail: "Source root validated through the shared source registry."
    },
    scan: {
      label: "Never Scanned",
      detail: "No scan has completed for this data source yet."
    },
    cache: {
      label: "Unknown",
      detail: "Cache status is unavailable until a scan completes."
    },
    watch: {
      label: "Watch Unknown",
      detail: "Watch support has not been reported for this data source."
    },
    diagnosticCount: 0,
    diagnostics: [],
    hasCompletedScan: false,
    ...overrides
  };
}

type DataSourceFixture = {
  sourceId: string;
  adapterId: string;
  adapterDisplayName: string;
  sourceName?: string;
  rootPath: string;
  enabled: boolean;
  enabledLabel: "Enabled" | "Disabled";
  validation: {
    label: "Valid" | "Invalid" | "Not Validated" | "Unknown";
    detail: string;
  };
  scan: {
    label:
      | "Never Scanned"
      | "Scanning"
      | "Scan Failed"
      | "Scanned"
      | "Scanned with Diagnostics"
      | "Unsupported"
      | "Unknown";
    detail: string;
  };
  cache: {
    label: "Cached" | "Stale" | "Unsupported" | "Unknown";
    detail: string;
  };
  watch: {
    label: "Watch Supported" | "Watch Unsupported" | "Watch Unknown";
    detail: string;
  };
  diagnosticCount: number;
  diagnostics: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
  hasCompletedScan?: boolean;
};
