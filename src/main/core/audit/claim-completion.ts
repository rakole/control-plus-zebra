import type {
  Session,
  SessionEvent,
  SessionMessage
} from "../model/entities.js";

import type { CompletionClaim } from "./types.js";

const activityEventKinds = new Set<SessionEvent["kind"]>([
  "tool-call",
  "shell-command",
  "file-event"
]);

export function deriveCompletionClaim(args: {
  session: Session;
  sessionEvents: SessionEvent[];
  sessionMessages: SessionMessage[];
}): CompletionClaim {
  const orderedMessages = args.sessionMessages
    .filter((message) => message.sessionId === args.session.id)
    .sort(compareMessages);
  const lastAssistantMessage = [...orderedMessages]
    .reverse()
    .find((message) => message.role === "assistant" && (message.text ?? "").trim().length > 0);

  if (!lastAssistantMessage) {
    return {
      status: "not-claimed",
      postClaimEventIds: []
    };
  }

  const messageEvent = args.sessionEvents.find(
    (event) => lastAssistantMessage.eventIds?.includes(event.id) === true
  );
  const orderedEvents = args.sessionEvents
    .filter((event) => event.sessionId === args.session.id)
    .sort(compareEvents);

  if (!messageEvent && !lastAssistantMessage.timestamp) {
    return {
      status: "unknown",
      postClaimEventIds: []
    };
  }

  const postClaimEvents = orderedEvents.filter((event) => {
    if (!activityEventKinds.has(event.kind)) {
      return false;
    }

    if (messageEvent) {
      return compareEvents(event, messageEvent) > 0;
    }

    if (!lastAssistantMessage.timestamp || !event.timestamp) {
      return false;
    }

    return event.timestamp > lastAssistantMessage.timestamp;
  });

  return {
    status: "claimed",
    ...(lastAssistantMessage.timestamp ? { claimedAt: lastAssistantMessage.timestamp } : {}),
    messageId: lastAssistantMessage.id,
    postClaimEventIds: postClaimEvents.map((event) => event.id)
  };
}

function compareEvents(left: SessionEvent, right: SessionEvent): number {
  const leftOrder = left.orderKey ?? "";
  const rightOrder = right.orderKey ?? "";

  if (leftOrder !== rightOrder) {
    return leftOrder.localeCompare(rightOrder);
  }

  return (left.timestamp ?? "").localeCompare(right.timestamp ?? "");
}

function compareMessages(left: SessionMessage, right: SessionMessage): number {
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
