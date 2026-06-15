/**
 * Main-process IPC handler registry.
 *
 * Every handler is type-checked against `IpcContract`. Add new channels here
 * after declaring them in `src/shared/ipc-contract.ts`.
 */

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  IpcChannel,
  IpcEvent,
  type IpcChannelValue,
  type IpcEventPayloads,
  type IpcEventValue,
  type IpcRequest,
  type IpcResponse,
} from '../shared/ipc-contract.js';
import { type HotkeyActionValue } from '../shared/settings-schema.js';
import { getAudioOrchestrator } from './audio/audio-orchestrator.js';
import { getHotkeyManager } from './hotkeys/hotkey-manager.js';
import { getOverlayManager, type OverlayEvent } from './overlay/overlay-window.js';
import { getSettingsStore } from './settings/store.js';

type Handler<C extends IpcChannelValue> = (
  event: IpcMainInvokeEvent,
  payload: IpcRequest<C>,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

function handle<C extends IpcChannelValue>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, handler);
}

/** Broadcast a typed event to every renderer process. */
export function broadcastEvent<E extends IpcEventValue>(channel: E, payload: IpcEventPayloads[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function registerIpcHandlers(): void {
  /* ---------------- App ---------------- */
  handle(IpcChannel.AppGetVersion, () => ({ version: app.getVersion() }));
  handle(IpcChannel.AppGetPlatform, () => ({
    platform: process.platform,
    arch: process.arch,
  }));
  handle(IpcChannel.AppPing, (_event, payload) => ({
    reply: `pong: ${payload.message}`,
    timestamp: Date.now(),
  }));

  /* ---------------- Settings ---------------- */
  handle(IpcChannel.SettingsGet, () => getSettingsStore().get());

  handle(IpcChannel.SettingsUpdateOverlay, (_event, patch) => {
    const overlay = getSettingsStore().updateOverlay(patch);
    // Reflect the change in the live overlay window for fields that affect it.
    const om = getOverlayManager();
    if (patch.opacity !== undefined) om.setOpacity(overlay.opacity);
    if (patch.clickThrough !== undefined) om.setClickThrough(overlay.clickThrough);
    if (patch.contentProtection !== undefined) om.setContentProtection(overlay.contentProtection);
    if (patch.alwaysOnTop !== undefined) om.setAlwaysOnTop(overlay.alwaysOnTop);
    broadcastEvent(IpcEvent.SettingsChanged, getSettingsStore().get());
    return overlay;
  });

  handle(IpcChannel.SettingsUpdateHotkeys, (_event, patch) => {
    const hotkeys = getSettingsStore().updateHotkeys(patch);
    const registration = getHotkeyManager().applyAll(hotkeys);
    broadcastEvent(IpcEvent.SettingsChanged, getSettingsStore().get());
    return { hotkeys, registration };
  });

  handle(IpcChannel.SettingsReset, () => {
    const settings = getSettingsStore().reset();
    getHotkeyManager().applyAll(settings.hotkeys);
    const om = getOverlayManager();
    om.setOpacity(settings.overlay.opacity);
    om.setClickThrough(settings.overlay.clickThrough);
    om.setContentProtection(settings.overlay.contentProtection);
    om.setAlwaysOnTop(settings.overlay.alwaysOnTop);
    broadcastEvent(IpcEvent.SettingsChanged, settings);
    return settings;
  });

  /* ---------------- Overlay ---------------- */
  handle(IpcChannel.OverlayGetState, () => getOverlayManager().getState());

  handle(IpcChannel.OverlayShow, () => {
    getOverlayManager().show();
    return getOverlayManager().getState();
  });

  handle(IpcChannel.OverlayHide, () => {
    getOverlayManager().hide();
    return getOverlayManager().getState();
  });

  handle(IpcChannel.OverlayToggle, () => {
    const visible = getOverlayManager().toggle();
    return { visible, state: getOverlayManager().getState() };
  });

  handle(IpcChannel.OverlaySetOpacity, (_event, { opacity }) => {
    const next = getOverlayManager().setOpacity(opacity);
    return { opacity: next, state: getOverlayManager().getState() };
  });

  handle(IpcChannel.OverlaySetClickThrough, (_event, { enabled }) => {
    const next = getOverlayManager().setClickThrough(enabled);
    return { enabled: next, state: getOverlayManager().getState() };
  });

  handle(IpcChannel.OverlaySetContentProtection, (_event, { enabled }) => {
    const next = getOverlayManager().setContentProtection(enabled);
    return { enabled: next, state: getOverlayManager().getState() };
  });

  handle(IpcChannel.OverlaySetAlwaysOnTop, (_event, { enabled }) => {
    const next = getOverlayManager().setAlwaysOnTop(enabled);
    return { enabled: next, state: getOverlayManager().getState() };
  });

  handle(IpcChannel.OverlayCyclePosition, () => {
    const preset = getOverlayManager().cyclePosition();
    return { preset, state: getOverlayManager().getState() };
  });

  handle(IpcChannel.OverlayApplyPositionPreset, (_event, { preset }) => {
    getOverlayManager().applyPositionPreset(preset);
    return { preset, state: getOverlayManager().getState() };
  });

  /* ---------------- Hotkeys ---------------- */
  handle(IpcChannel.HotkeysGetSnapshot, () => {
    const hotkeys = getSettingsStore().getHotkeys();
    const registration: { action: HotkeyActionValue; accelerator: string; ok: boolean }[] = [];
    const live = getHotkeyManager().snapshot();
    for (const action of Object.keys(hotkeys) as HotkeyActionValue[]) {
      registration.push({
        action,
        accelerator: hotkeys[action],
        ok: live[action] === hotkeys[action],
      });
    }
    return { hotkeys, registration };
  });

  /* ---------------- Audio (Phase 2) ---------------- */
  handle(IpcChannel.AudioListSources, async () => {
    return getAudioOrchestrator().listSources();
  });

  handle(IpcChannel.AudioPrepareCapture, (_event, { source }) => {
    try {
      getAudioOrchestrator().prepareDisplayMedia(source);
      getAudioOrchestrator().markRequesting(source);
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getAudioOrchestrator().markError(message);
      return { ok: false as const, error: message };
    }
  });

  handle(IpcChannel.AudioCaptureStarted, (_event, { source, sampleRate }) => {
    return getAudioOrchestrator().markStarted(source, sampleRate);
  });

  handle(IpcChannel.AudioCaptureStopped, () => {
    return getAudioOrchestrator().markStopped();
  });

  handle(IpcChannel.AudioReportLevel, (_event, tick) => {
    getAudioOrchestrator().recordLevel(tick);
  });

  handle(IpcChannel.AudioReportSegment, (_event, segment) => {
    getAudioOrchestrator().recordSegment(segment);
    return { acknowledged: true as const };
  });

  handle(IpcChannel.AudioReportError, (_event, { message }) => {
    return getAudioOrchestrator().markError(message);
  });

  handle(IpcChannel.AudioGetState, () => getAudioOrchestrator().getState());
}

/**
 * Wire the overlay manager's internal events and the hotkey manager's trigger
 * stream into IPC broadcasts so the renderer can react.
 */
export function wireEventBroadcasts(): void {
  const om = getOverlayManager();
  om.on('event', (event: OverlayEvent) => {
    if (event.type === 'state-changed') {
      broadcastEvent(IpcEvent.OverlayStateChanged, event.state);
    }
  });

  getHotkeyManager().onTrigger((action) => {
    broadcastEvent(IpcEvent.HotkeyTriggered, { action });
  });

  getSettingsStore().onChange((next) => {
    broadcastEvent(IpcEvent.SettingsChanged, next);
  });

  const audio = getAudioOrchestrator();
  audio.on('state', (state) => {
    broadcastEvent(IpcEvent.AudioCaptureStateChanged, state);
  });
  audio.on('level', (tick) => {
    broadcastEvent(IpcEvent.AudioLevelTick, tick);
  });
  audio.on('segment', (segment) => {
    broadcastEvent(IpcEvent.AudioSegmentReady, segment);
  });
}
