import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { OutputArtifact } from "../core/model/entities.js";
import type { SourceRecord } from "../core/registry/source-registry.js";
import {
  createSafeFilesystem,
  isPathWithinDirectory,
  SafeFilesystemError
} from "../core/security/index.js";
import type { RawArtifactIndexEntry } from "../core/ingestion/raw-artifact-index.js";
import {
  outputArtifactRequestSchema,
  type OutputArtifactLoadResult,
  type OutputArtifactPreviewResult,
  type OutputArtifactRequest,
  type TimelineEventViewModel
} from "../ipc/view-models.js";
import {
  buildTimelineEventsFromStore,
  createSessionDetailViewModelService,
  type SessionDetailViewModelService
} from "./session-detail-view-model-service.js";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
  type WorkbenchRuntimeOptions
} from "./workbench-runtime.js";
import {
  collectAllSessionTimelineRecords,
  findStoreSessionLocation
} from "./store-session-query.js";

const OUTPUT_ARTIFACT_PREVIEW_CHAR_LIMIT = 4_096;
const OUTPUT_ARTIFACT_LOAD_BYTE_LIMIT = 1_048_576;
type OutputArtifactFailureResult = Extract<
  OutputArtifactPreviewResult,
  { status: "missing" | "unavailable" | "unsupported" | "unreadable" }
>;

interface OutputArtifactResolution {
  artifact: OutputArtifact;
  entry?: RawArtifactIndexEntry | undefined;
  source?: SourceRecord | undefined;
  timelineEntry: TimelineEventViewModel | null;
}

export interface OutputArtifactViewModelService {
  getPreview(request: OutputArtifactRequest): Promise<OutputArtifactPreviewResult>;
  loadArtifact(request: OutputArtifactRequest): Promise<OutputArtifactLoadResult>;
}

export interface OutputArtifactViewModelServiceOptions extends WorkbenchRuntimeOptions {
  runtime?: WorkbenchRuntime;
  sessionDetailService?: SessionDetailViewModelService;
}

export function createOutputArtifactViewModelService(
  options: OutputArtifactViewModelServiceOptions = {}
): OutputArtifactViewModelService {
  const runtime = options.runtime ?? createWorkbenchRuntime(options);
  const sessionDetailService =
    options.sessionDetailService ?? createSessionDetailViewModelService({ runtime });

  return {
    async getPreview(request) {
      const parsed = outputArtifactRequestSchema.parse(request);
      const resolved = await resolveOutputArtifact(runtime, sessionDetailService, parsed);

      if ("status" in resolved) {
        return resolved;
      }

      if (!supportsTextContent(resolved.artifact, resolved.entry)) {
        return buildFailureResult("unsupported", parsed, resolved.timelineEntry, {
          contentKind: resolved.artifact.contentKind,
          mediaType: resolved.artifact.mediaType ?? resolved.entry?.mediaType,
          reason: "This output artifact does not expose previewable text content."
        });
      }

      if (resolved.artifact.preview) {
        const previewText = truncateText(
          redactArtifactText(resolved.artifact.preview),
          OUTPUT_ARTIFACT_PREVIEW_CHAR_LIMIT
        );

        return {
          status: "preview-ready",
          outputArtifactId: parsed.outputArtifactId,
          contentKind: resolved.artifact.contentKind ?? "unknown",
          ...(resolved.artifact.mediaType ?? resolved.entry?.mediaType
            ? { mediaType: resolved.artifact.mediaType ?? resolved.entry?.mediaType }
            : {}),
          text: previewText.text,
          truncated: previewText.truncated,
          timelineEntry: resolved.timelineEntry
        };
      }

      const prepared = await prepareIndexedTextArtifact(resolved);
      if ("status" in prepared) {
        return buildFailureResult(prepared.status, parsed, resolved.timelineEntry, {
          contentKind: resolved.artifact.contentKind,
          mediaType: resolved.artifact.mediaType ?? resolved.entry?.mediaType,
          reason: prepared.reason
        });
      }

      const previewText = truncateText(prepared.text, OUTPUT_ARTIFACT_PREVIEW_CHAR_LIMIT);

      return {
        status: "preview-ready",
        outputArtifactId: parsed.outputArtifactId,
        contentKind: resolved.artifact.contentKind ?? "unknown",
        ...(prepared.mediaType ? { mediaType: prepared.mediaType } : {}),
        text: previewText.text,
        truncated: previewText.truncated,
        ...(prepared.byteLength !== undefined ? { byteLength: prepared.byteLength } : {}),
        timelineEntry: resolved.timelineEntry
      };
    },

    async loadArtifact(request) {
      const parsed = outputArtifactRequestSchema.parse(request);
      const resolved = await resolveOutputArtifact(runtime, sessionDetailService, parsed);

      if ("status" in resolved) {
        return resolved;
      }

      if (!supportsTextContent(resolved.artifact, resolved.entry)) {
        return buildFailureResult("unsupported", parsed, resolved.timelineEntry, {
          contentKind: resolved.artifact.contentKind,
          mediaType: resolved.artifact.mediaType ?? resolved.entry?.mediaType,
          reason: "This output artifact does not expose loadable text content."
        });
      }

      const prepared = await prepareIndexedTextArtifact(resolved);
      if ("status" in prepared) {
        return buildFailureResult(prepared.status, parsed, resolved.timelineEntry, {
          contentKind: resolved.artifact.contentKind,
          mediaType: resolved.artifact.mediaType ?? resolved.entry?.mediaType,
          reason: prepared.reason
        });
      }

      return {
        status: "loaded",
        outputArtifactId: parsed.outputArtifactId,
        contentKind: resolved.artifact.contentKind ?? "unknown",
        ...(prepared.mediaType ? { mediaType: prepared.mediaType } : {}),
        text: prepared.text,
        ...(prepared.byteLength !== undefined ? { byteLength: prepared.byteLength } : {}),
        timelineEntry: resolved.timelineEntry
      };
    }
  };
}

