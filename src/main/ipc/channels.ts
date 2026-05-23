export const IPC_CHANNELS = {
  getShellState: "app:getShellState",
  listSessions: "sessions:list",
  getSessionById: "sessions:getById",
  listDataSources: "dataSources:list",
  addDataSource: "dataSources:add",
  updateDataSource: "dataSources:update",
  setDataSourceEnabled: "dataSources:setEnabled",
  validateDataSource: "dataSources:validate",
  scanDataSource: "dataSources:scan"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ALLOWED_IPC_CHANNELS = [
  IPC_CHANNELS.getShellState,
  IPC_CHANNELS.listSessions,
  IPC_CHANNELS.getSessionById,
  IPC_CHANNELS.listDataSources,
  IPC_CHANNELS.addDataSource,
  IPC_CHANNELS.updateDataSource,
  IPC_CHANNELS.setDataSourceEnabled,
  IPC_CHANNELS.validateDataSource,
  IPC_CHANNELS.scanDataSource
] as const satisfies readonly IpcChannel[];
