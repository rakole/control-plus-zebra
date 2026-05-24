import path from "node:path";

import type {
  AdapterContext,
  DiscoveredHarnessSource,
  RawArtifactRef,
  SourceRootConfig,
  SourceRootValidation
} from "../../core/adapter-contract/types.js";
import { buildDiagnostic } from "../../core/diagnostics/diagnostic.js";
import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE } from "../../core/model/confidence.js";
import { createRawArtifactId, createSourceId } from "../../core/model/identifiers.js";
import { createSafeFilesystem } from "../../core/security/safe-filesystem.js";
import { geminiCliCapabilities, geminiCliDescriptor } from "./descriptor.js";

const CHAT_FILENAME_PATTERN = /^session-.*\.jsonl$/u;
const TOOL_OUTPUT_SESSION_DIR_PATTERN = /^session-[0-9a-f-]+$/u;
const IGNORED_ENTRY_NAMES = new Set([".DS_Store"]);

interface ProjectCandidate {
  evidenceCount: number;
  hasPartialLayout: boolean;
  projectDir: string;
}

export const GEMINI_PROJECT_ROOT_ARTIFACT_TYPE = "gemini-project-root";
export const GEMINI_LOGS_ARTIFACT_TYPE = "gemini-logs";
export const GEMINI_CHAT_ARTIFACT_TYPE = "gemini-chat";
export const GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE = "gemini-tool-output";

function toArtifactKind(artifactType: string): RawArtifactRef["artifactKind"] {
  switch (artifactType) {
    case GEMINI_PROJECT_ROOT_ARTIFACT_TYPE:
      return "project-root-map";
    case GEMINI_LOGS_ARTIFACT_TYPE:
      return "history";
    case GEMINI_CHAT_ARTIFACT_TYPE:
      return "session-log";
    case GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE:
      return "output-artifact";
    default:
      return "unknown";
  }
}

function toParseStrategy(
  artifactType: string,
  mediaType?: string
): RawArtifactRef["parseStrategy"] {
  switch (artifactType) {
    case GEMINI_CHAT_ARTIFACT_TYPE:
      return "stream-jsonl";
    case GEMINI_PROJECT_ROOT_ARTIFACT_TYPE:
      return "text";
    case GEMINI_LOGS_ARTIFACT_TYPE:
      return "json";
    case GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE:
      return mediaType === "application/json" ? "json" : "text";
    default:
      return "unknown";
  }
}

export async function validateGeminiCliSourceRoot(
  root: SourceRootConfig,
  context: AdapterContext
): Promise<SourceRootValidation> {
  const resolvedPath = path.resolve(root.rootPath);
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedRootPaths: [resolvedPath]
    });

  let rootStat;

  try {
    rootStat = await safeFilesystem.statPath(resolvedPath);
  } catch {
    return {
      ok: false,
      normalizedPath: resolvedPath,
      diagnostics: [
        buildDiagnostic(
          geminiCliDescriptor.id,
          "gemini-cli.source.missing",
          "Gemini CLI source root does not exist.",
          "error",
          "source",
          HIGH_CONFIDENCE,
          { nativeId: resolvedPath }
        )
      ]
    };
  }

  if (rootStat.kind !== "directory") {
    return {
      ok: false,
      normalizedPath: resolvedPath,
      diagnostics: [
        buildDiagnostic(
          geminiCliDescriptor.id,
          "gemini-cli.source.not-directory",
          "Gemini CLI source root must point to a directory.",
          "error",
          "source",
          HIGH_CONFIDENCE,
          { nativeId: resolvedPath }
        )
      ]
    };
  }

  const candidates = await discoverProjectCandidates(resolvedPath, safeFilesystem);

  if (candidates.length === 0) {
    return {
      ok: false,
      normalizedPath: resolvedPath,
      diagnostics: [
        buildDiagnostic(
          geminiCliDescriptor.id,
          "gemini-cli.source.no-projects",
          "Gemini CLI source root did not contain any project directories with Gemini evidence.",
          "error",
          "source",
          HIGH_CONFIDENCE,
          { nativeId: resolvedPath }
        )
      ]
    };
  }

  const diagnostics = candidates
    .filter((candidate) => candidate.hasPartialLayout)
    .map((candidate) =>
      buildDiagnostic(
        geminiCliDescriptor.id,
        "gemini-cli.source.partial-project-layout",
        "A discovered Gemini project directory is missing one or more expected artifact families.",
        "warning",
        "source",
        MEDIUM_CONFIDENCE,
        {
          nativeId: candidate.projectDir,
          metadata: {
            projectDir: candidate.projectDir
          }
        }
      )
    );

  return {
    ok: true,
    normalizedPath: resolvedPath,
    diagnostics,
    capabilities: geminiCliCapabilities
  };
}

