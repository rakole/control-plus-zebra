export function getAgentWorkbenchBridge(): Window["agentWorkbench"] {
  return window.agentWorkbench;
}

export function getShellState() {
  return getAgentWorkbenchBridge().getShellState();
}

export function createArchive(request: Parameters<Window["agentWorkbench"]["createArchive"]>[0]) {
  return getAgentWorkbenchBridge().createArchive(request);
}

export function openArchive(
  request?: Parameters<Window["agentWorkbench"]["openArchive"]>[0]
) {
  return getAgentWorkbenchBridge().openArchive(request);
}

export function listHarnesses() {
  return getAgentWorkbenchBridge().listHarnesses();
}

export function getDashboardStats(
  request?: Parameters<Window["agentWorkbench"]["getDashboardStats"]>[0]
) {
  return getAgentWorkbenchBridge().getDashboardStats(request);
}

export function listProjects(
  request?: Parameters<Window["agentWorkbench"]["listProjects"]>[0]
) {
  return getAgentWorkbenchBridge().listProjects(request);
}

export function listSessions(
  request?: Parameters<Window["agentWorkbench"]["listSessions"]>[0]
) {
  return getAgentWorkbenchBridge().listSessions(request);
}

export function getSession(
  request: Parameters<Window["agentWorkbench"]["getSession"]>[0]
) {
  return getAgentWorkbenchBridge().getSession(request);
}

export function getSessionTimeline(
  request: Parameters<Window["agentWorkbench"]["getSessionTimeline"]>[0]
) {
  return getAgentWorkbenchBridge().getSessionTimeline(request);
}

export async function getSessionDetail(
  request: Parameters<Window["agentWorkbench"]["getSession"]>[0]
) {
  const [sessionResponse, timelineResponse] = await Promise.all([
    getAgentWorkbenchBridge().getSession(request),
    getAgentWorkbenchBridge().getSessionTimeline(request)
  ]);

  if (!sessionResponse.ok) {
    return sessionResponse;
  }

  if (!timelineResponse.ok) {
    return timelineResponse;
  }

  return {
    ok: true as const,
    detail:
      sessionResponse.session && timelineResponse.timeline
        ? {
            session: sessionResponse.session,
            timeline: timelineResponse.timeline,
            timelinePageInfo: timelineResponse.pageInfo
          }
        : null
  };
}

export function getRunAudit(
  request: Parameters<Window["agentWorkbench"]["getRunAudit"]>[0]
) {
  return getAgentWorkbenchBridge().getRunAudit(request);
}

export function getOutputArtifactPreview(
  request: Parameters<Window["agentWorkbench"]["getOutputArtifactPreview"]>[0]
) {
  return getAgentWorkbenchBridge().getOutputArtifactPreview(request);
}

export function loadOutputArtifact(
  request: Parameters<Window["agentWorkbench"]["loadOutputArtifact"]>[0]
) {
  return getAgentWorkbenchBridge().loadOutputArtifact(request);
}

export function listDiagnostics(
  request?: Parameters<Window["agentWorkbench"]["listDiagnostics"]>[0]
) {
  return getAgentWorkbenchBridge().listDiagnostics(request);
}
