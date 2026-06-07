import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const publicMethodPattern = /^\s{2}([A-Za-z0-9_]+)\(/gmu;
const forbiddenPublicNames = ["invoke", "send", "on", "removeListener", "ipcRenderer"];

describe("preload API surface", () => {
  it("declares exactly one public method per allowed operation", async () => {
    const typesSource = await readFile("src/preload/types.ts", "utf8");

    expect(typesSource).toContain("getShellState()");
    expect(typesSource).toContain("listHarnesses()");
    expect(typesSource).toContain("getHarnessCapabilities(");
    expect(typesSource).toContain("listSources()");
    expect(typesSource).toContain("addSource(request");
    expect(typesSource).toContain("updateSource(request");
    expect(typesSource).toContain("disableSource(request");
    expect(typesSource).toContain("validateSource(request");
    expect(typesSource).toContain("rescanSource(request");
    expect(typesSource).toContain("getScannerStatus()");
    expect(typesSource).toContain("rescanAllSources()");
    expect(typesSource).toContain("rescanScannerSource(request");
    expect(typesSource).toContain("createArchive(request");
    expect(typesSource).toContain("openArchive(request?");
    expect(typesSource).toContain("getDashboardStats(request?");
    expect(typesSource).toContain("getOverviewActivityHeatmap(");
    expect(typesSource).toContain("listProjects(request?");
    expect(typesSource).toContain("getProject(request");
    expect(typesSource).toContain("listSessions(request?");
    expect(typesSource).toContain("getSession(request");
    expect(typesSource).toContain("getSessionTimeline(request");
    expect(typesSource).toContain("getEvents(request");
    expect(typesSource).toContain("getToolCalls(request: GetToolCallsRequest)");
    expect(typesSource).toContain("getShellCommands(request: GetShellCommandsRequest)");
    expect(typesSource).toContain("getOutputArtifactPreview(");
    expect(typesSource).toContain("loadOutputArtifact(request");
    expect(typesSource).toContain("getRunAudit(request");
    expect(typesSource).toContain("getGitSnapshot(request");
    expect(typesSource).toContain("getGitHubSnapshot(request");
    expect(typesSource).toContain("listDiagnostics(request?");
    expect(typesSource).toContain("getSettings()");
    expect(typesSource).toContain("updateSettings(request");
    expect(typesSource).toContain("getRetentionJobStatus()");
    expect(typesSource).toContain("onRetentionJobChanged(callback");
    expect(typesSource).toContain("onSourceDataChanged(callback");
    expect(extractBridgeMethodNames(typesSource)).toEqual([
      "getShellState",
      "listHarnesses",
      "getHarnessCapabilities",
      "listSources",
      "addSource",
      "updateSource",
      "disableSource",
      "validateSource",
      "rescanSource",
      "getScannerStatus",
      "rescanAllSources",
      "rescanScannerSource",
      "createArchive",
      "openArchive",
      "getDashboardStats",
      "getOverviewActivityHeatmap",
      "listProjects",
      "getProject",
      "listSessions",
      "getSession",
      "getSessionTimeline",
      "getEvents",
      "getToolCalls",
      "getShellCommands",
      "getOutputArtifactPreview",
      "loadOutputArtifact",
      "getRunAudit",
      "getGitSnapshot",
      "getGitHubSnapshot",
      "listDiagnostics",
      "getSettings",
      "updateSettings",
      "getRetentionJobStatus",
      "onRetentionJobChanged",
      "onSourceDataChanged"
    ]);
    expect(findForbiddenPublicNames(typesSource)).toEqual([]);
  });

  it("exposes the typed bridge name without a generic helper", async () => {
    const preloadSource = await readFile("src/preload/index.ts", "utf8");

    expect(preloadSource).toContain('contextBridge.exposeInMainWorld("agentWorkbench"');
    expect(extractBridgeMethodNames(preloadSource)).toEqual([
      "getShellState",
      "listHarnesses",
      "getHarnessCapabilities",
      "listSources",
      "addSource",
      "updateSource",
      "disableSource",
      "validateSource",
      "rescanSource",
      "getScannerStatus",
      "rescanAllSources",
      "rescanScannerSource",
      "createArchive",
      "openArchive",
      "getDashboardStats",
      "getOverviewActivityHeatmap",
      "listProjects",
      "getProject",
      "listSessions",
      "getSession",
      "getSessionTimeline",
      "getEvents",
      "getToolCalls",
      "getShellCommands",
      "getOutputArtifactPreview",
      "loadOutputArtifact",
      "getRunAudit",
      "getGitSnapshot",
      "getGitHubSnapshot",
      "listDiagnostics",
      "getSettings",
      "updateSettings",
      "getRetentionJobStatus",
      "onRetentionJobChanged",
      "onSourceDataChanged"
    ]);
    expect(preloadSource).not.toMatch(/\b(?:fs|child_process|shell)\b/u);
    expect(preloadSource).not.toMatch(/(?<!\.)\binvoke\s*\(/u);
    expect(preloadSource).not.toMatch(/\bsend\s*\(/u);
  });
});

function extractBridgeMethodNames(source: string): string[] {
  const bridgeSource =
    source.match(/interface AgentWorkbenchBridge \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ??
    source.match(/const agentWorkbench:[^=]+= Object\.freeze\(\{(?<body>[\s\S]*?)\n\}\);/u)
      ?.groups?.body ??
    "";

  return [...bridgeSource.matchAll(publicMethodPattern)].flatMap((match) =>
    match[1] ? [match[1]] : []
  );
}

function findForbiddenPublicNames(source: string): string[] {
  const interfaceBody = source.match(/interface AgentWorkbenchBridge \{(?<body>[\s\S]*?)\n\}/u)
    ?.groups?.body;

  if (!interfaceBody) {
    return ["AgentWorkbenchBridge"];
  }

  return forbiddenPublicNames.filter((name) =>
    new RegExp(`\\b${name}\\s*\\(`, "u").test(interfaceBody)
  );
}
