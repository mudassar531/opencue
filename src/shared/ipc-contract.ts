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
  AudioCaptureState,
  AudioLevelTick,
  AudioSegment,
  AudioSource,
  AudioSourceList,
} from './audio-types.js';
import type { ModelStatus, ModelStatusEntry } from './model-registry.js';
import type {
  AssistStatus,
  AssistSuggestion,
  LlmProviderIdValue,
  ProviderSelection,
  SttProviderIdValue,
  TranscriptEntry,
  TtsProviderIdValue,
} from './provider-types.js';
import type {
  HotkeyActionValue,
  HotkeyMap,
  OpencueSettings,
  OverlayPositionValue,
  OverlaySettings,
} from './settings-schema.js';

export type {
  AssistStatus,
  AssistSuggestion,
  AudioCaptureState,
  AudioLevelTick,
  AudioSegment,
  AudioSource,
  AudioSourceList,
  HotkeyActionValue,
  HotkeyMap,
  LlmProviderIdValue,
  ModelStatus,
  ModelStatusEntry,
  OpencueSettings,
  OverlayPositionValue,
  OverlaySettings,
  ProviderSelection,
  SttProviderIdValue,
  TranscriptEntry,
  TtsProviderIdValue,
};

import type {
  SessionListEntry,
  SessionRecord,
  SessionSummary,
} from './session-types.js';

export type { SessionListEntry, SessionRecord, SessionSummary };

/** Status of the Python sidecar process. Mirrors `SidecarStatus` in main. */
export type SidecarStatus =
  | { state: 'stopped' }
  | { state: 'starting'; pid: number; startedAt: number }
  | { state: 'running'; pid: number; startedAt: number; port: number }
  | { state: 'error'; message: string };

/** Capabilities surfaced by the provider router for the settings UI. */
export interface ProviderCapabilities {
  stt: { id: SttProviderIdValue; displayName: string; models: readonly string[] }[];
  llm: { id: LlmProviderIdValue; displayName: string; models: readonly string[] }[];
  tts: {
    id: TtsProviderIdValue;
    displayName: string;
    models: readonly string[];
    voices: readonly string[];
  }[];
}