async function resolveOutputArtifact(
  runtime: WorkbenchRuntime,
  _sessionDetailService: SessionDetailViewModelService,
  request: OutputArtifactRequest
): Promise<
  OutputArtifactResolution
  | OutputArtifactFailureResult
> {
  const location = await findStoreSessionLocation(runtime, request.sessionId);

  if (!location) {
    return buildFailureResult("missing", request, null, {
      reason: "The requested session is not available."
    });
  }

  const degradedState = (await runtime.getEntityStoreHydrationState()).sourceStates.find(
    (state) => state.sourceId === location.source.sourceId && state.status === "cache-fallback"
  );

  if (degradedState) {
    return buildFailureResult("unavailable", request, null, {
      reason:
        degradedState.reason ??
        "This source is temporarily degraded while entity-store hydration retries."
    });
  }

  let matchingRecord = await resolveOutputArtifactTimelineRecord(
    runtime,
    location.source.sourceId,
    request.sessionId,
    request.outputArtifactId
  );
  const artifact = await runtime.entityStore.getOutputArtifact({
    sourceId: location.source.sourceId,
    outputArtifactId: request.outputArtifactId
  });

  const timelineEntry =
    matchingRecord
      ? buildTimelineEventsFromStore([matchingRecord]).find(
          (event) =>
            event.id === request.outputArtifactId && event.kind === "output-artifact"
        ) ?? null
      : null;

  if (!artifact) {
    return buildFailureResult("missing", request, timelineEntry, {
      reason: "The requested output artifact is not present for this session."
    });
  }

  const rawMetadata = await resolveRawArtifactMetadata(
    runtime,
    location.source.sourceId,
    request.outputArtifactId,
    artifact
  );
  const artifactBelongsToSession =
    artifact.sessionId === request.sessionId ||
    (location.session.outputArtifactIds ?? []).includes(request.outputArtifactId) ||
    rawMetadata?.sessionId === request.sessionId;

  if (!matchingRecord && !artifactBelongsToSession) {
    return buildFailureResult("missing", request, null, {
      reason: "The requested output artifact is not present for this session."
    });
  }

  if (artifact.sessionId && artifact.sessionId !== request.sessionId) {
    return buildFailureResult("missing", request, timelineEntry, {
      reason: "The requested output artifact is not present for this session."
    });
  }

  if (location.session.capabilities?.tools.sidecarOutputs === false) {
    return buildFailureResult("unsupported", request, timelineEntry, {
      contentKind: artifact.contentKind,
      mediaType: artifact.mediaType,
      reason: "This harness session does not support output artifact loading."
    });
  }

  const sourceRecord =
    (await runtime.sourceRegistry.getSource(location.source.sourceId)) ?? location.source;

  if (rawMetadata?.sessionId && rawMetadata.sessionId !== request.sessionId) {
    return buildFailureResult("missing", request, timelineEntry, {
      contentKind: artifact.contentKind,
      mediaType: artifact.mediaType,
      reason: "The requested output artifact is not present for this session."
    });
  }

  const entry = rawMetadata?.entry;

  return {
    artifact,
    ...(entry ? { entry } : {}),
    ...(sourceRecord ? { source: sourceRecord } : {}),
    timelineEntry
  };
}

