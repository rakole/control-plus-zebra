import path from "node:path";

import type {
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  SourceRootConfig,
  SourceRootValidation
} from "../../core/adapter-contract/types.js";
import { adapterStatFile } from "../../core/adapter-contract/context-helpers.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../core/model/confidence.js";
import { createRawArtifactId, createSourceId } from "../../core/model/identifiers.js";
import { fakeTestCapabilities, fakeTestDescriptor } from "./descriptor.js";

export async function validateFakeTestSourceRoot(
  root: SourceRootConfig,
  context: AdapterContext
): Promise<SourceRootValidation> {
  const resolvedPath = path.resolve(root.rootPath);

  try {
    const fileStat = await adapterStatFile(
      {
        ...context,
        allowedRoots: context.allowedRoots ?? [resolvedPath]
      },
      resolvedPath
    );

    if (fileStat.kind !== "file") {
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
  context: AdapterContext
): AsyncIterable<RawArtifactRef> {
  const fileStat = await adapterStatFile(
    {
      ...context,
      allowedRoots: context.allowedRoots ?? [source.rootPath]
    },
    source.rootPath
  );

  yield {
    id: createRawArtifactId({
      adapterId: source.adapterId,
      sourceId: source.id,
      nativeId: source.rootPath
    }),
    adapterId: source.adapterId,
    sourceId: source.id,
    nativeRef: source.rootPath,
    path: source.rootPath,
    artifactKind: "session-log",
    parseStrategy: "json",
    nativeId: source.rootPath,
    artifactType: "fake-session-fixture",
    mediaType: "application/json",
    ...(fileStat.sizeBytes !== undefined ? { sizeBytes: fileStat.sizeBytes } : {}),
    ...(fileStat.byteLength !== undefined ? { byteLength: fileStat.byteLength } : {}),
    ...(fileStat.inode !== undefined ? { inode: String(fileStat.inode) } : {}),
    ...(fileStat.mtime ? { mtime: fileStat.mtime } : {}),
    ...(fileStat.mtimeMs !== undefined ? { mtimeMs: fileStat.mtimeMs } : {})
  };
}
