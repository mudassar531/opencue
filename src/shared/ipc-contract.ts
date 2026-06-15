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

/* ---------------- Shared payload types (used by both ends) ---------------- */

import type {
  HotkeyActionValue,
  HotkeyMap,
  OpencueSettings,
  OverlayPositionValue,
  OverlaySettings,
} from './settings-schema.js';

export type {
  HotkeyActionValue,
  HotkeyMap,
  OpencueSettings,
  OverlayPositionValue,
  OverlaySettings,
};

/** Public, serializable state of the overlay window. */
export interface OverlayState {
  visible: boolean;
  opacity: number;
  clickThrough: boolean;
  contentProtection: boolean;
  alwaysOnTop: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  positionPreset: OverlayPositionValue;
}

/** Result of attempting to bind a single hotkey accelerator. */
export interface HotkeyRegistrationResult {
  action: HotkeyActionValue;
  accelerator: string;
  ok: boolean;
  error?: string;
}

/* ---------------- Invocable request/response channels ---------------- */

export const IpcChannel = {
  // App / lifecycle.
  AppGetVersion: 'app:get-version',
  AppGetPlatform: 'app:get-platform',
  AppPing: 'app:ping',

  // Settings.
  SettingsGet: 'settings:get',
  SettingsUpdateOverlay: 'settings:update-overlay',
  SettingsUpdateHotkeys: 'settings:update-hotkeys',
  SettingsReset: 'settings:reset',

  // Overlay control.
  OverlayGetState: 'overlay:get-state',
  OverlayShow: 'overlay:show',
  OverlayHide: 'overlay:hide',
  OverlayToggle: 'overlay:toggle',
  OverlaySetOpacity: 'overlay:set-opacity',
  OverlaySetClickThrough: 'overlay:set-click-through',
  OverlaySetContentProtection: 'overlay:set-content-protection',
  OverlaySetAlwaysOnTop: 'overlay:set-always-on-top',
  OverlayCyclePosition: 'overlay:cycle-position',
  OverlayApplyPositionPreset: 'overlay:apply-position-preset',

  // Hotkeys.
  HotkeysGetSnapshot: 'hotkeys:get-snapshot',
} as const;

export type IpcChannelValue = (typeof IpcChannel)[keyof typeof IpcChannel];

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

  // Settings.
  [IpcChannel.SettingsGet]: {
    request: void;
    response: OpencueSettings;
  };
  [IpcChannel.SettingsUpdateOverlay]: {
    request: Partial<OverlaySettings>;
    response: OverlaySettings;
  };
  [IpcChannel.SettingsUpdateHotkeys]: {
    request: Partial<HotkeyMap>;
    response: { hotkeys: HotkeyMap; registration: HotkeyRegistrationResult[] };
  };
  [IpcChannel.SettingsReset]: {
    request: void;
    response: OpencueSettings;
  };

  // Overlay.
  [IpcChannel.OverlayGetState]: {
    request: void;
    response: OverlayState;
  };
  [IpcChannel.OverlayShow]: {
    request: void;
    response: OverlayState;
  };
  [IpcChannel.OverlayHide]: {
    request: void;
    response: OverlayState;
  };
  [IpcChannel.OverlayToggle]: {
    request: void;
    response: { visible: boolean; state: OverlayState };
  };
  [IpcChannel.OverlaySetOpacity]: {
    request: { opacity: number };
    response: { opacity: number; state: OverlayState };
  };
  [IpcChannel.OverlaySetClickThrough]: {
    request: { enabled: boolean };
    response: { enabled: boolean; state: OverlayState };
  };
  [IpcChannel.OverlaySetContentProtection]: {
    request: { enabled: boolean };
    response: { enabled: boolean; state: OverlayState };
  };
  [IpcChannel.OverlaySetAlwaysOnTop]: {
    request: { enabled: boolean };
    response: { enabled: boolean; state: OverlayState };
  };
  [IpcChannel.OverlayCyclePosition]: {
    request: void;
    response: { preset: OverlayPositionValue; state: OverlayState };
  };
  [IpcChannel.OverlayApplyPositionPreset]: {
    request: { preset: OverlayPositionValue };
    response: { preset: OverlayPositionValue; state: OverlayState };
  };

  // Hotkeys.
  [IpcChannel.HotkeysGetSnapshot]: {
    request: void;
    response: { hotkeys: HotkeyMap; registration: HotkeyRegistrationResult[] };
  };
}