async function resolveOutputArtifactTimelineRecord(
  runtime: WorkbenchRuntime,
  sourceId: string,
  sessionId: string,
  outputArtifactId: string
) {
  if (runtime.entityStore.getOutputArtifactTimelineRecord) {
    return runtime.entityStore.getOutputArtifactTimelineRecord({
      sourceId,
      sessionId,
      outputArtifactId
    });
  }

  return resolveOutputArtifactTimelineRecordFromSessionTimeline(
    runtime,
    sourceId,
    sessionId,
    outputArtifactId
  );
}

async function resolveOutputArtifactTimelineRecordFromSessionTimeline(
  runtime: WorkbenchRuntime,
  sourceId: string,
  sessionId: string,
  outputArtifactId: string
) {
  const records = await collectAllSessionTimelineRecords(runtime, sourceId, sessionId);

  return records.find((record) =>
    (record.outputArtifacts ?? []).some((artifact) => artifact.id === outputArtifactId)
  );
}

async function resolveRawArtifactMetadata(
  runtime: WorkbenchRuntime,
  sourceId: string,
  outputArtifactId: string,
  artifact: OutputArtifact
) {
  const metadataByOutputArtifactId =
    await runtime.entityStore.getRawArtifactMetadataByOutputArtifactId?.({
      sourceId,
      outputArtifactId
    });

  if (metadataByOutputArtifactId) {
    return metadataByOutputArtifactId;
  }

  const rawArtifactId =
    (artifact.source as { rawArtifactId?: string; artifactId?: string } | undefined)?.rawArtifactId ??
    (artifact.source as { rawArtifactId?: string; artifactId?: string } | undefined)?.artifactId ??
    artifact.ref?.id;

  return rawArtifactId
    ? runtime.entityStore.getRawArtifactMetadata({
        sourceId,
        artifactId: rawArtifactId
      })
    : undefined;
}

async function prepareIndexedTextArtifact(
  resolution: OutputArtifactResolution
): Promise<
  | { status: "missing" | "unavailable" | "unreadable"; reason: string }
  | { text: string; mediaType?: string; byteLength?: number }
> {
  const { artifact, entry, source } = resolution;

  if (!source) {
    return {
      status: "unavailable",
      reason: "The source root for this output artifact is no longer registered."
    };
  }

  if (!entry?.path) {
    return {
      status: "unavailable",
      reason: "The raw artifact index does not contain a durable file path for this output artifact."
    };
  }

  if (!(await pathExists(entry.path))) {
    return {
      status: "missing",
      reason: "The indexed output artifact file no longer exists."
    };
  }

  if (!(await isResolvedPathWithinRoot(entry.path, source.rootPath))) {
    return {
      status: "unreadable",
      reason: "The indexed output artifact resolves outside the allowed source root."
    };
  }

  const safeFilesystem = createSafeFilesystem({
    allowedArtifacts: [{ artifactId: entry.id, path: entry.path }],
    allowedRootPaths: [source.rootPath]
  });

  try {
    const fileStat = await safeFilesystem.statPath(entry.path);
    const byteLength =
      fileStat.byteLength ?? entry.sizeBytes ?? entry.byteLength;

    if (byteLength !== undefined && byteLength > OUTPUT_ARTIFACT_LOAD_BYTE_LIMIT) {
      return {
        status: "unavailable",
        reason: `The output artifact exceeds the ${OUTPUT_ARTIFACT_LOAD_BYTE_LIMIT}-byte safety limit.`
      };
    }

    const rawText = await safeFilesystem.readIndexedTextArtifact(entry.id, entry.path);
    return {
      text: redactArtifactText(normalizeArtifactText(artifact, rawText)),
      ...(artifact.mediaType ?? entry.mediaType
        ? { mediaType: artifact.mediaType ?? entry.mediaType }
        : {}),
      ...(byteLength !== undefined ? { byteLength } : {})
    };
  } catch (error) {
    return classifyArtifactReadFailure(error);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    return true;
  }
}

