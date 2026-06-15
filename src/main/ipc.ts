/**
 * Main-process IPC handler registry.
 *
 * Every handler is type-checked against `IpcContract`. Add new channels here
 * after declaring them in `src/shared/ipc-contract.ts`.
 */

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { Buffer } from 'node:buffer';
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
import { getAssistOrchestrator } from './assist/assist-orchestrator.js';
import { getAudioOrchestrator } from './audio/audio-orchestrator.js';
import { getHotkeyManager } from './hotkeys/hotkey-manager.js';
import { getModelManager } from './models/model-manager.js';
import { getOverlayManager, type OverlayEvent } from './overlay/overlay-window.js';
import { OllamaProvider } from './providers/llm/ollama.js';
import {
  deleteApiKey,
  getApiKeyPresenceMap,
  setApiKey,
} from './providers/secret-keys.js';
import { getProviderRouter } from './providers/router.js';
import { captureScreen, listScreenCaptureSources } from './screen/screen-capture.js';
import { getSecretStore, getSettingsStore } from './settings/store.js';
import { getSidecarManager } from './sidecar/sidecar-manager.js';

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

  /* ---------------- Providers + Assist (Phase 3) ---------------- */
  handle(IpcChannel.ProvidersGetCapabilities, () => getProviderRouter().listCapabilities());

  handle(IpcChannel.ProvidersGetKeyPresence, () => ({
    presence: getApiKeyPresenceMap(),
    safeStorageAvailable: getSecretStore().isAvailable(),
  }));

  handle(IpcChannel.ProvidersSetApiKey, (_event, { scope, providerId, apiKey }) => {
    const ok = setApiKey(scope, providerId, apiKey);
    broadcastEvent(IpcEvent.SettingsChanged, getSettingsStore().get());
    return { ok, safeStorageAvailable: getSecretStore().isAvailable() };
  });

  handle(IpcChannel.ProvidersDeleteApiKey, (_event, { scope, providerId }) => {
    deleteApiKey(scope, providerId);
    broadcastEvent(IpcEvent.SettingsChanged, getSettingsStore().get());
    return { ok: true as const };
  });

  handle(IpcChannel.ProvidersUpdateSelection, (_event, patch) => {
    const next = getSettingsStore().updateProviders(patch);
    broadcastEvent(IpcEvent.SettingsChanged, getSettingsStore().get());
    return next;
  });

  handle(IpcChannel.AssistGetTranscript, () => Array.from(getAssistOrchestrator().getTranscript()));
  handle(IpcChannel.AssistGetSuggestions, () =>
    Array.from(getAssistOrchestrator().getSuggestions()),
  );
  handle(IpcChannel.AssistGetStatus, () => ({
    status: getAssistOrchestrator().getStatus(),
    error: getAssistOrchestrator().getLastError(),
  }));

  handle(IpcChannel.AssistSubmitSegment, async (_event, payload) => {
    const buf = Buffer.from(payload.samplesBase64, 'base64');
    // Re-wrap as Float32Array (4 bytes per sample).
    const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const entry = await getAssistOrchestrator().submitSegmentAudio({
      segmentId: payload.segmentId,
      startedAt: payload.startedAt,
      sampleRate: payload.sampleRate,
      samples,
      ...(payload.languageHint ? { languageHint: payload.languageHint } : {}),
    });
    return { transcribed: entry !== null };
  });

  handle(IpcChannel.AssistRun, async (_event, args) => {
    const suggestion = await getAssistOrchestrator().runAssist(args);
    return { suggestionId: suggestion?.id ?? null };
  });
  handle(IpcChannel.AssistCancel, () => {
    getAssistOrchestrator().cancelInFlight();
    return { ok: true as const };
  });
  handle(IpcChannel.AssistReset, () => {
    getAssistOrchestrator().reset();
    return { ok: true as const };
  });

  /* ---------------- Local models + sidecar (Phase 4) ---------------- */
  handle(IpcChannel.ModelsListStatuses, () => getModelManager().listStatuses());
  handle(IpcChannel.ModelsDownload, async (_event, { modelId }) => {
    // Fire-and-forget — progress is reported via the `model-status-changed` event.
    void getModelManager()
      .download(modelId)
      .catch(() => undefined);
    return { ok: true as const };
  });
  handle(IpcChannel.ModelsCancelDownload, async (_event, { modelId }) => {
    await getModelManager().cancel(modelId);
    return { ok: true as const };
  });
  handle(IpcChannel.ModelsRemove, async (_event, { modelId }) => {
    await getModelManager().remove(modelId);
    return { ok: true as const };
  });
  handle(IpcChannel.SidecarGetStatus, () => getSidecarManager().getStatus());
  handle(IpcChannel.SidecarCheckInstalled, async () => {
    const scriptPath = getSidecarManager().defaultScriptPath();
    const installed = await getSidecarManager().checkScriptExists(scriptPath);
    return { installed, scriptPath };
  });
  handle(IpcChannel.SidecarStart, async () => getSidecarManager().start());
  handle(IpcChannel.SidecarStop, async () => {
    await getSidecarManager().stop();
    return { ok: true as const };
  });
  handle(IpcChannel.OllamaListModels, async () => {
    const baseUrl = process.env.OPENCUE_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    const models = await OllamaProvider.listInstalled(baseUrl);
    return { reachable: models.length > 0 || models !== undefined, models, baseUrl };
  });

  /* ---------------- Screen capture (Phase 5) ---------------- */
  handle(IpcChannel.ScreenListSources, () => listScreenCaptureSources());
  handle(IpcChannel.ScreenCapture, async (_event, args) => {
    const opts: { sourceId?: string } = {};
    if (args && typeof args.sourceId === 'string') opts.sourceId = args.sourceId;
    const result = await captureScreen(opts);
    return {
      dataUrl: result.dataUrl,
      width: result.width,
      height: result.height,
      byteSize: result.byteSize,
      source: result.source,
    };
  });
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

  const assist = getAssistOrchestrator();
  assist.on('event', (event) => {
    switch (event.type) {
      case 'status-changed':
        broadcastEvent(IpcEvent.AssistStatusChanged, {
          status: event.status,
          error: event.error,
        });
        break;
      case 'transcript-entry':
        broadcastEvent(IpcEvent.AssistTranscriptEntry, event.entry);
        break;
      case 'transcript-error':
        broadcastEvent(IpcEvent.AssistTranscriptError, {
          segmentId: event.segmentId,
          message: event.message,
        });
        break;
      case 'suggestion-started':
        broadcastEvent(IpcEvent.AssistSuggestionStarted, event.suggestion);
        break;
      case 'suggestion-delta':
        broadcastEvent(IpcEvent.AssistSuggestionDelta, {
          suggestionId: event.suggestionId,
          delta: event.delta,
          textSoFar: event.textSoFar,
        });
        break;
      case 'suggestion-completed':
        broadcastEvent(IpcEvent.AssistSuggestionCompleted, event.suggestion);
        break;
      case 'suggestion-error':
        broadcastEvent(IpcEvent.AssistSuggestionError, {
          suggestionId: event.suggestionId,
          message: event.message,
        });
        break;
      case 'tts-audio':
        broadcastEvent(IpcEvent.AssistTtsAudio, {
          suggestionId: event.suggestionId,
          mimeType: event.mimeType,
          audioBase64: Buffer.from(event.audio).toString('base64'),
        });
        break;
      case 'reset':
        broadcastEvent(IpcEvent.AssistReset, {});
        break;
    }
  });

  getModelManager().on('status', (entry) => {
    broadcastEvent(IpcEvent.ModelStatusChanged, entry);
  });

  const sidecar = getSidecarManager();
  sidecar.on('status', (status) => {
    broadcastEvent(IpcEvent.SidecarStatusChanged, status);
  });
  sidecar.on('log', (entry) => {
    broadcastEvent(IpcEvent.SidecarLog, entry);
  });
}
