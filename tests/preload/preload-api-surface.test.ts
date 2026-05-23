import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const publicMethodPattern = /^\s{2}([A-Za-z0-9_]+)\(/gmu;
const forbiddenPublicNames = ["invoke", "send", "on", "removeListener", "ipcRenderer"];

describe("preload API surface", () => {
  it("declares exactly one public method per allowed operation", async () => {
    const typesSource = await readFile("src/preload/types.ts", "utf8");

    expect(typesSource).toContain("getShellState()");
    expect(typesSource).toContain("listSessions(request?");
    expect(typesSource).toContain("getSessionById(request");
    expect(extractBridgeMethodNames(typesSource)).toEqual([
      "getShellState",
      "listSessions",
      "getSessionById"
    ]);
    expect(findForbiddenPublicNames(typesSource)).toEqual([]);
  });

  it("exposes the typed bridge name without a generic helper", async () => {
    const preloadSource = await readFile("src/preload/index.ts", "utf8");

    expect(preloadSource).toContain('contextBridge.exposeInMainWorld("agentWorkbench"');
    expect(extractBridgeMethodNames(preloadSource)).toEqual([
      "getShellState",
      "listSessions",
      "getSessionById"
    ]);
    expect(preloadSource).not.toMatch(/\b(?:fs|child_process|shell)\b/u);
    expect(preloadSource).not.toMatch(/(?<!\.)\binvoke\s*\(/u);
    expect(preloadSource).not.toMatch(/\b(?:send|on|removeListener)\s*\(/u);
  });
});

function extractBridgeMethodNames(source: string): string[] {
  return [...source.matchAll(publicMethodPattern)].flatMap((match) =>
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
