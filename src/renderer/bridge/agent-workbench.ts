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

export function getOverview(
  request?: Parameters<Window["agentWorkbench"]["getOverview"]>[0]
) {
  return getAgentWorkbenchBridge().getOverview(request);
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

export function getSessionById(
  request: Parameters<Window["agentWorkbench"]["getSessionById"]>[0]
) {
  return getAgentWorkbenchBridge().getSessionById(request);
}

export function getSessionDetail(
  request: Parameters<Window["agentWorkbench"]["getSessionDetail"]>[0]
) {
  return getAgentWorkbenchBridge().getSessionDetail(request);
}

export function getRunAudit(
  request: Parameters<Window["agentWorkbench"]["getRunAudit"]>[0]
) {
  return getAgentWorkbenchBridge().getRunAudit(request);
}

export function listDiagnostics(
  request?: Parameters<Window["agentWorkbench"]["listDiagnostics"]>[0]
) {
  return getAgentWorkbenchBridge().listDiagnostics(request);
}