export async function* discoverGeminiCliSources(
  root: SourceRootConfig,
  context: AdapterContext
): AsyncIterable<DiscoveredHarnessSource> {
  const validation = await validateGeminiCliSourceRoot(root, context);

  if (!validation.ok || !validation.normalizedPath) {
    return;
  }

  const resolvedPath = validation.normalizedPath;
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedRootPaths: [resolvedPath]
    });
  const candidates = await discoverProjectCandidates(resolvedPath, safeFilesystem);

  for (const candidate of candidates.sort((left, right) => left.projectDir.localeCompare(right.projectDir))) {
    const projectDir = candidate.projectDir;

    yield {
      id: createSourceId(geminiCliDescriptor.id, projectDir),
      adapterId: geminiCliDescriptor.id,
      nativeId: projectDir,
      rootPath: projectDir,
      displayName: path.basename(projectDir),
      confidence: HIGH_CONFIDENCE,
      metadata: {
        sourceKind: "gemini-project-directory",
        evidenceCount: candidate.evidenceCount
      }
    };
  }
}

export async function* discoverGeminiCliArtifacts(
  source: DiscoveredHarnessSource,
  context: AdapterContext
): AsyncIterable<RawArtifactRef> {
  const safeFilesystem =
    context.safeFilesystem ??
    createSafeFilesystem({
      allowedRootPaths: [source.rootPath]
    });
  const rootEntries = await listDirectoryEntries(source.rootPath, safeFilesystem);

  const projectRootPath = path.join(source.rootPath, ".project_root");
  if (rootEntries.has(".project_root")) {
    const stat = await safeFilesystem.statPath(projectRootPath);
    yield buildArtifact(source, {
      nativeId: ".project_root",
      path: projectRootPath,
      artifactType: GEMINI_PROJECT_ROOT_ARTIFACT_TYPE,
      mediaType: "text/plain",
      stat
    });
  }

  const logsPath = path.join(source.rootPath, "logs.json");
  if (rootEntries.has("logs.json")) {
    const stat = await safeFilesystem.statPath(logsPath);
    yield buildArtifact(source, {
      nativeId: "logs.json",
      path: logsPath,
      artifactType: GEMINI_LOGS_ARTIFACT_TYPE,
      mediaType: "application/json",
      stat
    });
  }

  const chatsPath = path.join(source.rootPath, "chats");
  if (rootEntries.has("chats")) {
    const chatEntries = await safeFilesystem.listDirectory(chatsPath);
    const chatFiles = chatEntries
      .filter((entry) => entry.kind === "file" && CHAT_FILENAME_PATTERN.test(path.basename(entry.path)))
      .sort((left, right) => left.path.localeCompare(right.path));

    for (const chatFile of chatFiles) {
      yield buildArtifact(source, {
        nativeId: path.posix.join("chats", path.basename(chatFile.path)),
        path: chatFile.path,
        artifactType: GEMINI_CHAT_ARTIFACT_TYPE,
        mediaType: "application/x-ndjson",
        stat: chatFile
      });
    }
  }

  const toolOutputsPath = path.join(source.rootPath, "tool-outputs");
  if (!rootEntries.has("tool-outputs")) {
    return;
  }

  const toolOutputEntries = await safeFilesystem.listDirectory(toolOutputsPath);
  const sessionDirectories = toolOutputEntries
    .filter(
      (entry) =>
        entry.kind === "directory" &&
        TOOL_OUTPUT_SESSION_DIR_PATTERN.test(path.basename(entry.path))
    )
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const sessionDirectory of sessionDirectories) {
    const sessionEntries = await safeFilesystem.listDirectory(sessionDirectory.path);
    const files = sessionEntries
      .filter(
        (entry) =>
          entry.kind === "file" && !IGNORED_ENTRY_NAMES.has(path.basename(entry.path))
      )
      .sort((left, right) => left.path.localeCompare(right.path));

    for (const file of files) {
      const relativePath = path.relative(source.rootPath, file.path).split(path.sep).join(path.posix.sep);

      yield buildArtifact(source, {
        nativeId: relativePath,
        path: file.path,
        artifactType: GEMINI_TOOL_OUTPUT_ARTIFACT_TYPE,
        mediaType: path.extname(file.path).toLowerCase() === ".json" ? "application/json" : "text/plain",
        stat: file
      });
    }
  }
}

