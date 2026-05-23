import { z } from "zod";

import type { HarnessCapabilities } from "../../core/model/capabilities.js";

const fakeCapabilityStateSchema = z.object({
  status: z.enum(["supported", "unsupported", "unknown"]),
  reason: z.string().optional(),
  details: z.string().optional()
});

export const fakeHarnessCapabilitiesSchema = z.object({
  sessionDiscovery: fakeCapabilityStateSchema,
  liveSessionObservation: fakeCapabilityStateSchema,
  eventStreaming: fakeCapabilityStateSchema,
  messageCapture: fakeCapabilityStateSchema,
  toolCallCapture: fakeCapabilityStateSchema,
  shellCommandCapture: fakeCapabilityStateSchema,
  outputArtifactCapture: fakeCapabilityStateSchema,
  fileMutationCapture: fakeCapabilityStateSchema,
  sourceValidation: fakeCapabilityStateSchema,
  watchPlans: fakeCapabilityStateSchema,
  gitContextCapture: fakeCapabilityStateSchema,
  githubContextCapture: fakeCapabilityStateSchema,
  verificationSignals: fakeCapabilityStateSchema
});

const fakeFixtureDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string()
});

const fakeParseDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  nativeId: z.string().optional()
});

const fakeArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "json", "text", "trace", "unknown"]),
  path: z.string().optional(),
  uri: z.string().optional(),
  mediaType: z.string().optional(),
  byteLength: z.number().int().nonnegative().optional()
});

const fakeFileMutationSchema = z.object({
  id: z.string(),
  path: z.string(),
  mutationKind: z.enum(["created", "updated", "deleted", "unknown"])
});

const fakeLifecycleEventSchema = z.object({
  id: z.string(),
  kind: z.literal("lifecycle"),
  timestamp: z.string(),
  state: z.enum(["active", "completed", "cancelled", "unknown"]),
  summary: z.string().optional()
});

const fakeMessageEventSchema = z.object({
  id: z.string(),
  kind: z.literal("message"),
  timestamp: z.string(),
  role: z.enum(["assistant", "system", "tool", "user"]),
  text: z.string()
});

const fakeToolCallEventSchema = z.object({
  id: z.string(),
  kind: z.literal("tool-call"),
  timestamp: z.string(),
  toolName: z.string(),
  status: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  artifactIds: z.array(z.string()).default([]),
  fileMutations: z.array(fakeFileMutationSchema).default([])
});

const fakeShellCommandEventSchema = z.object({
  id: z.string(),
  kind: z.literal("shell-command"),
  timestamp: z.string(),
  command: z.string(),
  outputSource: z.enum(["stdout", "stderr", "combined", "unknown"]),
  cwd: z.string().optional(),
  exitCode: z.number().int().optional(),
  outputSummary: z.string().optional(),
  toolCallId: z.string().optional(),
  artifactIds: z.array(z.string()).default([]),
  rawToolStatus: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]).optional()
});

const fakeOutputArtifactEventSchema = z.object({
  id: z.string(),
  kind: z.literal("output-artifact"),
  timestamp: z.string(),
  artifactId: z.string(),
  summary: z.string().optional()
});

export const fakeTimelineEventSchema = z.discriminatedUnion("kind", [
  fakeLifecycleEventSchema,
  fakeMessageEventSchema,
  fakeToolCallEventSchema,
  fakeShellCommandEventSchema,
  fakeOutputArtifactEventSchema
]);

export const fakeHarnessFixtureSchema = z.object({
  source: z.object({
    id: z.string(),
    displayName: z.string(),
    rootPath: z.string()
  }),
  project: z.object({
    id: z.string(),
    name: z.string(),
    rootPath: z.string().optional()
  }),
  session: z.object({
    id: z.string(),
    title: z.string().optional(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    lifecycleState: z.enum(["active", "completed", "cancelled", "unknown"])
  }),
  capabilities: fakeHarnessCapabilitiesSchema,
  diagnostics: z.array(fakeFixtureDiagnosticSchema).default([]),
  artifacts: z.array(fakeArtifactSchema).default([]),
  events: z.array(fakeTimelineEventSchema)
});

export type FakeHarnessCapabilities = HarnessCapabilities;
export type FakeHarnessFixture = z.infer<typeof fakeHarnessFixtureSchema>;
export type FakeTimelineEvent = z.infer<typeof fakeTimelineEventSchema>;
export type FakeFixtureArtifact = z.infer<typeof fakeArtifactSchema>;
export type FakeFileMutation = z.infer<typeof fakeFileMutationSchema>;
export type FakeParseDiagnostic = z.infer<typeof fakeParseDiagnosticSchema>;

export interface FakeFixtureMetadataPayload {
  kind: "fixture-metadata";
  fixture: FakeHarnessFixture;
}

export interface FakeParseDiagnosticPayload {
  kind: "parse-diagnostic";
  diagnostic: FakeParseDiagnostic;
}

export interface FakeTimelinePayload {
  kind: "timeline-event";
  event: FakeTimelineEvent;
}

export type FakeParsedPayload =
  | FakeFixtureMetadataPayload
  | FakeParseDiagnosticPayload
  | FakeTimelinePayload;
