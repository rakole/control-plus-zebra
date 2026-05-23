import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  SourceRootConfig,
  SourceRootValidation
} from "../../core/adapter-contract/types.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../core/model/confidence.js";
import { createRawArtifactId, createSourceId } from "../../core/model/identifiers.js";
import { fakeTestCapabilities, fakeTestDescriptor } from "./descriptor.js";

export async function validateFakeTestSourceRoot(
  root: SourceRootConfig,
  _context: AdapterContext
): Promise<SourceRootValidation> {
  const resolvedPath = path.resolve(root.rootPath);

  try {
    const fileStat = await stat(resolvedPath);

    if (!fileStat.isFile()) {
      return {
        ok: false,
        normalizedPath: resolvedPath,
        diagnostics: [
          buildDiagnostic(
            fakeTestDescriptor.id,
            "fake-test.source.not-file",
            "Fake test source root must point to a single fixture file.",
            "error",
            "source",
            HIGH_CONFIDENCE,
            { nativeId: resolvedPath }
          )
        ]
      };
    }
  } catch {
    return {
      ok: false,
      normalizedPath: resolvedPath,
      diagnostics: [
        buildDiagnostic(
          fakeTestDescriptor.id,
          "fake-test.source.missing",
          "Fake test source root does not exist.",
          "error",
          "source",
          HIGH_CONFIDENCE,
          { nativeId: resolvedPath }
        )
      ]
    };
  }

  return {
    ok: true,
    normalizedPath: resolvedPath,
    diagnostics: [],
    capabilities: fakeTestCapabilities
  };
}

export async function* discoverFakeTestSources(
  root: SourceRootConfig,
  context: AdapterContext
): AsyncIterable<DiscoveredHarnessSource> {
  const validation = await validateFakeTestSourceRoot(root, context);

  if (!validation.ok || !validation.normalizedPath) {
    return;
  }

  yield {
    id: createSourceId(fakeTestDescriptor.id, validation.normalizedPath),
    adapterId: fakeTestDescriptor.id,
    nativeId: validation.normalizedPath,
    rootPath: validation.normalizedPath,
    displayName: root.displayName ?? path.basename(validation.normalizedPath),
    confidence: HIGH_CONFIDENCE,
    metadata: {
      sourceKind: "fixture-file",
      artifactType: "fake-session-fixture"
    }
  };
}

export async function* discoverFakeTestArtifacts(
  source: DiscoveredHarnessSource,
  _context: AdapterContext
): AsyncIterable<RawArtifactRef> {
  const fileStat = await stat(source.rootPath);

  yield {
    id: createRawArtifactId({
      adapterId: source.adapterId,
      sourceId: source.id,
      nativeId: source.rootPath
    }),
    adapterId: source.adapterId,
    sourceId: source.id,
    nativeId: source.rootPath,
    path: source.rootPath,
    artifactType: "fake-session-fixture",
    mediaType: "application/json",
    byteLength: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  };
}
