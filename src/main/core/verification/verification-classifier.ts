import {
  HIGH_CONFIDENCE,
  LOW_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  type ConfidenceScore
} from "../model/confidence.js";
import type { CapabilityEnvelope } from "../model/capabilities.js";
import type { Session, SessionMessage } from "../model/entities.js";
import type { ParsedShellCommand, ShellCommandIntent } from "../shell/types.js";

import type {
  VerificationIntent,
  VerificationIntentResult,
  VerificationReasonCode,
  VerificationResult,
  VerificationStatus
} from "./types.js";

const verificationIntents = new Set<VerificationIntent>(["test", "build", "typecheck", "lint"]);

export function deriveVerificationForSession(args: {
  adapterCapabilities: CapabilityEnvelope;
  parsedShellCommands: ParsedShellCommand[];
  session: Session;
  sessionCapabilities?: CapabilityEnvelope;
  sessionMessages: SessionMessage[];
  sourceCapabilities?: CapabilityEnvelope;
}): VerificationResult {
  const qualifyingCommands = args.parsedShellCommands.filter((shellCommand) =>
    isVerificationIntent(shellCommand.intent)
  );

  if (qualifyingCommands.length === 0) {
    const shellCapability = resolveShellCapabilityState(args);

    if (shellCapability.status === "unsupported") {
      return {
        status: "unsupported",
        confidence: HIGH_CONFIDENCE,
        commandIds: [],
        intentResults: [],
        reasonCodes: ["capability-unsupported"]
      };
    }

    if (shellCapability.status === "unknown") {
      return {
        status: "unknown",
        confidence: MEDIUM_CONFIDENCE,
        commandIds: [],
        intentResults: [],
        reasonCodes: ["capability-unknown"]
      };
    }

    if (hasTerminalAssistantResponse(args.session, args.sessionMessages)) {
      return {
        status: "not-run",
        confidence: HIGH_CONFIDENCE,
        commandIds: [],
        intentResults: [],
        reasonCodes: ["no-qualifying-commands"]
      };
    }

    return {
      status: "unknown",
      confidence: LOW_CONFIDENCE,
      commandIds: [],
      intentResults: [],
      reasonCodes: ["no-qualifying-commands"]
    };
  }

  const intentBuckets = new Map<VerificationIntent, ParsedShellCommand[]>();

  for (const shellCommand of qualifyingCommands) {
    if (!isVerificationIntent(shellCommand.intent)) {
      continue;
    }

    const intent = shellCommand.intent;
    const bucket = intentBuckets.get(intent) ?? [];

    bucket.push(shellCommand);
    intentBuckets.set(intent, bucket);
  }

  const intentResults = [...intentBuckets.entries()].map(([intent, commands]) =>
    deriveIntentResult(intent, commands)
  );
  const latestStatuses = intentResults.map((result) => result.latestStatus);
  const reasonCodes = collectReasonCodes(qualifyingCommands);
  const diagnosticIds = dedupeStrings(
    intentResults.flatMap((result) => result.diagnosticIds ?? [])
  );

  let status: VerificationStatus;

  if (latestStatuses.includes("failed")) {
    status = "failed";
  } else if (latestStatuses.every((latestStatus) => latestStatus === "passed")) {
    status = "passed";
  } else {
    status = "unknown";
  }

  return {
    status,
    confidence: deriveVerificationConfidence(status, reasonCodes, intentResults),
    commandIds: qualifyingCommands.map((command) => command.shellCommandId),
    intentResults,
    reasonCodes,
    ...(diagnosticIds.length > 0 ? { diagnosticIds } : {})
  };
}

export function hasTerminalAssistantResponse(
  session: Session,
  sessionMessages: SessionMessage[]
): boolean {
  if (session.lifecycleStatus !== "completed") {
    return false;
  }

  const orderedMessages = sessionMessages
    .filter((message) => message.sessionId === session.id)
    .sort(compareMessagesForVerification);
  const lastMessage = orderedMessages.at(-1);

  return lastMessage?.role === "assistant" && (lastMessage.text ?? "").trim().length > 0;
}

function deriveIntentResult(
  intent: VerificationIntent,
  commands: ParsedShellCommand[]
): VerificationIntentResult {
  const latest = commands.at(-1);

  if (!latest) {
    throw new Error(`Expected at least one command for verification intent '${intent}'.`);
  }

  return {
    intent,
    latestCommandId: latest.shellCommandId,
    latestStatus: deriveVerificationIntentStatus(latest),
    commandIds: commands.map((command) => command.shellCommandId),
    confidence: latest.confidence,
    ...(latest.diagnosticIds?.length ? { diagnosticIds: latest.diagnosticIds } : {})
  };
}

function resolveShellCapabilityState(args: {
  adapterCapabilities: CapabilityEnvelope;
  sessionCapabilities?: CapabilityEnvelope;
  sourceCapabilities?: CapabilityEnvelope;
}) {
  return (
    toCapabilityState(args.sessionCapabilities?.capabilities.tools?.shellCommands) ??
    toCapabilityState(args.sourceCapabilities?.capabilities.tools?.shellCommands) ??
    toCapabilityState(args.adapterCapabilities.capabilities.tools?.shellCommands) ??
    { status: "unknown" as const }
  );
}

function toCapabilityState(value: boolean | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return { status: value ? "supported" : "unsupported" } as const;
}

function collectReasonCodes(
  commands: ParsedShellCommand[]
): VerificationReasonCode[] {
  const codes = new Set<VerificationReasonCode>();

  for (const command of commands) {
    if (command.outputTextSource === "missing") {
      codes.add("output-missing");
    }

    if ((command.diagnosticIds?.length ?? 0) > 0) {
      codes.add("parser-warning");
    }
  }

  return [...codes];
}

function deriveVerificationConfidence(
  status: VerificationStatus,
  reasonCodes: VerificationReasonCode[],
  intentResults: VerificationIntentResult[]
): ConfidenceScore {
  if (status === "unsupported" || status === "not-run") {
    return HIGH_CONFIDENCE;
  }

  if (status === "unknown") {
    return LOW_CONFIDENCE;
  }

  if (reasonCodes.length > 0 || intentResults.some((result) => result.confidence.level !== "high")) {
    return MEDIUM_CONFIDENCE;
  }

  return HIGH_CONFIDENCE;
}

function isVerificationIntent(intent: ShellCommandIntent): intent is VerificationIntent {
  return verificationIntents.has(intent as VerificationIntent);
}

function deriveVerificationIntentStatus(
  command: ParsedShellCommand
): VerificationIntentResult["latestStatus"] {
  if (command.result === "failed") {
    return "failed";
  }

  if (command.result === "passed" && hasExplicitSuccessfulShellOutcome(command)) {
    return "passed";
  }

  return "unknown";
}

function compareMessagesForVerification(left: SessionMessage, right: SessionMessage): number {
  const leftTimestamp = left.timestamp ?? "";
  const rightTimestamp = right.timestamp ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }

  const leftEventId = left.eventIds?.[0] ?? "";
  const rightEventId = right.eventIds?.[0] ?? "";

  if (leftEventId !== rightEventId) {
    return leftEventId.localeCompare(rightEventId);
  }

  return left.id.localeCompare(right.id);
}

function hasExplicitSuccessfulShellOutcome(command: ParsedShellCommand): boolean {
  return command.exitCode === 0;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
