import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  }
}));

type SourceDataChangedEvent = {
  sourceId: string;
  status: "stale" | "scan-completed" | "scan-failed";
  reason?: string;
  completedAt?: string;
};

type AgentWorkbenchBridge = {
  onSourceDataChanged(callback: (event: SourceDataChangedEvent) => void): () => void;
};

describe("source data preload bridge", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("subscribes to source data changes and removes the same listener", async () => {
    await import("../../src/preload/index.js");

    const bridge = getAgentWorkbenchBridge();
    const callback = vi.fn<(event: SourceDataChangedEvent) => void>();
    const event: SourceDataChangedEvent = {
      sourceId: "source-live",
      status: "scan-completed",
      completedAt: "2026-06-06T12:00:00.000Z"
    };

    const unsubscribe = bridge.onSourceDataChanged(callback);

    expect(electronMocks.on).toHaveBeenCalledWith("sources:dataChanged", expect.any(Function));

    const listener = electronMocks.on.mock.calls[0]?.[1];

    if (typeof listener !== "function") {
      throw new Error("Expected source data bridge to register an IPC listener.");
    }

    listener({}, event);

    expect(callback).toHaveBeenCalledWith(event);

    unsubscribe();

    expect(electronMocks.removeListener).toHaveBeenCalledWith("sources:dataChanged", listener);
  });
});

function getAgentWorkbenchBridge(): AgentWorkbenchBridge {
  const exposure = electronMocks.exposeInMainWorld.mock.calls.find(
    ([bridgeName]) => bridgeName === "agentWorkbench"
  );

  if (!exposure) {
    throw new Error("Expected preload to expose window.agentWorkbench.");
  }

  return exposure[1] as AgentWorkbenchBridge;
}
