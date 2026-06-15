/**
 * Main-process IPC handler registry.
 *
 * Every handler is type-checked against `IpcContract`. Add new channels here
 * after declaring them in `src/shared/ipc-contract.ts`.
 */

import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  IpcChannel,
  type IpcChannelValue,
  type IpcRequest,
  type IpcResponse,
} from '../shared/ipc-contract.js';

type Handler<C extends IpcChannelValue> = (
  event: IpcMainInvokeEvent,
  payload: IpcRequest<C>,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

function handle<C extends IpcChannelValue>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, handler);
}

export function registerIpcHandlers(): void {
  handle(IpcChannel.AppGetVersion, () => ({ version: app.getVersion() }));

  handle(IpcChannel.AppGetPlatform, () => ({
    platform: process.platform,
    arch: process.arch,
  }));

  handle(IpcChannel.AppPing, (_event, payload) => ({
    reply: `pong: ${payload.message}`,
    timestamp: Date.now(),
  }));
}
