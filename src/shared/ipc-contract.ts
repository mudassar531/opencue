/**
 * Shared typed IPC contract for opencue.
 *
 * Single source of truth for every cross-process call between the renderer
 * and the main process. The preload script translates these channels into
 * a typed `window.opencue` API via `contextBridge`.
 *
 * NEVER use ad-hoc string channels with `ipcRenderer` elsewhere — add them
 * here first, then expose them through `src/preload/index.ts`.
 */

/** All IPC channel names. */
export const IpcChannel = {
  // System / lifecycle (Phase 0 — placeholders only; expanded in later phases).
  AppGetVersion: 'app:get-version',
  AppGetPlatform: 'app:get-platform',
  AppPing: 'app:ping',
} as const;

export type IpcChannelValue = (typeof IpcChannel)[keyof typeof IpcChannel];

/** Request/response payload shapes for each channel. */
export interface IpcContract {
  [IpcChannel.AppGetVersion]: {
    request: void;
    response: { version: string };
  };
  [IpcChannel.AppGetPlatform]: {
    request: void;
    response: { platform: NodeJS.Platform; arch: string };
  };
  [IpcChannel.AppPing]: {
    request: { message: string };
    response: { reply: string; timestamp: number };
  };
}

/** Helper types extracting request/response per channel. */
export type IpcRequest<C extends IpcChannelValue> = IpcContract[C]['request'];
export type IpcResponse<C extends IpcChannelValue> = IpcContract[C]['response'];

/**
 * The shape of the API exposed on `window.opencue` in the renderer.
 *
 * Every method is fully typed. New surface area is added by:
 *   1. Adding a channel to `IpcChannel` and its payloads to `IpcContract`.
 *   2. Registering a handler in `src/main/ipc.ts`.
 *   3. Exposing it through the preload bridge in `src/preload/index.ts`.
 *   4. Adding the method here.
 */
export interface OpencueBridge {
  app: {
    getVersion(): Promise<IpcResponse<typeof IpcChannel.AppGetVersion>>;
    getPlatform(): Promise<IpcResponse<typeof IpcChannel.AppGetPlatform>>;
    ping(
      payload: IpcRequest<typeof IpcChannel.AppPing>,
    ): Promise<IpcResponse<typeof IpcChannel.AppPing>>;
  };
}
