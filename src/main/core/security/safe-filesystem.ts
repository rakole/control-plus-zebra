import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import type { RawArtifactId } from "../model/identifiers.js";
import {
  assertBoundedLine,
  DEFAULT_BOUNDED_INGESTION_LIMITS
} from "../ingestion/bounded-ingestion.js";
import { isPathWithinDirectory, isSamePath } from "./path-allowlist.js";

export interface SafeFilesystemEntry {
  path: string;
  realPath: string;
  kind: "directory" | "file";
  byteLength?: number;
  inode?: number;
  mtimeMs: number;
}

export interface SafeFilesystem {
  statPath(targetPath: string): Promise<SafeFilesystemEntry>;
  listDirectory(targetPath: string): Promise<SafeFilesystemEntry[]>;
  readTextFile(targetPath: string): Promise<string>;
  readTextLines(
    targetPath: string,
    options?: { artifactId?: RawArtifactId; maxLineBytes?: number }
  ): AsyncIterable<string>;
  readIndexedTextArtifact(artifactId: RawArtifactId, targetPath: string): Promise<string>;
}

export class SafeFilesystemError extends Error {
  readonly code:
    | "safe-filesystem.access-unknown"
    | "safe-filesystem.access-unsupported"
    | "safe-filesystem.artifact-not-indexed"
    | "safe-filesystem.path-not-allowed";
  readonly attemptedPath: string;
  readonly artifactId?: RawArtifactId;

  constructor(
    code: SafeFilesystemError["code"],
    attemptedPath: string,
    artifactId?: RawArtifactId
  ) {
    super(getSafeFilesystemErrorMessage(code));
    this.name = "SafeFilesystemError";
    this.code = code;
    this.attemptedPath = attemptedPath;
    if (artifactId) {
      this.artifactId = artifactId;
    }
  }
}

interface SafeFilesystemOptions {
  accessStatus?: "supported" | "unknown" | "unsupported";
  allowedArtifacts?: Array<{ artifactId: RawArtifactId; path: string }>;
  allowedArtifactPaths?: string[];
  allowedRootPaths: string[];
}

interface AllowedRoot {
  kind: "directory" | "file";
  path: string;
}

interface AllowedArtifact {
  artifactId?: RawArtifactId;
  path: string;
}

export function createSafeFilesystem(options: SafeFilesystemOptions): SafeFilesystem {
  return {
    async statPath(targetPath) {
      await assertPathAllowed(targetPath, options);
      const fileStat = await stat(targetPath);
      const canonicalPath = await realpath(targetPath);

      return {
        path: path.resolve(targetPath),
        realPath: canonicalPath,
        kind: fileStat.isDirectory() ? "directory" : "file",
        ...(fileStat.isFile() ? { byteLength: fileStat.size } : {}),
        ...(typeof fileStat.ino === "number" ? { inode: fileStat.ino } : {}),
        mtimeMs: fileStat.mtimeMs
      };
    },

    async listDirectory(targetPath) {
      await assertPathAllowed(targetPath, options);
      const directoryEntries = await readdir(targetPath);

      return Promise.all(
        directoryEntries.map(async (entryName) => {
          const entryPath = path.join(targetPath, entryName);
          return this.statPath(entryPath);
        })
      );
    },

    async readTextFile(targetPath) {
      await assertPathAllowed(targetPath, options);
      return readFile(targetPath, "utf8");
    },

    async *readTextLines(targetPath, lineOptions = {}) {
      await assertPathAllowed(targetPath, options, lineOptions.artifactId);
      const lineReader = createInterface({
        crlfDelay: Infinity,
        input: createReadStream(targetPath, { encoding: "utf8" })
      });
      const maxLineBytes =
        lineOptions.maxLineBytes ?? DEFAULT_BOUNDED_INGESTION_LIMITS.maxTextLineBytes;

      try {
        for await (const line of lineReader) {
          assertBoundedLine({
            code: "artifact.line-too-large",
            line,
            limitBytes: maxLineBytes,
            subject: `Line in ${path.basename(targetPath)}`
          });
          yield line;
        }
      } finally {
        lineReader.close();
      }
    },

    async readIndexedTextArtifact(artifactId, targetPath) {
      await assertPathAllowed(targetPath, options, artifactId);
      return readFile(targetPath, "utf8");
    }
  };
}

async function assertPathAllowed(
  targetPath: string,
  options: SafeFilesystemOptions,
  artifactId?: RawArtifactId
): Promise<void> {
  if (options.accessStatus === "unsupported") {
    throw new SafeFilesystemError(
      "safe-filesystem.access-unsupported",
      path.resolve(targetPath),
      artifactId
    );
  }

  if (options.accessStatus === "unknown") {
    throw new SafeFilesystemError(
      "safe-filesystem.access-unknown",
      path.resolve(targetPath),
      artifactId
    );
  }

  const [roots, artifacts, target] = await Promise.all([
    Promise.all(options.allowedRootPaths.map(resolveAllowedRoot)),
    Promise.all([
      ...(options.allowedArtifacts ?? []).map((artifact) => resolveAllowedArtifact(artifact)),
      ...(options.allowedArtifactPaths ?? []).map((artifactPath) =>
        resolveAllowedArtifact({ path: artifactPath })
      )
    ]),
    resolveTargetPath(targetPath)
  ]);

  const allowedByRoot = roots.some((root) =>
    root.kind === "directory"
      ? isPathWithinDirectory(root.path, target.path)
      : isSamePath(root.path, target.path)
  );
  const allowedByArtifact = artifacts.some(
    (artifact) =>
      isSamePath(artifact.path, target.path) &&
      (artifactId === undefined || artifact.artifactId === artifactId)
  );

  if (artifactId !== undefined && !allowedByArtifact) {
    throw new SafeFilesystemError(
      "safe-filesystem.artifact-not-indexed",
      path.resolve(targetPath),
      artifactId
    );
  }

  if (artifactId === undefined && !allowedByRoot && !allowedByArtifact) {
    throw new SafeFilesystemError("safe-filesystem.path-not-allowed", path.resolve(targetPath));
  }
}

async function resolveAllowedRoot(rootPath: string): Promise<AllowedRoot> {
  const resolved = path.resolve(rootPath);

  try {
    const [canonicalPath, fileStat] = await Promise.all([realpath(resolved), stat(resolved)]);

    return {
      kind: fileStat.isDirectory() ? "directory" : "file",
      path: canonicalPath
    };
  } catch {
    return {
      kind: "file",
      path: resolved
    };
  }
}

async function resolveAllowedArtifact(input: {
  artifactId?: RawArtifactId;
  path: string;
}): Promise<AllowedArtifact> {
  const resolved = path.resolve(input.path);

  try {
    return {
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      path: await realpath(resolved)
    };
  } catch {
    return {
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      path: resolved
    };
  }
}

async function resolveTargetPath(targetPath: string): Promise<{ path: string }> {
  const resolved = path.resolve(targetPath);

  try {
    return {
      path: await realpath(resolved)
    };
  } catch {
    return {
      path: resolved
    };
  }
}

function getSafeFilesystemErrorMessage(code: SafeFilesystemError["code"]): string {
  switch (code) {
    case "safe-filesystem.access-unknown":
      return "Safe filesystem access is unknown for this source.";
    case "safe-filesystem.access-unsupported":
      return "Safe filesystem access is unsupported for this source.";
    case "safe-filesystem.artifact-not-indexed":
      return "Output artifact reads are allowed only for indexed artifacts.";
    case "safe-filesystem.path-not-allowed":
      return "Path is outside the configured safe filesystem allowlist.";
  }
}
