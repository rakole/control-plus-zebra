import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AdapterContext, DiscoveredHarnessSource, RawArtifactRef } from "../../../src/main/core/adapter-contract/index.js";
import { createSafeFilesystem } from "../../../src/main/core/security/index.js";
import { geminiCliAdapter } from "../../../src/main/adapters/gemini-cli/index.js";

import { collectAsync } from "../../contract/run-adapter-contract.js";

export const geminiFixtureRoot = path.resolve("src/main/adapters/gemini-cli/fixtures/sample-root");

export function createGeminiAdapterContext(rootPath: string): AdapterContext {
  return {
    projectDir: process.cwd(),
    platform: process.platform,
    safeFilesystem: createSafeFilesystem({
      allowedRootPaths: [rootPath]
    })
  };
}

export function createGeminiArtifactContext(
  rootPath: string,
  artifacts: RawArtifactRef[]
): AdapterContext {
  return {
    projectDir: process.cwd(),
    platform: process.platform,
    safeFilesystem: createSafeFilesystem({
      allowedArtifacts: artifacts.map((artifact) => ({
        artifactId: artifact.id,
        path: artifact.path
      })),
      allowedRootPaths: [rootPath]
    })
  };
}

export async function collectGeminiSources(rootPath: string): Promise<DiscoveredHarnessSource[]> {
  return collectAsync(
    geminiCliAdapter.discoverSources(
      {
        rootPath
      },
      createGeminiAdapterContext(rootPath)
    )
  );
}

export async function requireGeminiSource(
  rootPath: string,
  displayName: string
): Promise<DiscoveredHarnessSource> {
  const sources = await collectGeminiSources(rootPath);
  const source = sources.find((candidate) => candidate.displayName === displayName);

  if (!source) {
    throw new Error(`Unable to find Gemini source '${displayName}'.`);
  }

  return source;
}

export async function collectGeminiArtifacts(
  source: DiscoveredHarnessSource
): Promise<RawArtifactRef[]> {
  return collectAsync(
    geminiCliAdapter.discoverArtifacts(source, createGeminiAdapterContext(source.rootPath))
  );
}

export async function createTempGeminiFixtureRoot(): Promise<{
  rootPath: string;
  tempDir: string;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "awb-gemini-fixture-"));
  const rootPath = path.join(tempDir, "sample-root");

  await cp(geminiFixtureRoot, rootPath, { recursive: true });

  return {
    rootPath,
    tempDir
  };
}

export async function cleanupTempGeminiFixtureRoot(tempDir: string): Promise<void> {
  await rm(tempDir, { force: true, recursive: true });
}