export type IpcRequest<C extends IpcChannelValue> = IpcContract[C]['request'];
export type IpcResponse<C extends IpcChannelValue> = IpcContract[C]['response'];

/* ---------------- Push events (main → renderer) ---------------- */

export const IpcEvent = {
  HotkeyTriggered: 'event:hotkey-triggered',
  OverlayStateChanged: 'event:overlay-state-changed',
  SettingsChanged: 'event:settings-changed',
} as const;

export type IpcEventValue = (typeof IpcEvent)[keyof typeof IpcEvent];

export interface IpcEventPayloads {
  [IpcEvent.HotkeyTriggered]: { action: HotkeyActionValue };
  [IpcEvent.OverlayStateChanged]: OverlayState;
  [IpcEvent.SettingsChanged]: OpencueSettings;
}

/* ---------------- Renderer-facing bridge ---------------- */

/**
 * The shape of the API exposed on `window.opencue` in the renderer.
 *
 * Add new surface area by:
 *   1. Adding a channel/event to `IpcChannel` / `IpcEvent` + payloads to `IpcContract` / `IpcEventPayloads`.
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
  settings: {
    get(): Promise<IpcResponse<typeof IpcChannel.SettingsGet>>;
    updateOverlay(
      patch: IpcRequest<typeof IpcChannel.SettingsUpdateOverlay>,
    ): Promise<IpcResponse<typeof IpcChannel.SettingsUpdateOverlay>>;
    updateHotkeys(
      patch: IpcRequest<typeof IpcChannel.SettingsUpdateHotkeys>,
    ): Promise<IpcResponse<typeof IpcChannel.SettingsUpdateHotkeys>>;
    reset(): Promise<IpcResponse<typeof IpcChannel.SettingsReset>>;
    onChanged(listener: (settings: OpencueSettings) => void): () => void;
  };
  overlay: {
    getState(): Promise<IpcResponse<typeof IpcChannel.OverlayGetState>>;
    show(): Promise<IpcResponse<typeof IpcChannel.OverlayShow>>;
    hide(): Promise<IpcResponse<typeof IpcChannel.OverlayHide>>;
    toggle(): Promise<IpcResponse<typeof IpcChannel.OverlayToggle>>;
    setOpacity(opacity: number): Promise<IpcResponse<typeof IpcChannel.OverlaySetOpacity>>;
    setClickThrough(
      enabled: boolean,
    ): Promise<IpcResponse<typeof IpcChannel.OverlaySetClickThrough>>;
    setContentProtection(
      enabled: boolean,
    ): Promise<IpcResponse<typeof IpcChannel.OverlaySetContentProtection>>;
    setAlwaysOnTop(
      enabled: boolean,
    ): Promise<IpcResponse<typeof IpcChannel.OverlaySetAlwaysOnTop>>;
    cyclePosition(): Promise<IpcResponse<typeof IpcChannel.OverlayCyclePosition>>;
    applyPositionPreset(
      preset: OverlayPositionValue,
    ): Promise<IpcResponse<typeof IpcChannel.OverlayApplyPositionPreset>>;
    onStateChanged(listener: (state: OverlayState) => void): () => void;
  };
  hotkeys: {
    getSnapshot(): Promise<IpcResponse<typeof IpcChannel.HotkeysGetSnapshot>>;
    onTriggered(listener: (action: HotkeyActionValue) => void): () => void;
  };
}