/** Renderer-friendly view of which API keys have been entered. */
export type ApiKeyPresence = Record<string, boolean>;

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

  // Audio capture (Phase 2).
  AudioListSources: 'audio:list-sources',
  AudioPrepareCapture: 'audio:prepare-capture',
  AudioCaptureStarted: 'audio:capture-started',
  AudioCaptureStopped: 'audio:capture-stopped',
  AudioReportLevel: 'audio:report-level',
  AudioReportSegment: 'audio:report-segment',
  AudioReportError: 'audio:report-error',
  AudioGetState: 'audio:get-state',

  // Providers + Assist (Phase 3).
  ProvidersGetCapabilities: 'providers:get-capabilities',
  ProvidersGetKeyPresence: 'providers:get-key-presence',
  ProvidersSetApiKey: 'providers:set-api-key',
  ProvidersDeleteApiKey: 'providers:delete-api-key',
  ProvidersUpdateSelection: 'providers:update-selection',
  AssistGetTranscript: 'assist:get-transcript',
  AssistGetSuggestions: 'assist:get-suggestions',
  AssistGetStatus: 'assist:get-status',
  AssistSubmitSegment: 'assist:submit-segment',
  AssistRun: 'assist:run',
  AssistCancel: 'assist:cancel',
  AssistReset: 'assist:reset',

  // Local models + sidecar (Phase 4).
  ModelsListStatuses: 'models:list-statuses',
  ModelsDownload: 'models:download',
  ModelsCancelDownload: 'models:cancel-download',
  ModelsRemove: 'models:remove',
  SidecarGetStatus: 'sidecar:get-status',
  SidecarCheckInstalled: 'sidecar:check-installed',
  SidecarStart: 'sidecar:start',
  SidecarStop: 'sidecar:stop',
  OllamaListModels: 'ollama:list-models',

  // Screen capture (Phase 5).
  ScreenListSources: 'screen:list-sources',
  ScreenCapture: 'screen:capture',

  // Sessions (Phase 6).
  SessionsStart: 'sessions:start',
  SessionsStop: 'sessions:stop',
  SessionsGetCurrent: 'sessions:get-current',
  SessionsList: 'sessions:list',
  SessionsLoad: 'sessions:load',
  SessionsRemove: 'sessions:remove',
  SessionsExportMarkdown: 'sessions:export-markdown',
  SessionsGenerateSummary: 'sessions:generate-summary',
  SessionsSetTitle: 'sessions:set-title',

  // Onboarding (Phase 6).
  OnboardingGet: 'onboarding:get',
  OnboardingComplete: 'onboarding:complete',
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

  /* ---------- Audio (Phase 2) ---------- */
  [IpcChannel.AudioListSources]: {
    request: void;
    response: AudioSourceList;
  };
  [IpcChannel.AudioPrepareCapture]: {
    /**
     * Tell main which source the user picked. For screen / window sources this
     * also installs the one-shot `setDisplayMediaRequestHandler` callback so
     * the renderer can immediately call `navigator.mediaDevices.getDisplayMedia`
     * and receive the chosen source.
     */
    request: { source: AudioSource };
    response: { ok: true } | { ok: false; error: string };
  };
  [IpcChannel.AudioCaptureStarted]: {
    request: { source: AudioSource; sampleRate: number };
    response: AudioCaptureState;
  };
  [IpcChannel.AudioCaptureStopped]: {
    request: void;
    response: AudioCaptureState;
  };
  [IpcChannel.AudioReportLevel]: {
    request: AudioLevelTick;
    response: void;
  };
  [IpcChannel.AudioReportSegment]: {
    request: AudioSegment;
    response: { acknowledged: true };
  };
  [IpcChannel.AudioReportError]: {
    request: { message: string };
    response: AudioCaptureState;
  };
  [IpcChannel.AudioGetState]: {
    request: void;
    response: AudioCaptureState;
  };

  /* ---------- Providers + Assist (Phase 3) ---------- */
  [IpcChannel.ProvidersGetCapabilities]: {
    request: void;
    response: ProviderCapabilities;
  };
  [IpcChannel.ProvidersGetKeyPresence]: {
    request: void;
    response: { presence: ApiKeyPresence; safeStorageAvailable: boolean };
  };
  [IpcChannel.ProvidersSetApiKey]: {
    request: { scope: 'stt' | 'llm' | 'tts'; providerId: string; apiKey: string };
    response: { ok: boolean; safeStorageAvailable: boolean };
  };
  [IpcChannel.ProvidersDeleteApiKey]: {
    request: { scope: 'stt' | 'llm' | 'tts'; providerId: string };
    response: { ok: true };
  };
  [IpcChannel.ProvidersUpdateSelection]: {
    request: Partial<ProviderSelection>;
    response: ProviderSelection;
  };
  [IpcChannel.AssistGetTranscript]: {
    request: void;
    response: TranscriptEntry[];
  };
  [IpcChannel.AssistGetSuggestions]: {
    request: void;
    response: AssistSuggestion[];
  };
  [IpcChannel.AssistGetStatus]: {
    request: void;
    response: { status: AssistStatus; error: string | null };
  };
  [IpcChannel.AssistSubmitSegment]: {
    /** Renderer sends Float32 PCM as a base64-encoded Uint8Array view. */
    request: {
      segmentId: number;
      startedAt: number;
      sampleRate: number;
      samplesBase64: string;
      languageHint?: string;
    };
    response: { transcribed: boolean };
  };
  [IpcChannel.AssistRun]: {
    request: {
      prompt?: string;
      isRecap?: boolean;
      screenshotDataUrl?: string;
      triggeredBy: 'hotkey' | 'manual' | 'auto';
    };
    response: { suggestionId: number | null };
  };
  [IpcChannel.AssistCancel]: {
    request: void;
    response: { ok: true };
  };
  [IpcChannel.AssistReset]: {
    request: void;
    response: { ok: true };
  };

  /* ---------- Local models + sidecar (Phase 4) ---------- */
  [IpcChannel.ModelsListStatuses]: {
    request: void;
    response: ModelStatusEntry[];
  };
  [IpcChannel.ModelsDownload]: {
    request: { modelId: string };
    response: { ok: true };
  };
  [IpcChannel.ModelsCancelDownload]: {
    request: { modelId: string };
    response: { ok: true };
  };
  [IpcChannel.ModelsRemove]: {
    request: { modelId: string };
    response: { ok: true };
  };
  [IpcChannel.SidecarGetStatus]: {
    request: void;
    response: SidecarStatus;
  };
  [IpcChannel.SidecarCheckInstalled]: {
    request: void;
    response: { installed: boolean; scriptPath: string };
  };
  [IpcChannel.SidecarStart]: {
    request: void;
    response: SidecarStatus;
  };
  [IpcChannel.SidecarStop]: {
    request: void;
    response: { ok: true };
  };
  [IpcChannel.OllamaListModels]: {
    request: void;
    response: { reachable: boolean; models: string[]; baseUrl: string };
  };

  /* ---------- Screen capture (Phase 5) ---------- */
  [IpcChannel.ScreenListSources]: {
    request: void;
    response: { id: string; label: string; kind: 'screen' | 'window' }[];
  };
  [IpcChannel.ScreenCapture]: {
    request: { sourceId?: string };
    response: {
      dataUrl: string;
      width: number;
      height: number;
      byteSize: number;
      source: { id: string; label: string; kind: 'screen' | 'window' };
    };
  };

  /* ---------- Sessions (Phase 6) ---------- */
  [IpcChannel.SessionsStart]: {
    request: { title?: string; sourceLabel?: string | null };
    response: SessionRecord;
  };
  [IpcChannel.SessionsStop]: {
    request: void;
    response: SessionRecord | null;
  };
  [IpcChannel.SessionsGetCurrent]: {
    request: void;
    response: SessionRecord | null;
  };
  [IpcChannel.SessionsList]: {
    request: void;
    response: SessionListEntry[];
  };
  [IpcChannel.SessionsLoad]: {
    request: { id: string };
    response: SessionRecord | null;
  };
  [IpcChannel.SessionsRemove]: {
    request: { id: string };
    response: { ok: boolean };
  };
  [IpcChannel.SessionsExportMarkdown]: {
    request: { id: string };
    response: { filename: string; markdown: string } | null;
  };
  [IpcChannel.SessionsGenerateSummary]: {
    request: { id: string };
    response: SessionSummary | null;
  };
  [IpcChannel.SessionsSetTitle]: {
    request: { title: string };
    response: SessionRecord | null;
  };

  /* ---------- Onboarding (Phase 6) ---------- */
  [IpcChannel.OnboardingGet]: {
    request: void;
    response: { completed: boolean; completedAt: number | null };
  };
  [IpcChannel.OnboardingComplete]: {
    request: void;
    response: { completed: true; completedAt: number };
  };
}

