import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const publicMethodPattern = /^\s{2}([A-Za-z0-9_]+)\(/gmu;
const forbiddenPublicNames = ["invoke", "send", "on", "removeListener", "ipcRenderer"];

describe("theme preload API surface", () => {
  it("declares a separate window.agentWorkbenchTheme bridge contract", async () => {
    const typesSource = await readFile("src/preload/types.ts", "utf8");

    expect(typesSource).toContain("interface AgentWorkbenchThemeBridge");
    expect(typesSource).toContain("getThemeState()");
    expect(typesSource).toContain("setThemePreference(preference");
    expect(typesSource).toContain("onThemeStateChanged(callback");
    expect(typesSource).toContain("agentWorkbenchTheme: AgentWorkbenchThemeBridge;");
    expect(typesSource).toContain("agentWorkbench: AgentWorkbenchBridge;");
    expect(extractInterfaceMethodNames(typesSource, "AgentWorkbenchThemeBridge")).toEqual([
      "getThemeState",
      "setThemePreference",
      "onThemeStateChanged"
    ]);
    expect(findForbiddenPublicNames(typesSource, "AgentWorkbenchThemeBridge")).toEqual([]);
  });

  it("declares explicit theme preference and theme state types", async () => {
    const typesSource = await readFile("src/preload/types.ts", "utf8");

    expect(typesSource).toMatch(/type ThemePreference = "system" \| "light" \| "dark";/u);
    expect(typesSource).toMatch(/type EffectiveTheme = "light" \| "dark";/u);
    expect(typesSource).toMatch(
      /interface ThemeState \{[\s\S]*preference: ThemePreference;[\s\S]*effectiveTheme: EffectiveTheme;[\s\S]*shouldUseHighContrastColors: boolean;[\s\S]*\}/u
    );
    expect(typesSource).toMatch(/getThemeState\(\): Promise<ThemeState>;/u);
    expect(typesSource).toMatch(/setThemePreference\(preference: ThemePreference\)/u);
    expect(typesSource).toMatch(
      /onThemeStateChanged\(callback: \(state: ThemeState\) => void\): \(\) => void;/u
    );
  });

  it("exposes the theme bridge separately from window.agentWorkbench", async () => {
    const preloadSource = await readFile("src/preload/index.ts", "utf8");
    const themeBridgeSource = await readFile("src/preload/theme-bridge.ts", "utf8");

    expect(preloadSource).toContain(
      'contextBridge.exposeInMainWorld("agentWorkbenchTheme", agentWorkbenchTheme)'
    );
    expect(themeBridgeSource).toContain(
      "const agentWorkbenchTheme: AgentWorkbenchThemeBridge = Object.freeze({"
    );
    expect(themeBridgeSource).toContain("ipcRenderer.on(");
    expect(themeBridgeSource).toContain("ipcRenderer.removeListener(");
    expect(extractBridgeMethodNames(themeBridgeSource, "agentWorkbenchTheme")).toEqual([
      "getThemeState",
      "setThemePreference",
      "onThemeStateChanged"
    ]);
    expect(preloadSource).not.toMatch(
      /contextBridge\.exposeInMainWorld\("agentWorkbenchTheme",\s*agentWorkbench\)/u
    );
  });
});

function extractInterfaceMethodNames(source: string, interfaceName: string): string[] {
  const body = extractInterfaceBody(source, interfaceName);

  return [...body.matchAll(publicMethodPattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function extractBridgeMethodNames(source: string, bridgeName: string): string[] {
  const bridgeObject = extractBridgeObject(source, bridgeName);

  return [...bridgeObject.matchAll(publicMethodPattern)].flatMap((match) =>
    match[1] ? [match[1]] : []
  );
}

function findForbiddenPublicNames(source: string, interfaceName: string): string[] {
  const body = extractInterfaceBody(source, interfaceName);

  return forbiddenPublicNames.filter((name) => new RegExp(`\\b${name}\\s*\\(`, "u").test(body));
}

function extractInterfaceBody(source: string, interfaceName: string): string {
  const body = source.match(
    new RegExp(`interface ${interfaceName} \\{(?<body>[\\s\\S]*?)\\n\\}`, "u")
  )?.groups?.body;

  if (!body) {
    throw new Error(`Expected ${interfaceName} interface in preload types source.`);
  }

  return body;
}

function extractBridgeObject(source: string, bridgeName: string): string {
  const body = source.match(
    new RegExp(
      `const ${bridgeName}:[^=]+= Object\\.freeze\\(\\{(?<body>[\\s\\S]*?)\\n\\}\\);`,
      "u"
    )
  )?.groups?.body;

  if (!body) {
    throw new Error(`Expected ${bridgeName} preload bridge in preload source.`);
  }

  return body;
}
