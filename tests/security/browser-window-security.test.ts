import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const windowSourcePath = path.join(repoRoot, "src", "main", "window.ts");
const remoteHttpsLoadTarget = ["https:", "", ""].join("/");

describe("BrowserWindow security defaults", () => {
  it("keeps Node disabled, context isolation enabled, sandboxing enabled, and preload explicit", async () => {
    const source = await readFile(windowSourcePath, "utf8");

    expect(source).toMatch(/nodeIntegration:\s*false/u);
    expect(source).toMatch(/contextIsolation:\s*true/u);
    expect(source).toMatch(/sandbox:\s*true/u);
    expect(source).toMatch(/preload:\s*preloadPath/u);
    expect(source).toContain('path.join(__dirname, "preload.cjs")');
  });

  it("loads only the Vite development server variable or packaged local renderer file", async () => {
    const source = await readFile(windowSourcePath, "utf8");

    expect(source).toContain("MAIN_WINDOW_VITE_DEV_SERVER_URL");
    expect(source).toContain("window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)");
    expect(source).toContain("window.loadFile(");
    expect(source).not.toContain(remoteHttpsLoadTarget);
    expect(source).not.toMatch(/loadURL\(\s*["'`]/u);
  });

  it("would reject disabled BrowserWindow protections in synthetic source", () => {
    const insecureSource = [
      "new BrowserWindow({",
      "  webPreferences: {",
      `    nodeIntegration: ${"true"},`,
      `    contextIsolation: ${"false"},`,
      `    sandbox: ${"false"}`,
      "  }",
      "});"
    ].join("\n");

    expect(insecureSource).not.toMatch(/nodeIntegration:\s*false/u);
    expect(insecureSource).not.toMatch(/contextIsolation:\s*true/u);
    expect(insecureSource).not.toMatch(/sandbox:\s*true/u);
  });
});