export type IpcRequest<C extends IpcChannelValue> = IpcContract[C]['request'];
export type IpcResponse<C extends IpcChannelValue> = IpcContract[C]['response'];

/* ---------------- Push events (main → renderer) ---------------- */

export const IpcEvent = {
  HotkeyTriggered: 'event:hotkey-triggered',
  OverlayStateChanged: 'event:overlay-state-changed',
  SettingsChanged: 'event:settings-changed',
  AudioCaptureStateChanged: 'event:audio-capture-state-changed',
  AudioLevelTick: 'event:audio-level-tick',
  AudioSegmentReady: 'event:audio-segment-ready',
  AssistStatusChanged: 'event:assist-status-changed',
  AssistTranscriptEntry: 'event:assist-transcript-entry',
  AssistTranscriptError: 'event:assist-transcript-error',
  AssistSuggestionStarted: 'event:assist-suggestion-started',
  AssistSuggestionDelta: 'event:assist-suggestion-delta',
  AssistSuggestionCompleted: 'event:assist-suggestion-completed',
  AssistSuggestionError: 'event:assist-suggestion-error',
  AssistTtsAudio: 'event:assist-tts-audio',
  AssistReset: 'event:assist-reset',
  ModelStatusChanged: 'event:model-status-changed',
  SidecarStatusChanged: 'event:sidecar-status-changed',
  SidecarLog: 'event:sidecar-log',
  SessionChanged: 'event:session-changed',
} as const;

export type IpcEventValue = (typeof IpcEvent)[keyof typeof IpcEvent];

