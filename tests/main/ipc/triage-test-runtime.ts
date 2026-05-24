import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkbenchRuntime } from "../../../src/main/app/workbench-runtime.js";

const fakeFixturePath = path.resolve(
  "src/main/adapters/fake-test/fixtures/phase1-session.fixture.json"
);
const geminiFixtureRoot = path.resolve("src/main/adapters/gemini-cli/fixtures/sample-root");

export async function createScannedRuntime(tempDirs: string[]) {
  const runtime = await createTempRuntime(tempDirs);
  const fakeSource = await runtime.sourceRegistry.createSource({
    adapterId: "fake-test",
    displayName: "Fixture Source",
    rootPath: fakeFixturePath
  });
  const fakeValidated = await runtime.scanner.validateSource(fakeSource.sourceId);

  await runtime.scanner.scanSource(fakeValidated.source.sourceId);

  const geminiRoot = path.join(runtime.appDataDir, "gemini-root");

  await cp(geminiFixtureRoot, geminiRoot, { recursive: true });

  const geminiSource = await runtime.sourceRegistry.createSource({
    adapterId: "gemini-cli",
    displayName: "Gemini Fixture Root",
    rootPath: geminiRoot
  });
  const geminiValidated = await runtime.scanner.validateSource(geminiSource.sourceId);

  await runtime.scanner.scanSource(geminiValidated.source.sourceId);
  return runtime;
}

export async function createTempRuntime(tempDirs: string[]) {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "awb-triage-service-"));

  tempDirs.push(appDataDir);
  return createWorkbenchRuntime({
    appDataDir,
    projectDir: process.cwd()
  });
}

export async function cleanupTempDirs(tempDirs: string[]) {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
}
