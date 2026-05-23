export const IPC_CHANNELS = {
  getShellState: "app:getShellState",
  listSessions: "sessions:list",
  getSessionById: "sessions:getById"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ALLOWED_IPC_CHANNELS = [
  IPC_CHANNELS.getShellState,
  IPC_CHANNELS.listSessions,
  IPC_CHANNELS.getSessionById
] as const satisfies readonly IpcChannel[];
