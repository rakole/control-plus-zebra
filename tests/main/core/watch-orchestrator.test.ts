import path from "node:path";

import { describe, expect, it } from "vitest";

import type { SessionSourceAdapter } from "../../../src/main/core/adapter-contract/session-source-adapter.js";
import type { AdapterContext, DiscoveredHarnessSource } from "../../../src/main/core/adapter-contract/types.js";
import { fakeTestAdapter } from "../../../src/main/adapters/fake-test/index.js";
import { exerciseAdapter } from "../../contract/run-adapter-contract.js";
import { WatchOrchestrator } from "../../../src/main/core/watcher/index.js";
import type { WatchPlan, WatchRuntimeEvent } from "../../../src/main/core/watcher/watch-plan.js";

const fixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);

describe("WatchOrchestrator", () => {
  it("records adapter watch support truth without starting watcher lifecycle in adapters", async () => {
    const orchestrator = new WatchOrchestrator();
    const exercised = await exerciseAdapter(fakeTestAdapter, fixturePath);

    const record = await orchestrator.planForSource(
      fakeTestAdapter,
      exercised.source,
      exercised.context
    );

    expect(record.status).toBe("unsupported");
    expect(record.strategy).toBe("none");
    expect(record.scopePaths).toEqual([]);
    expect(orchestrator.getRecord(exercised.source.id)).toEqual(record);
  });

  it("preserves supported poll plans exactly as supplied by the adapter", async () => {
    const source = buildSource({
      adapterId: "stub-watch",
      sourceId: "source-stub-watch",
      rootPath: "/tmp/source"
    });
    const adapter = createStubAdapter({
      adapterId: "stub-watch",
      sourceId: source.id,
      strategy: "poll",
      status: "supported",
      scopePaths: ["/tmp/source/chats", "/tmp/source/tool-outputs"],
      reason: "Poll these artifact directories on an interval."
    });
    const orchestrator = new WatchOrchestrator();

    const record = await orchestrator.planForSource(adapter, source, buildContext());

    expect(record).toMatchObject({
      adapterId: "stub-watch",
      sourceId: source.id,
      status: "supported",
      strategy: "poll",
      scopePaths: ["/tmp/source/chats", "/tmp/source/tool-outputs"],
      reason: "Poll these artifact directories on an interval."
    });
  });

  it("routes a poll event through stale-cache and update-signal hooks", async () => {
    const source = buildSource({
      adapterId: "stub-route",
      sourceId: "source-stub-route",
      rootPath: "/tmp/source"
    });
    const adapter = createStubAdapter({
      adapterId: "stub-route",
      sourceId: source.id,
      strategy: "poll",
      status: "supported",
      scopePaths: ["/tmp/source/chats"]
    });
    const staleEvents: WatchRuntimeEvent[] = [];
    const signaledEvents: WatchRuntimeEvent[] = [];
    const orchestrator = new WatchOrchestrator({
      onSourceCacheStale(event) {
        staleEvents.push(event);
      },
      onSourceUpdateSignaled(event) {
        signaledEvents.push(event);
      }
    });

    await orchestrator.planForSource(adapter, source, buildContext());
    const result = await orchestrator.routeEvent({
      adapterId: "stub-route",
      sourceId: source.id,
      origin: "poll",
      observedAt: "2026-05-24T09:30:00.000Z",
      scopePath: "/tmp/source/chats/session-1.jsonl",
      reason: "Polling detected a newer artifact mtime."
    });

    expect(result.accepted).toBe(true);
    expect(result.events.map((event) => event.type)).toEqual([
      "source-cache-stale",
      "source-update-signaled"
    ]);
    expect(staleEvents).toHaveLength(1);
    expect(signaledEvents).toHaveLength(1);
    expect(staleEvents[0]).toMatchObject({
      sourceId: source.id,
      origin: "poll",
      scopePath: "/tmp/source/chats/session-1.jsonl"
    });
    expect(signaledEvents[0]).toMatchObject({
      sourceId: source.id,
      origin: "poll"
    });
  });

  it("rejects routed events outside the adapter-declared watch scope", async () => {
    const source = buildSource({
      adapterId: "stub-route-scope",
      sourceId: "source-stub-route-scope",
      rootPath: "/tmp/source"
    });
    const adapter = createStubAdapter({
      adapterId: "stub-route-scope",
      sourceId: source.id,
      strategy: "poll",
      status: "supported",
      scopePaths: ["/tmp/source/chats"]
    });
    const staleEvents: WatchRuntimeEvent[] = [];
    const orchestrator = new WatchOrchestrator({
      onSourceCacheStale(event) {
        staleEvents.push(event);
      }
    });

    await orchestrator.planForSource(adapter, source, buildContext());
    const result = await orchestrator.routeEvent({
      adapterId: "stub-route-scope",
      sourceId: source.id,
      origin: "poll",
      observedAt: "2026-05-24T09:30:00.000Z",
      scopePath: "/tmp/source/unplanned/session-1.jsonl"
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("outside the planned watch scope");
    expect(staleEvents).toHaveLength(0);
  });
});

function createStubAdapter(input: {
  adapterId: string;
  sourceId: string;
  strategy: WatchPlan["strategy"];
  status: WatchPlan["status"];
  scopePaths: string[];
  reason?: string;
}): SessionSourceAdapter {
  return {
    descriptor: {
      id: input.adapterId,
      displayName: "Stub Watch Adapter",
      adapterVersion: "1.0.0",
      supportedPlatforms: ["darwin"],
      defaultRoots: [],
      capabilities: {
        discovery: {
          defaultRoots: true,
          projectRootMapping: "native",
          stableProjectId: true,
          stableSessionId: true
        },
        replay: {
          transcriptReplay: true,
          messageRoles: true,
          assistantMessages: true,
          lifecycleEvents: true,
          cancellationEvents: true,
          topicEvents: true,
          rawEventPointers: true
        },
        tools: {
          toolCalls: true,
          toolResults: true,
          fileReads: true,
          fileSearches: true,
          fileMutations: true,
          diffStats: true,
          shellCommands: true,
          shellOutputs: true,
          sidecarOutputs: true
        },
        usage: {
          modelNames: true,
          tokenCounts: true,
          costEstimates: false
        },
        live: {
          activeSessionDetection: "mtime",
          watchableArtifacts: true,
          incrementalParsing: false
        },
        audit: {
          agentClaimDetection: true,
          finalAnswerDetection: true,
          shellExitCodeEvidence: true,
          verificationCommandEvidence: true
        },
        export: {
          rawArtifactExport: true,
          normalizedExport: true
        }
      }
    },
    async getDefaultSourceRoots() {
      return [];
    },
    async validateSourceRoot() {
      throw new Error("Not implemented for this test.");
    },
    async *discoverSources() {
      throw new Error("Not implemented for this test.");
    },
    async *discoverArtifacts() {
      throw new Error("Not implemented for this test.");
    },
    async *parseArtifact() {
      throw new Error("Not implemented for this test.");
    },
    async normalize() {
      throw new Error("Not implemented for this test.");
    },
    async getWatchPlan() {
      return {
        adapterId: input.adapterId,
        sourceId: input.sourceId,
        status: input.status,
        scopePaths: [...input.scopePaths],
        strategy: input.strategy,
        ...(input.reason ? { reason: input.reason } : {})
      };
    }
  };
}

function buildSource(input: {
  adapterId: string;
  sourceId: string;
  rootPath: string;
}): DiscoveredHarnessSource {
  return {
    id: input.sourceId,
    adapterId: input.adapterId,
    nativeId: input.rootPath,
    rootPath: input.rootPath,
    displayName: "Stub Source",
    confidence: {
      level: "high",
      normalizedLevel: "confirmed"
    }
  };
}

function buildContext(): AdapterContext {
  return {
    platform: process.platform
  };
}