export interface IpcEventPayloads {
  [IpcEvent.HotkeyTriggered]: { action: HotkeyActionValue };
  [IpcEvent.OverlayStateChanged]: OverlayState;
  [IpcEvent.SettingsChanged]: OpencueSettings;
  [IpcEvent.AudioCaptureStateChanged]: AudioCaptureState;
  [IpcEvent.AudioLevelTick]: AudioLevelTick;
  [IpcEvent.AudioSegmentReady]: AudioSegment;
  [IpcEvent.AssistStatusChanged]: { status: AssistStatus; error: string | null };
  [IpcEvent.AssistTranscriptEntry]: TranscriptEntry;
  [IpcEvent.AssistTranscriptError]: { segmentId: number; message: string };
  [IpcEvent.AssistSuggestionStarted]: AssistSuggestion;
  [IpcEvent.AssistSuggestionDelta]: { suggestionId: number; delta: string; textSoFar: string };
  [IpcEvent.AssistSuggestionCompleted]: AssistSuggestion;
  [IpcEvent.AssistSuggestionError]: { suggestionId: number; message: string };
  [IpcEvent.AssistTtsAudio]: { suggestionId: number; mimeType: string; audioBase64: string };
  [IpcEvent.AssistReset]: Record<string, never>;
  [IpcEvent.ModelStatusChanged]: ModelStatusEntry;
  [IpcEvent.SidecarStatusChanged]: SidecarStatus;
  [IpcEvent.SidecarLog]: { stream: 'stdout' | 'stderr'; text: string };
  [IpcEvent.SessionChanged]: SessionRecord | null;
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
  audio: {
    listSources(): Promise<IpcResponse<typeof IpcChannel.AudioListSources>>;
    prepareCapture(
      source: AudioSource,
    ): Promise<IpcResponse<typeof IpcChannel.AudioPrepareCapture>>;
    captureStarted(
      source: AudioSource,
      sampleRate: number,
    ): Promise<IpcResponse<typeof IpcChannel.AudioCaptureStarted>>;
    captureStopped(): Promise<IpcResponse<typeof IpcChannel.AudioCaptureStopped>>;
    reportLevel(tick: AudioLevelTick): Promise<void>;
    reportSegment(
      segment: AudioSegment,
    ): Promise<IpcResponse<typeof IpcChannel.AudioReportSegment>>;
    reportError(message: string): Promise<IpcResponse<typeof IpcChannel.AudioReportError>>;
    getState(): Promise<IpcResponse<typeof IpcChannel.AudioGetState>>;
    onStateChanged(listener: (state: AudioCaptureState) => void): () => void;
    onLevelTick(listener: (tick: AudioLevelTick) => void): () => void;
    onSegmentReady(listener: (segment: AudioSegment) => void): () => void;
  };
  providers: {
    getCapabilities(): Promise<IpcResponse<typeof IpcChannel.ProvidersGetCapabilities>>;
    getKeyPresence(): Promise<IpcResponse<typeof IpcChannel.ProvidersGetKeyPresence>>;
    setApiKey(
      scope: 'stt' | 'llm' | 'tts',
      providerId: string,
      apiKey: string,
    ): Promise<IpcResponse<typeof IpcChannel.ProvidersSetApiKey>>;
    deleteApiKey(
      scope: 'stt' | 'llm' | 'tts',
      providerId: string,
    ): Promise<IpcResponse<typeof IpcChannel.ProvidersDeleteApiKey>>;
    updateSelection(
      patch: Partial<ProviderSelection>,
    ): Promise<IpcResponse<typeof IpcChannel.ProvidersUpdateSelection>>;
  };
  assist: {
    getTranscript(): Promise<IpcResponse<typeof IpcChannel.AssistGetTranscript>>;
    getSuggestions(): Promise<IpcResponse<typeof IpcChannel.AssistGetSuggestions>>;
    getStatus(): Promise<IpcResponse<typeof IpcChannel.AssistGetStatus>>;
    /** Renderer submits raw Float32 PCM as a base64 string (Uint8Array view). */
    submitSegment(args: {
      segmentId: number;
      startedAt: number;
      sampleRate: number;
      samplesBase64: string;
      languageHint?: string;
    }): Promise<IpcResponse<typeof IpcChannel.AssistSubmitSegment>>;
    run(args: {
      prompt?: string;
      isRecap?: boolean;
      screenshotDataUrl?: string;
      triggeredBy: 'hotkey' | 'manual' | 'auto';
    }): Promise<IpcResponse<typeof IpcChannel.AssistRun>>;
    cancel(): Promise<IpcResponse<typeof IpcChannel.AssistCancel>>;
    reset(): Promise<IpcResponse<typeof IpcChannel.AssistReset>>;
    onStatusChanged(
      listener: (status: AssistStatus, error: string | null) => void,
    ): () => void;
    onTranscriptEntry(listener: (entry: TranscriptEntry) => void): () => void;
    onSuggestionStarted(listener: (suggestion: AssistSuggestion) => void): () => void;
    onSuggestionDelta(
      listener: (suggestionId: number, delta: string, textSoFar: string) => void,
    ): () => void;
    onSuggestionCompleted(listener: (suggestion: AssistSuggestion) => void): () => void;
    onSuggestionError(listener: (suggestionId: number, message: string) => void): () => void;
    onTtsAudio(
      listener: (args: { suggestionId: number; mimeType: string; audioBase64: string }) => void,
    ): () => void;
    onReset(listener: () => void): () => void;
  };
  models: {
    listStatuses(): Promise<IpcResponse<typeof IpcChannel.ModelsListStatuses>>;
    download(modelId: string): Promise<IpcResponse<typeof IpcChannel.ModelsDownload>>;
    cancelDownload(
      modelId: string,
    ): Promise<IpcResponse<typeof IpcChannel.ModelsCancelDownload>>;
    remove(modelId: string): Promise<IpcResponse<typeof IpcChannel.ModelsRemove>>;
    onStatusChanged(listener: (entry: ModelStatusEntry) => void): () => void;
  };
  sidecar: {
    getStatus(): Promise<IpcResponse<typeof IpcChannel.SidecarGetStatus>>;
    checkInstalled(): Promise<IpcResponse<typeof IpcChannel.SidecarCheckInstalled>>;
    start(): Promise<IpcResponse<typeof IpcChannel.SidecarStart>>;
    stop(): Promise<IpcResponse<typeof IpcChannel.SidecarStop>>;
    onStatusChanged(listener: (status: SidecarStatus) => void): () => void;
    onLog(listener: (entry: { stream: 'stdout' | 'stderr'; text: string }) => void): () => void;
  };
  ollama: {
    listModels(): Promise<IpcResponse<typeof IpcChannel.OllamaListModels>>;
  };
  screen: {
    listSources(): Promise<IpcResponse<typeof IpcChannel.ScreenListSources>>;
    capture(
      args?: { sourceId?: string },
    ): Promise<IpcResponse<typeof IpcChannel.ScreenCapture>>;
  };
  sessions: {
    start(args?: {
      title?: string;
      sourceLabel?: string | null;
    }): Promise<IpcResponse<typeof IpcChannel.SessionsStart>>;
    stop(): Promise<IpcResponse<typeof IpcChannel.SessionsStop>>;
    getCurrent(): Promise<IpcResponse<typeof IpcChannel.SessionsGetCurrent>>;
    list(): Promise<IpcResponse<typeof IpcChannel.SessionsList>>;
    load(id: string): Promise<IpcResponse<typeof IpcChannel.SessionsLoad>>;
    remove(id: string): Promise<IpcResponse<typeof IpcChannel.SessionsRemove>>;
    exportMarkdown(id: string): Promise<IpcResponse<typeof IpcChannel.SessionsExportMarkdown>>;
    generateSummary(id: string): Promise<IpcResponse<typeof IpcChannel.SessionsGenerateSummary>>;
    setTitle(title: string): Promise<IpcResponse<typeof IpcChannel.SessionsSetTitle>>;
    onChanged(listener: (session: SessionRecord | null) => void): () => void;
  };
  onboarding: {
    get(): Promise<IpcResponse<typeof IpcChannel.OnboardingGet>>;
    complete(): Promise<IpcResponse<typeof IpcChannel.OnboardingComplete>>;
  };
}
