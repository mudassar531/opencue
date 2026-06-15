/**
 * Preload script — the ONLY bridge between the renderer and the main process.
 *
 * Runs with `contextIsolation: true` and `nodeIntegration: false`. We expose a
 * minimal, fully-typed surface on `window.opencue` via `contextBridge`. The
 * renderer never imports Electron or Node directly.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannel,
  IpcEvent,
  type IpcChannelValue,
  type IpcEventPayloads,
  type IpcEventValue,
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

/** Subscribe to a push event from the main process. Returns an unsubscribe fn. */
function subscribe<E extends IpcEventValue>(
  channel: E,
  listener: (payload: IpcEventPayloads[E]) => void,
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: IpcEventPayloads[E]): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}

const bridge: OpencueBridge = {
  app: {
    getVersion: () => invoke(IpcChannel.AppGetVersion),
    getPlatform: () => invoke(IpcChannel.AppGetPlatform),
    ping: (payload) => invoke(IpcChannel.AppPing, payload),
  },
  settings: {
    get: () => invoke(IpcChannel.SettingsGet),
    updateOverlay: (patch) => invoke(IpcChannel.SettingsUpdateOverlay, patch),
    updateHotkeys: (patch) => invoke(IpcChannel.SettingsUpdateHotkeys, patch),
    reset: () => invoke(IpcChannel.SettingsReset),
    onChanged: (listener) => subscribe(IpcEvent.SettingsChanged, listener),
  },
  overlay: {
    getState: () => invoke(IpcChannel.OverlayGetState),
    show: () => invoke(IpcChannel.OverlayShow),
    hide: () => invoke(IpcChannel.OverlayHide),
    toggle: () => invoke(IpcChannel.OverlayToggle),
    setOpacity: (opacity) => invoke(IpcChannel.OverlaySetOpacity, { opacity }),
    setClickThrough: (enabled) => invoke(IpcChannel.OverlaySetClickThrough, { enabled }),
    setContentProtection: (enabled) =>
      invoke(IpcChannel.OverlaySetContentProtection, { enabled }),
    setAlwaysOnTop: (enabled) => invoke(IpcChannel.OverlaySetAlwaysOnTop, { enabled }),
    cyclePosition: () => invoke(IpcChannel.OverlayCyclePosition),
    applyPositionPreset: (preset) => invoke(IpcChannel.OverlayApplyPositionPreset, { preset }),
    onStateChanged: (listener) => subscribe(IpcEvent.OverlayStateChanged, listener),
  },
  hotkeys: {
    getSnapshot: () => invoke(IpcChannel.HotkeysGetSnapshot),
    onTriggered: (listener) =>
      subscribe(IpcEvent.HotkeyTriggered, (payload) => listener(payload.action)),
  },
};

contextBridge.exposeInMainWorld('opencue', bridge);
