import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FileBackedAppSettingsStore } from "../../../src/main/app/app-settings-store.js";

describe("app settings store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults retention to seven days when no settings file exists", async () => {
    const store = new FileBackedAppSettingsStore(await tempDir());

    await expect(store.load()).resolves.toEqual({
      retentionDays: 7
    });
  });

  it("persists supported retention windows", async () => {
    const dir = await tempDir();
    const store = new FileBackedAppSettingsStore(dir);

    await store.save({ retentionDays: 3 });

    await expect(new FileBackedAppSettingsStore(dir).load()).resolves.toEqual({
      retentionDays: 3
    });
  });

  it("persists settings through a temp file rename", async () => {
    const dir = await tempDir();
    const store = new FileBackedAppSettingsStore(dir);

    await store.save({ retentionDays: 30 });

    await expect(fs.readdir(dir)).resolves.toEqual(["app-settings.json"]);
    await expect(fs.readFile(path.join(dir, "app-settings.json"), "utf8")).resolves.toContain(
      "\"retentionDays\": 30"
    );
  });

  it("falls back to defaults for invalid settings payloads", async () => {
    const dir = await tempDir();

    await fs.writeFile(
      path.join(dir, "app-settings.json"),
      `${JSON.stringify({ version: 1, settings: { retentionDays: 90 } })}\n`,
      "utf8"
    );

    await expect(new FileBackedAppSettingsStore(dir).load()).resolves.toEqual({
      retentionDays: 7
    });
  });

  it("falls back to defaults for malformed or truncated settings JSON", async () => {
    const dir = await tempDir();

    await fs.writeFile(path.join(dir, "app-settings.json"), "{\n", "utf8");

    await expect(new FileBackedAppSettingsStore(dir).load()).resolves.toEqual({
      retentionDays: 7
    });
  });
});

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "control-plus-zebra-settings-"));
}
