import { describe, expect, it } from "vitest";

import { IPC_CHANNELS, registerIpcHandlers } from "../../../src/main/ipc/index.js";
import type { SessionViewModelService } from "../../../src/main/app/session-view-model-service.js";
import {
  getSessionByIdResponseSchema,
  listSessionsResponseSchema,
  shellStateViewModelSchema,
  type SessionPreviewViewModel,
  type SessionSummaryViewModel
} from "../../../src/main/ipc/view-models.js";

describe("ipc handlers", () => {
  it("registers only the allowed IPC channels", () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeService());

    expect([...collector.handlers.keys()]).toEqual([
      IPC_CHANNELS.getShellState,
      IPC_CHANNELS.listSessions,
      IPC_CHANNELS.getSessionById
    ]);
  });

  it("returns sanitized invalid-request errors for bad get-by-id payloads", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeService());

    const result = await collector.invoke(IPC_CHANNELS.getSessionById, { sessionId: "" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        message: "Request payload is not valid for this operation."
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|\/Users|adapter|rawEvents/u);
  });

  it("returns schema-valid DTOs for shell, list, and get handlers", async () => {
    const collector = createIpcCollector();

    registerIpcHandlers(collector, createFakeService());

    const shell = await collector.invoke(IPC_CHANNELS.getShellState);
    const list = await collector.invoke(IPC_CHANNELS.listSessions);
    const get = await collector.invoke(IPC_CHANNELS.getSessionById, { sessionId: "session_1" });

    expect(() => shellStateViewModelSchema.parse(shell)).not.toThrow();
    expect(() => listSessionsResponseSchema.parse(list)).not.toThrow();
    expect(() => getSessionByIdResponseSchema.parse(get)).not.toThrow();
  });
});

function createIpcCollector() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();

  return {
    handlers,
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown) {
      handlers.set(channel, listener);
    },
    async invoke(channel: string, payload?: unknown) {
      const handler = handlers.get(channel);

      if (!handler) {
        throw new Error(`No handler registered for ${channel}`);
      }

      return handler({}, payload);
    }
  };
}

function createFakeService(): SessionViewModelService {
  const summary: SessionSummaryViewModel = {
    adapterId: "fake-test",
    adapterDisplayName: "Fake Test Harness",
    sourceId: "source_1",
    sessionId: "session_1",
    nativeSessionId: "native-session-1",
    title: "Safe fake session",
    lifecycleStatus: "completed",
    startedAt: "2026-05-23T10:00:00.000Z",
    endedAt: "2026-05-23T10:00:01.000Z",
    capabilityBadges: [
      {
        key: "sessionDiscovery",
        label: "Session discovery",
        state: "Supported"
      }
    ],
    diagnosticWarningCount: 0,
    evidenceSummary: {
      messages: 1,
      toolCalls: 1,
      shellCommands: 1,
      outputArtifacts: 1,
      fileMutations: 1,
      diagnostics: 0
    }
  };
  const preview: SessionPreviewViewModel = {
    ...summary,
    projectName: "control-plus-zebra",
    diagnostics: []
  };

  return {
    getShellState() {
      return {
        appName: "Agent Workbench",
        readOnly: true,
        allowedOperations: [
          IPC_CHANNELS.getShellState,
          IPC_CHANNELS.listSessions,
          IPC_CHANNELS.getSessionById
        ],
        adapters: [
          {
            adapterId: "fake-test",
            displayName: "Fake Test Harness"
          }
        ]
      };
    },
    async listSessions() {
      return [summary];
    },
    async getSessionById({ sessionId }: { sessionId: string }) {
      return sessionId === preview.sessionId ? preview : null;
    }
  };
}
