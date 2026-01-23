// Route handlers barrel export

export { handleHealth } from "./health";
export { handleIndexDocs } from "./index-docs";
export { handleRetrieve } from "./retrieve";
export { handleStatus } from "./status";
export { handleDeleteDocset, handleGetDocset } from "./docset";
export { handleListPages } from "./pages";
export { handleRefresh, handleRefreshAll } from "./refresh";
export { 
  handleRegisterSession, 
  handleUnregisterSession, 
  handleGetSessions,
  hasActiveSessions,
  getActiveSessionCount,
} from "./session";
