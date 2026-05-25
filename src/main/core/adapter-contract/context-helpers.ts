import { createSafeFilesystem } from "../security/safe-filesystem.js";
import type { SafeFilesystemEntry } from "../security/safe-filesystem.js";
import type {
  AdapterContext,
  AdapterFilesystemStat,
  RawArtifactRef
} from "./types.js";

function toFallbackFilesystem(context: AdapterContext, targetPath: string) {
  return createSafeFilesystem({
    allowedRootPaths: context.allowedRoots ?? [targetPath]
  });
}

function toAdapterStat(entry: SafeFilesystemEntry): AdapterFilesystemStat {
  return {
    path: entry.path,
    realPath: entry.realPath,
    kind: entry.kind,
    ...(entry.byteLength !== undefined ? { sizeBytes: entry.byteLength } : {}),
    ...(entry.byteLength !== undefined ? { byteLength: entry.byteLength } : {}),
    ...(entry.inode !== undefined ? { inode: entry.inode } : {}),
    ...(entry.mtimeMs !== undefined ? { mtime: new Date(entry.mtimeMs).toISOString() } : {}),
    ...(entry.mtimeMs !== undefined ? { mtimeMs: entry.mtimeMs } : {})
  };
}

export async function adapterReadTextFile(
  context: AdapterContext,
  targetPath: string,
  artifactId?: string
): Promise<string> {
  if (context.readFile) {
    return context.readFile(targetPath, artifactId);
  }

  if (context.safeFilesystem) {
    if (artifactId) {
      try {
        return await context.safeFilesystem.readIndexedTextArtifact(artifactId, targetPath);
      } catch {
        return context.safeFilesystem.readTextFile(targetPath);
      }
    }

    return context.safeFilesystem.readTextFile(targetPath);
  }

  const safeFilesystem = toFallbackFilesystem(context, targetPath);
  if (artifactId) {
    try {
      return await safeFilesystem.readIndexedTextArtifact(artifactId, targetPath);
    } catch {
      return safeFilesystem.readTextFile(targetPath);
    }
  }

  return safeFilesystem.readTextFile(targetPath);
}

export function adapterReadTextLines(
  context: AdapterContext,
  targetPath: string,
  options: { artifactId?: string; maxLineBytes?: number } = {}
): AsyncIterable<string> {
  if (context.readTextLines) {
    return context.readTextLines(targetPath, options);
  }

  if (context.safeFilesystem) {
    return context.safeFilesystem.readTextLines(targetPath, options);
  }

  return toFallbackFilesystem(context, targetPath).readTextLines(targetPath, options);
}

export async function adapterStatFile(
  context: AdapterContext,
  targetPath: string
): Promise<AdapterFilesystemStat> {
  if (context.statFile) {
    return context.statFile(targetPath);
  }

  if (context.safeFilesystem) {
    return toAdapterStat(await context.safeFilesystem.statPath(targetPath));
  }

  return toAdapterStat(await toFallbackFilesystem(context, targetPath).statPath(targetPath));
}

export function toOutputArtifactRef(
  artifact: Pick<RawArtifactRef, "adapterId" | "id" | "path" | "sourceId"> & {
    mediaType?: string;
    nativeId?: string;
  },
  sessionId?: string
) {
  return {
    id: artifact.id,
    adapterId: artifact.adapterId,
    sourceId: artifact.sourceId,
    ...(sessionId ? { sessionId } : {}),
    ...(artifact.path ? { path: artifact.path } : {}),
    ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
    ...(artifact.nativeId ? { nativeId: artifact.nativeId } : {})
  };
}
