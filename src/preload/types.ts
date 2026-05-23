import type {
  GetSessionByIdRequest,
  GetSessionByIdResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ShellStateViewModel
} from "../main/ipc/view-models.js";

export interface AgentWorkbenchBridge {
  getShellState(): Promise<ShellStateViewModel>;
  listSessions(request?: ListSessionsRequest): Promise<ListSessionsResponse>;
  getSessionById(request: GetSessionByIdRequest): Promise<GetSessionByIdResponse>;
}

declare global {
  interface Window {
    agentWorkbench: AgentWorkbenchBridge;
  }
}
