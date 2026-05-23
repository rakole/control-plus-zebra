export interface AgentWorkbenchBridge {}

declare global {
  interface Window {
    agentWorkbench: AgentWorkbenchBridge;
  }
}