function resolveRawArtifactIndexEntry(
  entries: RawArtifactIndexEntry[],
  artifact: OutputArtifact,
  source?: SourceRecord
): RawArtifactIndexEntry | undefined {
  const artifactPointerIds = [
    artifact.source?.rawArtifactId,
    artifact.source?.artifactId
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const pointerId of artifactPointerIds) {
    const directMatch = entries.find(
      (entry) => entry.id === pointerId && entry.artifactKind === "output-artifact"
    );

    if (directMatch) {
      return directMatch;
    }
  }

  const artifactRef = artifact.nativeRef ?? artifact.nativeId ?? artifact.path;
  const absoluteArtifactPath =
    artifact.path && source
      ? toAbsoluteArtifactPath(source.rootPath, artifact.path)
      : undefined;

  return entries.find((entry) => {
    if (entry.adapterId !== artifact.adapterId || entry.sourceId !== artifact.sourceId) {
      return false;
    }

    if (entry.artifactKind !== "output-artifact") {
      return false;
    }

    if (artifactRef && (entry.nativeRef === artifactRef || entry.nativeId === artifactRef)) {
      return true;
    }

    if (absoluteArtifactPath && entry.path && path.resolve(entry.path) === absoluteArtifactPath) {
      return true;
    }

    if (
      artifact.path &&
      entry.path &&
      path.normalize(entry.path).endsWith(path.normalize(artifact.path))
    ) {
      return true;
    }

    return false;
  });
}

function normalizeArtifactText(artifact: OutputArtifact, rawText: string): string {
  if (artifact.contentKind !== "json-output-wrapper") {
    return rawText;
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;

    for (const key of ["content", "output", "text", "result"] as const) {
      const value = parsed[key];

      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  } catch {
    return rawText;
  }

  return rawText;
}

function redactArtifactText(value: string): string {
  return value
    .replace(
      /\b(sk-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,})\b/gu,
      "[REDACTED]"
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/giu, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|apiKey|access[_-]?token|accessToken|auth[_-]?token|authToken|session[_-]?token|sessionToken|client[_-]?secret|clientSecret|secret|password|token)\s*[:=]\s*["']?)([^\s"',}\]]+)/giu,
      "$1[REDACTED]"
    );
}

function supportsTextContent(
  artifact: OutputArtifact,
  entry?: RawArtifactIndexEntry
): boolean {
  if (artifact.contentKind === "binary") {
    return false;
  }

  if (
    artifact.contentKind === "plain-text" ||
    artifact.contentKind === "json" ||
    artifact.contentKind === "json-output-wrapper"
  ) {
    return true;
  }

  const mediaType = artifact.mediaType ?? entry?.mediaType;

  if (!mediaType) {
    return false;
  }

  return mediaType.startsWith("text/") || mediaType === "application/json";
}

function truncateText(
  value: string,
  limit: number
): { text: string; truncated: boolean } {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false
    };
  }

  return {
    text: `${value.slice(0, limit - 1)}...`,
    truncated: true
  };
}

function buildFailureResult(
  status: "missing" | "unavailable" | "unsupported" | "unreadable",
  request: OutputArtifactRequest,
  timelineEntry: TimelineEventViewModel | null,
  input: {
    reason: string;
    contentKind?: OutputArtifact["contentKind"];
    mediaType?: string | undefined;
  }
): OutputArtifactFailureResult {
  return {
    status,
    outputArtifactId: request.outputArtifactId,
    ...(input.contentKind ? { contentKind: input.contentKind } : {}),
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
    reason: input.reason,
    timelineEntry
  };
}

async function isResolvedPathWithinRoot(
  targetPath: string,
  rootPath: string
): Promise<boolean> {
  const [resolvedTargetPath, resolvedRootPath] = await Promise.all([
    toResolvedPath(targetPath),
    toResolvedPath(rootPath)
  ]);

  return isPathWithinDirectory(resolvedRootPath, resolvedTargetPath);
}

async function toResolvedPath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);

  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

function toAbsoluteArtifactPath(rootPath: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(rootPath, artifactPath);
}

function classifyArtifactReadFailure(
  error: unknown
): { status: "missing" | "unreadable"; reason: string } {
  if (isMissingFileError(error)) {
    return {
      status: "missing",
      reason: "The indexed output artifact file no longer exists."
    };
  }

  if (error instanceof SafeFilesystemError) {
    return {
      status: "unreadable",
      reason: error.message
    };
  }

  if (error instanceof Error) {
    return {
      status: "unreadable",
      reason: error.message
    };
  }

  return {
    status: "unreadable",
    reason: "The output artifact could not be read safely."
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
