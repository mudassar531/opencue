/**
 * Preload script — the ONLY bridge between the renderer and the main process.
 *
 * Runs with `contextIsolation: true` and `nodeIntegration: false`. We expose a
 * minimal, fully-typed surface on `window.opencue` via `contextBridge`. The
 * renderer never imports Electron or Node directly.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type IpcChannelValue,
  type IpcRequest,
  type IpcResponse,
  type OpencueBridge,
} from '../shared/ipc-contract.js';

function invoke<C extends IpcChannelValue>(
  channel: C,
  payload?: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>;
}

const bridge: OpencueBridge = {
  app: {
    getVersion: () => invoke(IpcChannel.AppGetVersion),
    getPlatform: () => invoke(IpcChannel.AppGetPlatform),
    ping: (payload) => invoke(IpcChannel.AppPing, payload),
  },
};

contextBridge.exposeInMainWorld('opencue', bridge);
