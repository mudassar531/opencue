/**
 * Persistent settings store for opencue.
 *
 * - Public preferences (overlay state, hotkeys) live in plain JSON via
 *   `electron-store`, namespaced under the app's user-data directory.
 * - Secrets (API keys, added in Phase 3) live in a separate file and are
 *   encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on
 *   Windows, libsecret on Linux). Phase 1 only scaffolds the API; no
 *   secrets are stored yet.
 *
 * The renderer NEVER reads or writes these files directly — it goes through
 * the typed IPC handlers in `src/main/ipc.ts`.
 */

import { app, safeStorage } from 'electron';
import Store from 'electron-store';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_HOTKEYS,
  DEFAULT_OVERLAY_SETTINGS,
  DEFAULT_SETTINGS,
  HotkeyAction,
  type HotkeyMap,
  type OnboardingSettings,
  type OpencueSettings,
  type OverlaySettings,
  type ProviderSelection,
  SETTINGS_SCHEMA_VERSION,
  clampOpacity,
  isPlausibleAccelerator,
} from '../../shared/settings-schema.js';

type Listener<T> = (next: T, previous: T) => void;

/** Merges a partial overlay patch onto the current value, validating fields. */
function mergeOverlay(current: OverlaySettings, patch: Partial<OverlaySettings>): OverlaySettings {
  const next: OverlaySettings = { ...current, ...patch };
  if (patch.opacity !== undefined) {
    next.opacity = clampOpacity(patch.opacity);
  }
  if (patch.size) {
    next.size = {
      width: Math.max(1, Math.floor(patch.size.width)),
      height: Math.max(1, Math.floor(patch.size.height)),
    };
  }
  if (patch.position) {
    next.position = {
      x: Math.floor(patch.position.x),
      y: Math.floor(patch.position.y),
    };
  }
  return next;
}

/** Merges a partial hotkey patch, rejecting empty / malformed accelerators. */
function mergeHotkeys(current: HotkeyMap, patch: Partial<HotkeyMap>): HotkeyMap {
  const next: HotkeyMap = { ...current };
  for (const [action, accelerator] of Object.entries(patch)) {
    if (typeof accelerator === 'string' && isPlausibleAccelerator(accelerator)) {
      next[action as keyof HotkeyMap] = accelerator;
    }
  }
  // Guarantee every action remains bound; backfill from defaults on accidental clearing.
  for (const action of Object.values(HotkeyAction)) {
    if (!next[action] || next[action].length === 0) {
      next[action] = DEFAULT_HOTKEYS[action];
    }
  }
  return next;
}

/**
 * Migration runner. Whenever `SETTINGS_SCHEMA_VERSION` is bumped, add a
 * `case` here that transforms the previous-version object into the new one.
 */
function migrate(raw: unknown): OpencueSettings {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_SETTINGS);
  const candidate = raw as Partial<OpencueSettings> & { schemaVersion?: number };
  const version = candidate.schemaVersion ?? 0;

  // v1 → v2: introduce providers section.
  if (version === 1) {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      overlay: { ...DEFAULT_OVERLAY_SETTINGS, ...candidate.overlay },
      hotkeys: { ...DEFAULT_HOTKEYS, ...candidate.hotkeys },
      providers: structuredClone(DEFAULT_SETTINGS.providers),
      onboarding: { completed: false, completedAt: null },
    };
  }

  // v2 → v3: introduce onboarding section.
  if (version === 2) {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      overlay: { ...DEFAULT_OVERLAY_SETTINGS, ...candidate.overlay },
      hotkeys: { ...DEFAULT_HOTKEYS, ...candidate.hotkeys },
      providers: {
        ...structuredClone(DEFAULT_SETTINGS.providers),
        ...(candidate.providers ?? {}),
      },
      onboarding: { completed: false, completedAt: null },
    };
  }

  if (version !== SETTINGS_SCHEMA_VERSION) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    overlay: { ...DEFAULT_OVERLAY_SETTINGS, ...candidate.overlay },
    hotkeys: { ...DEFAULT_HOTKEYS, ...candidate.hotkeys },
    providers: {
      ...structuredClone(DEFAULT_SETTINGS.providers),
      ...(candidate.providers ?? {}),
      stt: { ...DEFAULT_SETTINGS.providers.stt, ...(candidate.providers?.stt ?? {}) },
      llm: { ...DEFAULT_SETTINGS.providers.llm, ...(candidate.providers?.llm ?? {}) },
      tts: { ...DEFAULT_SETTINGS.providers.tts, ...(candidate.providers?.tts ?? {}) },
    },
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...(candidate.onboarding ?? {}) },
  };
}

export class SettingsStore {
  // electron-store's generic typing across major versions is brittle; we narrow
  // ourselves at every read/write boundary so the public API stays fully typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly store: Store<any>;
  private readonly emitter = new EventEmitter();
  private current: OpencueSettings;

  constructor(options: { name?: string; cwd?: string } = {}) {
    this.store = new Store({
      name: options.name ?? 'opencue-settings',
      cwd: options.cwd,
      defaults: DEFAULT_SETTINGS,
    });
    this.current = migrate(this.store.store);
    // Persist any migration result so subsequent launches read the fresh shape.
    this.writeAll(this.current);
  }

  /** Returns a deep copy of the current settings so callers can't mutate state. */
  get(): OpencueSettings {
    return structuredClone(this.current);
  }

