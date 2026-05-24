export const IPC_CHANNELS = {
  getShellState: "app:getShellState",
  createArchive: "export:createArchive",
  openArchive: "import:openArchive",
  getOverview: "overview:get",
  listProjects: "projects:list",
  listSessions: "sessions:list",
  getSessionById: "sessions:getById",
  getSessionDetail: "sessions:getDetail",
  getRunAudit: "sessions:getRunAudit",
  listDiagnostics: "diagnostics:list",
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
  IPC_CHANNELS.createArchive,
  IPC_CHANNELS.openArchive,
  IPC_CHANNELS.getOverview,
  IPC_CHANNELS.listProjects,
  IPC_CHANNELS.listSessions,
  IPC_CHANNELS.getSessionById,
  IPC_CHANNELS.getSessionDetail,
  IPC_CHANNELS.getRunAudit,
  IPC_CHANNELS.listDiagnostics,
  IPC_CHANNELS.listDataSources,
  IPC_CHANNELS.addDataSource,
  IPC_CHANNELS.updateDataSource,
  IPC_CHANNELS.setDataSourceEnabled,
  IPC_CHANNELS.validateDataSource,
  IPC_CHANNELS.scanDataSource
] as const satisfies readonly IpcChannel[];
