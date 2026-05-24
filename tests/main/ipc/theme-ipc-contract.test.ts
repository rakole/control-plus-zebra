import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ALLOWED_IPC_CHANNELS, IPC_CHANNELS } from "../../../src/main/ipc/channels.js";

describe("theme IPC contract", () => {
  it("reserves explicit request and notification theme channels", () => {
    const themeChannels = IPC_CHANNELS as Record<string, string>;

    expect(themeChannels).toMatchObject({
      getThemeState: "theme:getState",
      setThemePreference: "theme:setPreference",
      themeStateChanged: "theme:stateChanged"
    });
    expect(ALLOWED_IPC_CHANNELS).toEqual(
      expect.arrayContaining(["theme:getState", "theme:setPreference"])
    );
    expect(ALLOWED_IPC_CHANNELS).not.toContain("theme:stateChanged");
  });

  it("keeps theme contracts on the dedicated theme namespace", async () => {
    const channelsSource = await readFile("src/main/ipc/channels.ts", "utf8");

    expect(channelsSource).toMatch(/getThemeState:\s*"theme:getState"/u);
    expect(channelsSource).toMatch(/setThemePreference:\s*"theme:setPreference"/u);
    expect(channelsSource).toMatch(/themeStateChanged:\s*"theme:stateChanged"/u);
  });

  it("does not introduce broad theme or Electron escape-hatch channel names", async () => {
    const channelsSource = await readFile("src/main/ipc/channels.ts", "utf8");

    expect(channelsSource).not.toMatch(
      /\b(?:invokeTheme|themeInvoke|electron:theme|ipc:theme|theme:message)\b/u
    );
  });
});
