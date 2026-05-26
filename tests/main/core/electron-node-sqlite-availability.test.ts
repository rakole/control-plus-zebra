import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const requireFromTest = createRequire(import.meta.url);
const SQLITE_PROBE_PREFIX = "SQLITE_PROBE_RESULT ";

interface ElectronSqliteProbeResult {
  main: SqliteContextProbe;
  utility?: SqliteContextProbe;
  versions: {
    electron?: string;
    node: string;
  };
}

interface SqliteContextProbe {
  context: "main" | "utility";
  errorMessage?: string;
  hasDatabaseSync?: boolean;
  ok: boolean;
  versions: {
    electron?: string;
    node: string;
  };
}

describe("Electron node:sqlite availability", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it(
    "imports node:sqlite from actual Electron main and utility process contexts",
    async () => {
      const appDir = await mkdtemp(path.join(os.tmpdir(), "awb-electron-sqlite-"));

      tempDirs.push(appDir);
      await writeProbeApp(appDir);

      const electronPath = requireFromTest("electron") as string;
      const { stdout } = await runElectronProbe(electronPath, appDir);
      const resultLine = stdout
        .split(/\r?\n/u)
        .find((line) => line.startsWith(SQLITE_PROBE_PREFIX));

      expect(resultLine).toBeDefined();
      if (!resultLine) {
        throw new Error("Expected Electron SQLite probe output.");
      }

      const result = JSON.parse(
        resultLine.slice(SQLITE_PROBE_PREFIX.length)
      ) as ElectronSqliteProbeResult;

      expect(result.main).toMatchObject({
        context: "main",
        ok: true,
        hasDatabaseSync: true
      });
      expect(result.utility).toMatchObject({
        context: "utility",
        ok: true,
        hasDatabaseSync: true
      });
      expect(result.versions.electron).toBeTruthy();
      expect(result.versions.node).toBeTruthy();
    },
    45_000
  );
});

async function writeProbeApp(appDir: string): Promise<void> {
  await writeFile(
    path.join(appDir, "package.json"),
    `${JSON.stringify({ main: "main.cjs", name: "awb-electron-sqlite-probe" }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appDir, "main.cjs"),
    `
const path = require("node:path");
const { app, utilityProcess } = require("electron");

let finished = false;
let timeoutId;

function probeSqlite(context) {
  try {
    const sqlite = require("node:sqlite");

    return {
      context,
      ok: true,
      hasDatabaseSync: typeof sqlite.DatabaseSync === "function",
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      }
    };
  } catch (error) {
    return {
      context,
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      }
    };
  }
}

function finish(payload, exitCode) {
  if (finished) {
    return;
  }

  finished = true;
  clearTimeout(timeoutId);
  console.log("${SQLITE_PROBE_PREFIX}" + JSON.stringify(payload));
  app.exit(exitCode);
}

app.whenReady().then(() => {
  const main = probeSqlite("main");
  const child = utilityProcess.fork(path.join(__dirname, "utility-probe.cjs"), [], {
    stdio: "pipe"
  });
  let utility;
  let stderr = "";

  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("message", (message) => {
    utility = message;
  });
  child.on("exit", (code) => {
    const fallbackUtility = utility ?? {
      context: "utility",
      ok: false,
      errorMessage: stderr || "Utility process exited before reporting node:sqlite status.",
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      },
      exitCode: code
    };

    finish(
      {
        main,
        utility: fallbackUtility,
        versions: {
          electron: process.versions.electron,
          node: process.versions.node
        }
      },
      main.ok && fallbackUtility.ok ? 0 : 1
    );
  });
}).catch((error) => {
  finish(
    {
      main: {
        context: "main",
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        versions: {
          electron: process.versions.electron,
          node: process.versions.node
        }
      },
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      }
    },
    1
  );
});

timeoutId = setTimeout(() => {
  finish(
    {
      main: probeSqlite("main"),
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      },
      timeout: true
    },
    1
  );
}, 15_000);
`,
    "utf8"
  );
  await writeFile(
    path.join(appDir, "utility-probe.cjs"),
    `
function probeSqlite() {
  try {
    const sqlite = require("node:sqlite");

    return {
      context: "utility",
      ok: true,
      hasDatabaseSync: typeof sqlite.DatabaseSync === "function",
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      }
    };
  } catch (error) {
    return {
      context: "utility",
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      versions: {
        electron: process.versions.electron,
        node: process.versions.node
      }
    };
  }
}

const result = probeSqlite();
process.parentPort.postMessage(result);
setImmediate(() => process.exit(result.ok ? 0 : 1));
`,
    "utf8"
  );
}

async function runElectronProbe(
  electronPath: string,
  appDir: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(electronPath, [appDir], {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1"
      },
      timeout: 30_000
    });

    return {
      stdout,
      stderr
    };
  } catch (error) {
    const failure = error as Error & {
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };

    throw new Error(
      [
        failure.message,
        "Generated main.cjs:",
        await readProbeMain(appDir),
        "Electron stdout:",
        String(failure.stdout ?? ""),
        "Electron stderr:",
        String(failure.stderr ?? "")
      ].join("\n")
    );
  }
}

async function readProbeMain(appDir: string): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");

    return await readFile(path.join(appDir, "main.cjs"), "utf8");
  } catch {
    return "<unavailable>";
  }
}
