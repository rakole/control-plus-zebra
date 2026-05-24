import {
  createArchive,
  getRunAudit,
  getSessionById,
  getSessionDetail,
  listSessions
} from "../../bridge/agent-workbench.js";

export type CreateArchiveResponse = Awaited<ReturnType<typeof createArchive>>;
export type ListSessionsResponse = Awaited<ReturnType<typeof listSessions>>;
export type SessionSummary = Extract<ListSessionsResponse, { ok: true }>["sessions"][number];

export type GetSessionByIdResponse = Awaited<ReturnType<typeof getSessionById>>;
export type SessionPreviewView = NonNullable<
  Extract<GetSessionByIdResponse, { ok: true }>["session"]
>;

export type SessionCapability = SessionPreviewView["capabilityBadges"][number];

export type GetSessionDetailResponse = Awaited<ReturnType<typeof getSessionDetail>>;
export type SessionDetailView = NonNullable<
  Extract<GetSessionDetailResponse, { ok: true }>["detail"]
>;
export type SessionTimelineEvent = SessionDetailView["timeline"][number];

export type GetRunAuditResponse = Awaited<ReturnType<typeof getRunAudit>>;
export type RunAuditView = NonNullable<
  Extract<GetRunAuditResponse, { ok: true }>["runAudit"]
>;
export type RunAuditSection = RunAuditView["sections"][number];
