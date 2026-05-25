import path from "node:path";

import type {
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  SourceRootConfig,
  SourceRootValidation
} from "../../core/adapter-contract/types.js";
import {
  adapterReadTextLines,
  adapterStatFile
} from "../../core/adapter-contract/context-helpers.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE } from "../../core/model/confidence.js";
import { createRawArtifactId, createSourceId } from "../../core/model/identifiers.js";
import { archiveLineSchema } from "../../core/archive/archive-manifest.js";
import { archiveReaderCapabilities, archiveReaderDescriptor } from "./descriptor.js";

export async function validateArchiveReaderSourceRoot(
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
      return invalidArchiveResult(
        resolvedPath,
        "archive-reader.source.not-file",
        "Imported archives must point to a single archive file."
      );
    }

    let firstLine: string | undefined;

    for await (const line of adapterReadTextLines(
      {
        ...context,
        allowedRoots: context.allowedRoots ?? [resolvedPath]
      },
      resolvedPath
    )) {
      if (line.trim().length > 0) {
        firstLine = line;
        break;
      }
    }

    const parsed = archiveLineSchema.parse(JSON.parse(firstLine ?? ""));

    if (parsed.kind !== "manifest") {
      throw new Error("Archive first section must be a manifest.");
    }
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
    nativeId: source.rootPath,
    path: source.rootPath,
    artifactKind: "metadata",
    parseStrategy: "json",
    artifactType: "archive-document",
    mediaType: "application/json",
    ...(fileStat.sizeBytes !== undefined ? { sizeBytes: fileStat.sizeBytes } : {}),
    ...(fileStat.byteLength !== undefined ? { byteLength: fileStat.byteLength } : {}),
    ...(fileStat.inode !== undefined ? { inode: String(fileStat.inode) } : {}),
    ...(fileStat.mtime ? { mtime: fileStat.mtime } : {}),
    ...(fileStat.mtimeMs !== undefined ? { mtimeMs: fileStat.mtimeMs } : {})
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
