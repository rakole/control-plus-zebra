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
import { createSafeFilesystem } from "../../core/security/safe-filesystem.js";
import { archiveDocumentSchema } from "../../core/archive/archive-manifest.js";
import { archiveReaderCapabilities, archiveReaderDescriptor } from "./descriptor.js";

export async function validateArchiveReaderSourceRoot(
  root: SourceRootConfig,
  context: AdapterContext
): Promise<SourceRootValidation> {
  const resolvedPath = path.resolve(root.rootPath);
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedRootPaths: [resolvedPath]
    });

  try {
    const fileStat = await safeFilesystem.statPath(resolvedPath);

    if (fileStat.kind !== "file") {
      return invalidArchiveResult(
        resolvedPath,
        "archive-reader.source.not-file",
        "Imported archives must point to a single archive file."
      );
    }

    const source = await safeFilesystem.readTextFile(resolvedPath);
    archiveDocumentSchema.parse(JSON.parse(source));
  } catch {
    return invalidArchiveResult(
      resolvedPath,
      "archive-reader.source.invalid",
      "Imported archive is unreadable or does not match the supported archive format."
    );
  }

  return {
    ok: true,
    normalizedPath: resolvedPath,
    diagnostics: [],
    capabilities: archiveReaderCapabilities
  };
}

export async function* discoverArchiveReaderSources(
  root: SourceRootConfig,
  context: AdapterContext
): AsyncIterable<DiscoveredHarnessSource> {
  const validation = await validateArchiveReaderSourceRoot(root, context);

  if (!validation.ok || !validation.normalizedPath) {
    return;
  }

  yield {
    id: createSourceId(archiveReaderDescriptor.id, validation.normalizedPath),
    adapterId: archiveReaderDescriptor.id,
    nativeId: validation.normalizedPath,
    rootPath: validation.normalizedPath,
    displayName: root.displayName ?? path.basename(validation.normalizedPath),
    confidence: HIGH_CONFIDENCE,
    metadata: {
      sourceKind: "imported-archive"
    }
  };
}

export async function* discoverArchiveReaderArtifacts(
  source: DiscoveredHarnessSource,
  context: AdapterContext
): AsyncIterable<RawArtifactRef> {
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedRootPaths: [source.rootPath]
    });
  const fileStat = await safeFilesystem.statPath(source.rootPath);

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
    artifactType: "archive-document",
    mediaType: "application/json",
    ...(fileStat.byteLength !== undefined ? { byteLength: fileStat.byteLength } : {}),
    ...(fileStat.inode !== undefined ? { inode: fileStat.inode } : {}),
    mtimeMs: fileStat.mtimeMs
  };
}

function invalidArchiveResult(
  resolvedPath: string,
  code: string,
  message: string
): SourceRootValidation {
  return {
    ok: false,
    normalizedPath: resolvedPath,
    diagnostics: [
      buildDiagnostic(
        archiveReaderDescriptor.id,
        code,
        message,
        "error",
        "source",
        HIGH_CONFIDENCE,
        {
          nativeId: resolvedPath
        }
      )
    ]
  };
}
