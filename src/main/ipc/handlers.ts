import { z } from "zod";

import {
  createSessionViewModelService,
  type SessionViewModelService
} from "../app/session-view-model-service.js";
import { IPC_CHANNELS } from "./channels.js";
import {
  getSessionByIdRequestSchema,
  getSessionByIdResponseSchema,
  listSessionsRequestSchema,
  listSessionsResponseSchema,
  shellStateViewModelSchema,
  type GetSessionByIdResponse,
  type ListSessionsResponse,
  type SanitizedErrorViewModel,
  type ShellStateViewModel
} from "./view-models.js";

type IpcHandler = (event: unknown, payload?: unknown) => unknown | Promise<unknown>;
type IpcErrorResponse = { ok: false; error: SanitizedErrorViewModel };

export interface IpcMainLike {
  handle(channel: string, listener: IpcHandler): void;
}

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  service: SessionViewModelService = createSessionViewModelService()
): void {
  ipcMain.handle(IPC_CHANNELS.getShellState, async (_event, payload) => {
    const request = z.undefined().safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError();
    }

    return shellStateViewModelSchema.parse(service.getShellState()) satisfies ShellStateViewModel;
  });

  ipcMain.handle(IPC_CHANNELS.listSessions, async (_event, payload) => {
    const request = listSessionsRequestSchema.safeParse(payload ?? {});

    if (!request.success) {
      return buildInvalidRequestError();
    }

    try {
      const sessions = (await service.listSessions()).filter(
        (session) => !request.data.adapterId || session.adapterId === request.data.adapterId
      );

      return listSessionsResponseSchema.parse({
        ok: true,
        sessions
      }) satisfies ListSessionsResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies ListSessionsResponse;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSessionById, async (_event, payload) => {
    const request = getSessionByIdRequestSchema.safeParse(payload);

    if (!request.success) {
      return buildInvalidRequestError() satisfies GetSessionByIdResponse;
    }

    try {
      const session = await service.getSessionById(request.data);

      return getSessionByIdResponseSchema.parse({
        ok: true,
        session
      }) satisfies GetSessionByIdResponse;
    } catch {
      return buildSessionLoadFailedError() satisfies GetSessionByIdResponse;
    }
  });
}

function buildInvalidRequestError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "invalid-request",
      message: "Request payload is not valid for this operation."
    }
  };
}

function buildSessionLoadFailedError(): IpcErrorResponse {
  return {
    ok: false,
    error: {
      code: "session-load-failed",
      message: "Session data could not be loaded."
    }
  };
}
