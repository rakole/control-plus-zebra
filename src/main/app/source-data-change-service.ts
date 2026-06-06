import { IPC_CHANNELS } from "../ipc/channels.js";
import {
  sourceDataChangedEventSchema,
  type SourceDataChangedEvent
} from "../ipc/view-models.js";

interface SourceDataWindowLike {
  webContents: {
    send(...args: unknown[]): void;
    isDestroyed?(): boolean;
  };
}

export interface SourceDataChangeService {
  notifySourceDataChanged(event: SourceDataChangedEvent): void;
  registerWindow(window: SourceDataWindowLike): void;
  unregisterWindow(window: SourceDataWindowLike): void;
}

export function createSourceDataChangeService(): SourceDataChangeService {
  const windows = new Set<SourceDataWindowLike>();

  return {
    notifySourceDataChanged(event) {
      const parsed = sourceDataChangedEventSchema.parse(event);

      for (const window of windows) {
        if (window.webContents.isDestroyed?.()) {
          windows.delete(window);
          continue;
        }

        try {
          window.webContents.send(IPC_CHANNELS.sourceDataChanged, parsed);
        } catch {
          windows.delete(window);
        }
      }
    },
    registerWindow(window) {
      windows.add(window);
    },
    unregisterWindow(window) {
      windows.delete(window);
    }
  };
}
