import { contextBridge } from "electron";

import type { AgentWorkbenchBridge } from "./types.js";

const agentWorkbench: AgentWorkbenchBridge = Object.freeze({});

contextBridge.exposeInMainWorld("agentWorkbench", agentWorkbench);
