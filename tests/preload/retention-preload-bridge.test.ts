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

type RetentionJobStatus = {
  state: "idle" | "trimming" | "clearing" | "rescanning" | "failed";
  retentionDays?: 3 | 7 | 30;
  startedAt?: string;
  completedAt?: string;
  completedSources?: number;
  totalSources?: number;
  message?: string;
};

type AgentWorkbenchBridge = {
  onRetentionJobChanged(callback: (status: RetentionJobStatus) => void): () => void;
};

describe("retention preload bridge", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("forwards validated retention job payloads and removes the same listener on unsubscribe", async () => {
    await import("../../src/preload/index.js");

    const bridge = getAgentWorkbenchBridge();
    const callback = vi.fn<(status: RetentionJobStatus) => void>();
    const status: RetentionJobStatus = {
      state: "rescanning",
      retentionDays: 30,
      startedAt: "2026-06-06T12:00:00.000Z",
      completedSources: 1,
      totalSources: 2,
      message: "Rescanning local sources with the selected timeframe."
    };

    const unsubscribe = bridge.onRetentionJobChanged(callback);

    expect(electronMocks.on).toHaveBeenCalledWith("retention:jobChanged", expect.any(Function));

    const listener = electronMocks.on.mock.calls[0]?.[1];

    if (typeof listener !== "function") {
      throw new Error("Expected retention bridge to register an IPC listener.");
    }

    listener({}, status);
    listener({}, { state: "rescanning", retentionDays: 90 });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(status);

    unsubscribe();

    expect(electronMocks.removeListener).toHaveBeenCalledWith("retention:jobChanged", listener);
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