  getOverlay(): OverlaySettings {
    return structuredClone(this.current.overlay);
  }

  getHotkeys(): HotkeyMap {
    return { ...this.current.hotkeys };
  }

  updateOverlay(patch: Partial<OverlaySettings>): OverlaySettings {
    const previous = this.current;
    const overlay = mergeOverlay(previous.overlay, patch);
    this.current = { ...previous, overlay };
    this.store.set('overlay', overlay);
    this.emitter.emit('changed', this.current, previous);
    return structuredClone(overlay);
  }

  updateHotkeys(patch: Partial<HotkeyMap>): HotkeyMap {
    const previous = this.current;
    const hotkeys = mergeHotkeys(previous.hotkeys, patch);
    this.current = { ...previous, hotkeys };
    this.store.set('hotkeys', hotkeys);
    this.emitter.emit('changed', this.current, previous);
    return { ...hotkeys };
  }

  getProviders(): ProviderSelection {
    return structuredClone(this.current.providers);
  }

  getOnboarding(): OnboardingSettings {
    return { ...this.current.onboarding };
  }

  markOnboardingComplete(): OnboardingSettings {
    const previous = this.current;
    const onboarding: OnboardingSettings = { completed: true, completedAt: Date.now() };
    this.current = { ...previous, onboarding };
    this.store.set('onboarding', onboarding);
    this.emitter.emit('changed', this.current, previous);
    return { ...onboarding };
  }

  updateProviders(patch: DeepPartial<ProviderSelection>): ProviderSelection {
    const previous = this.current;
    const providers: ProviderSelection = {
      ...previous.providers,
      assistSystemPrompt:
        typeof patch.assistSystemPrompt === 'string'
          ? patch.assistSystemPrompt
          : previous.providers.assistSystemPrompt,
      stt: { ...previous.providers.stt, ...(patch.stt ?? {}) },
      llm: clampLlm({ ...previous.providers.llm, ...(patch.llm ?? {}) }),
      tts: { ...previous.providers.tts, ...(patch.tts ?? {}) },
    };
    this.current = { ...previous, providers };
    this.store.set('providers', providers);
    this.emitter.emit('changed', this.current, previous);
    return structuredClone(providers);
  }

  reset(): OpencueSettings {
    const previous = this.current;
    this.current = structuredClone(DEFAULT_SETTINGS);
    this.writeAll(this.current);
    this.emitter.emit('changed', this.current, previous);
    return structuredClone(this.current);
  }

  onChange(listener: Listener<OpencueSettings>): () => void {
    this.emitter.on('changed', listener);
    return () => this.emitter.off('changed', listener);
  }

  /** Persist every top-level key. Avoids electron-store's brittle whole-object overload. */
  private writeAll(settings: OpencueSettings): void {
    this.store.set('schemaVersion', settings.schemaVersion);
    this.store.set('overlay', settings.overlay);
    this.store.set('hotkeys', settings.hotkeys);
    this.store.set('providers', settings.providers);
    this.store.set('onboarding', settings.onboarding);
  }
}

/** Deep-partial used for the providers patch shape (one-level deep). */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};

function clampLlm(llm: ProviderSelection['llm']): ProviderSelection['llm'] {
  return {
    ...llm,
    temperature: Math.max(0, Math.min(2, llm.temperature)),
    maxOutputTokens: Math.max(16, Math.min(8192, Math.floor(llm.maxOutputTokens))),
  };
}

/**
 * Secret-storage wrapper using Electron `safeStorage`.
 *
 * Phase 1 scaffolds this API; secrets are persisted starting in Phase 3.
 * On systems where encryption is not available (uncommon headless Linux),
 * `set` returns `false` and the caller is expected to surface the error
 * to the user rather than silently storing plaintext.
 */
export class SecretStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly store: Store<any>;

  constructor(options: { name?: string; cwd?: string } = {}) {
    this.store = new Store({
      name: options.name ?? 'opencue-secrets',
      cwd: options.cwd,
      defaults: {},
    });
  }

  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  set(key: string, value: string): boolean {
    if (!this.isAvailable()) return false;
    const buffer = safeStorage.encryptString(value);
    this.store.set(key, buffer.toString('base64'));
    return true;
  }

  get(key: string): string | undefined {
    if (!this.isAvailable()) return undefined;
    const raw = this.store.get(key);
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      return undefined;
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): string[] {
    return Object.keys(this.store.store as Record<string, unknown>);
  }
}

/* ------------------------------------------------------------------------- */
/*  Singleton accessors — initialized lazily after `app.whenReady()`.        */
/* ------------------------------------------------------------------------- */

let _settings: SettingsStore | null = null;
let _secrets: SecretStore | null = null;

export function getSettingsStore(): SettingsStore {
  if (_settings) return _settings;
  const cwd = app.isReady() ? app.getPath('userData') : undefined;
  _settings = new SettingsStore({ cwd });
  return _settings;
}

export function getSecretStore(): SecretStore {
  if (_secrets) return _secrets;
  const cwd = app.isReady() ? app.getPath('userData') : undefined;
  _secrets = new SecretStore({ cwd });
  return _secrets;
}

/** Test-only reset. */
export function _resetSingletonsForTests(): void {
  _settings = null;
  _secrets = null;
}