function buildArtifact(
  source: DiscoveredHarnessSource,
  input: {
    artifactType: string;
    mediaType?: string;
    nativeId: string;
    path: string;
    stat: {
      byteLength?: number;
      inode?: number;
      mtimeMs: number;
    };
  }
): RawArtifactRef {
  return {
    id: createRawArtifactId({
      adapterId: source.adapterId,
      sourceId: source.id,
      nativeId: input.nativeId
    }),
    adapterId: source.adapterId,
    sourceId: source.id,
    nativeRef: input.nativeId,
    nativeId: input.nativeId,
    path: input.path,
    artifactKind: toArtifactKind(input.artifactType),
    parseStrategy: toParseStrategy(input.artifactType, input.mediaType),
    artifactType: input.artifactType,
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
    ...(input.stat.byteLength !== undefined ? { sizeBytes: input.stat.byteLength } : {}),
    ...(input.stat.byteLength !== undefined ? { byteLength: input.stat.byteLength } : {}),
    ...(input.stat.inode !== undefined ? { inode: String(input.stat.inode) } : {}),
    mtime: new Date(input.stat.mtimeMs).toISOString(),
    mtimeMs: input.stat.mtimeMs
  };
}

async function discoverProjectCandidates(
  resolvedRoot: string,
  safeFilesystem: NonNullable<AdapterContext["safeFilesystem"]>
): Promise<ProjectCandidate[]> {
  const rootEntries = await safeFilesystem.listDirectory(resolvedRoot);
  const directories = rootEntries
    .filter((entry) => entry.kind === "directory" && !IGNORED_ENTRY_NAMES.has(path.basename(entry.path)))
    .sort((left, right) => left.path.localeCompare(right.path));
  const candidates: ProjectCandidate[] = [];

  for (const entry of directories) {
    const evidence = await inspectProjectDirectory(entry.path, safeFilesystem);

    if (evidence.evidenceCount > 0) {
      candidates.push(evidence);
    }
  }

  return candidates;
}

async function inspectProjectDirectory(
  projectDir: string,
  safeFilesystem: NonNullable<AdapterContext["safeFilesystem"]>
): Promise<ProjectCandidate> {
  const entries = await listDirectoryEntries(projectDir, safeFilesystem);
  let evidenceCount = 0;

  if (entries.has(".project_root")) {
    evidenceCount += 1;
  }

  if (entries.has("logs.json")) {
    evidenceCount += 1;
  }

  let hasChatTranscript = false;
  if (entries.has("chats")) {
    const chats = await safeFilesystem.listDirectory(path.join(projectDir, "chats"));
    hasChatTranscript = chats.some(
      (entry) => entry.kind === "file" && CHAT_FILENAME_PATTERN.test(path.basename(entry.path))
    );
    if (hasChatTranscript) {
      evidenceCount += 1;
    }
  }

  let hasToolOutputs = false;
  if (entries.has("tool-outputs")) {
    const toolOutputEntries = await safeFilesystem.listDirectory(path.join(projectDir, "tool-outputs"));
    hasToolOutputs = toolOutputEntries.some(
      (entry) =>
        entry.kind === "directory" &&
        TOOL_OUTPUT_SESSION_DIR_PATTERN.test(path.basename(entry.path))
    );
    if (hasToolOutputs) {
      evidenceCount += 1;
    }
  }

  return {
    projectDir,
    evidenceCount,
    hasPartialLayout: evidenceCount > 0 && evidenceCount < 4
  };
}

async function listDirectoryEntries(
  targetPath: string,
  safeFilesystem: NonNullable<AdapterContext["safeFilesystem"]>
): Promise<Map<string, Awaited<ReturnType<typeof safeFilesystem.statPath>>>> {
  const entries = await safeFilesystem.listDirectory(targetPath);

  return new Map(entries.map((entry) => [path.basename(entry.path), entry] as const));
}
