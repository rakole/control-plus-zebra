import type {
  Session,
  SessionEvent,
  SessionMessage
} from "../model/entities.js";

import type { CompletionClaim } from "./types.js";

const activityEventKinds = new Set<SessionEvent["eventKind"]>([
  "tool-call",
  "shell-command",
  "file-mutation"
]);

export function deriveCompletionClaim(args: {
  session: Session;
  sessionEvents: SessionEvent[];
  sessionMessages: SessionMessage[];
}): CompletionClaim {
  const orderedMessages = args.sessionMessages
    .filter((message) => message.sessionId === args.session.id)
    .sort((left, right) => left.ordinal - right.ordinal);
  const lastAssistantMessage = [...orderedMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0);

  if (!lastAssistantMessage) {
    return {
      status: "not-claimed",
      postClaimEventIds: []
    };
  }

  const messageEvent = args.sessionEvents.find(
    (event) => event.messageId === lastAssistantMessage.id
  );
  const orderedEvents = args.sessionEvents
    .filter((event) => event.sessionId === args.session.id)
    .sort((left, right) => left.ordinal - right.ordinal);

  if (!messageEvent && !lastAssistantMessage.timestamp) {
    return {
      status: "unknown",
      postClaimEventIds: []
    };
  }

  const postClaimEvents = orderedEvents.filter((event) => {
    if (!activityEventKinds.has(event.eventKind)) {
      return false;
    }

    if (messageEvent) {
      return event.ordinal > messageEvent.ordinal;
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
