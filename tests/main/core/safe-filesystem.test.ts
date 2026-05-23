import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSafeFilesystem, SafeFilesystemError } from "../../../src/main/core/security/index.js";

describe("SafeFilesystem", () => {
  it("allows reads inside configured roots and rejects traversal and symlink escape", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-safe-fs-"));
    const rootDir = path.join(tempDir, "root");
    const outsideDir = path.join(tempDir, "outside");
    const insideFile = path.join(rootDir, "fixture.txt");
    const outsideFile = path.join(outsideDir, "secret.txt");
    const symlinkPath = path.join(rootDir, "escape-link.txt");

    await mkdir(rootDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(insideFile, "inside", "utf8");
    await writeFile(outsideFile, "outside", "utf8");
    await symlink(outsideFile, symlinkPath);

    const safeFilesystem = createSafeFilesystem({
      allowedRootPaths: [rootDir]
    });

    await expect(safeFilesystem.readTextFile(insideFile)).resolves.toBe("inside");
    await expect(safeFilesystem.readTextFile(outsideFile)).rejects.toMatchObject({
      code: "safe-filesystem.path-not-allowed"
    } satisfies Partial<SafeFilesystemError>);
    await expect(safeFilesystem.readTextFile(symlinkPath)).rejects.toMatchObject({
      code: "safe-filesystem.path-not-allowed"
    } satisfies Partial<SafeFilesystemError>);
  });

  it("allows indexed artifact reads only for allowlisted artifact identities", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-safe-fs-artifact-"));
    const rootDir = path.join(tempDir, "root");
    const artifactFile = path.join(tempDir, "artifact.txt");

    await mkdir(rootDir, { recursive: true });
    await writeFile(artifactFile, "artifact", "utf8");

    const safeFilesystem = createSafeFilesystem({
      allowedArtifacts: [{ artifactId: "artifact-1", path: artifactFile }],
      allowedRootPaths: [rootDir]
    });

    await expect(
      safeFilesystem.readIndexedTextArtifact("artifact-1", artifactFile)
    ).resolves.toBe("artifact");
    await expect(
      safeFilesystem.readIndexedTextArtifact("artifact-2", artifactFile)
    ).rejects.toMatchObject({
      code: "safe-filesystem.artifact-not-indexed",
      artifactId: "artifact-2"
    } satisfies Partial<SafeFilesystemError>);
  });

  it("surfaces unsupported source access explicitly", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aw-safe-fs-status-"));
    const filePath = path.join(tempDir, "fixture.txt");

    await writeFile(filePath, "fixture", "utf8");

    const safeFilesystem = createSafeFilesystem({
      accessStatus: "unsupported",
      allowedRootPaths: [tempDir]
    });

    await expect(safeFilesystem.readTextFile(filePath)).rejects.toMatchObject({
      code: "safe-filesystem.access-unsupported"
    } satisfies Partial<SafeFilesystemError>);
  });
});
