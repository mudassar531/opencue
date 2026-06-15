/**
 * Main-process audio orchestrator (Phase 2).
 *
 * The renderer owns the actual capture (Web Audio + getUserMedia + Silero VAD)
 * because the relevant APIs live in the page context. The main process is
 * responsible for:
 *
 *   - Enumerating system sources via `desktopCapturer`.
 *   - Installing a one-shot `setDisplayMediaRequestHandler` so the renderer
 *     can ask for a specific screen / window via `getDisplayMedia`.
 *   - Tracking the canonical capture state (idle / requesting / active / error)
 *     and broadcasting it on `IpcEvent.AudioCaptureStateChanged`.
 *   - Forwarding live level ticks and finalized speech segments to subscribers
 *     (later phases hand segments to STT or persist them to a session).
 *
 * The orchestrator deliberately does NOT touch raw PCM in main; we keep the
 * audio buffers in-renderer to avoid copying every frame across the IPC bridge.
 * Only segment metadata is shipped over IPC; bulk audio stays in the renderer
 * until a downstream consumer (Phase 3 STT) needs it.
 */

import { desktopCapturer, session, systemPreferences, type Session } from 'electron';
import { EventEmitter } from 'node:events';
import {
  AudioCaptureStatus,
  type AudioCaptureState,
  type AudioLevelTick,
  type AudioSegment,
  type AudioSource,
  type AudioSourceList,
  AudioSourceKind,
} from '../../shared/audio-types.js';

/** Per-OS check — does the platform support system-audio loopback at all? */
export function loopbackSupported(platform: NodeJS.Platform = process.platform): boolean {
  switch (platform) {
    case 'win32':
      // Chromium captures WASAPI loopback when a screen/window source is picked.
      return true;
    case 'darwin':
      // ScreenCaptureKit (macOS 13+) — Electron 28+ exposes system audio with
      // the desktop source path. We assume support and surface the OS-level
      // permission prompt at capture time if missing.
      return true;
    case 'linux':
      // Loopback works on PipeWire / PulseAudio via the monitor source which
      // appears in `enumerateDevices('audioinput')`. The desktop-capture audio
      // path is not reliable on Linux, so we report `false` and the picker
      // hides screen/window options; the user picks the "Monitor of X" device.
      return false;
    default:
      return false;
  }
}

function defaultState(): AudioCaptureState {
  return {
    status: AudioCaptureStatus.Idle,
    source: null,
    error: null,
    sampleRate: 0,
    segmentsEmitted: 0,
    startedAt: null,
  };
}

export class AudioOrchestrator extends EventEmitter {
  private state: AudioCaptureState = defaultState();

  getState(): AudioCaptureState {
    return { ...this.state };
  }

  /**
   * On macOS, both system-audio loopback and `desktopCapturer.getSources`
   * require the user to grant Screen & System Audio Recording. We report
   * the current state so the UI can show a clear permission CTA instead
   * of a bare 'Failed to get sources' error.
   */
  getMediaAccessStatus(): {
    screen: 'granted' | 'denied' | 'unknown' | 'not-applicable';
    microphone: 'granted' | 'denied' | 'unknown' | 'not-applicable';
  } {
    if (process.platform !== 'darwin') {
      return { screen: 'not-applicable', microphone: 'not-applicable' };
    }
    return {
      screen: mapDarwinStatus(systemPreferences.getMediaAccessStatus('screen')),
      microphone: mapDarwinStatus(systemPreferences.getMediaAccessStatus('microphone')),
    };
  }

  /**
   * Enumerate desktopCapturer screen + window sources. Microphone enumeration
   * happens in the renderer (via `navigator.mediaDevices.enumerateDevices`)
   * because device labels are only populated after a permission grant.
   *
   * Returns `null` when the underlying call throws (e.g., macOS screen-
   * recording permission not granted). Callers convert this into a UI hint.
   */
  async listDesktopSources(): Promise<{
    screens: AudioSource[];
    windows: AudioSource[];
  } | null> {
    let sources: Electron.DesktopCapturerSource[];
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 256, height: 144 },
        fetchWindowIcons: false,
      });
    } catch {
      return null;
    }
    const screens: AudioSource[] = [];
    const windows: AudioSource[] = [];
    for (const src of sources) {
      const thumbnail = src.thumbnail.isEmpty() ? undefined : src.thumbnail.toDataURL();
      const out: AudioSource = {
        kind: src.id.startsWith('screen:') ? AudioSourceKind.Screen : AudioSourceKind.Window,
        id: src.id,
        label: src.name || (src.id.startsWith('screen:') ? 'Screen' : 'Window'),
      };
      if (thumbnail) out.thumbnailDataUrl = thumbnail;
      if (out.kind === AudioSourceKind.Screen) screens.push(out);
      else windows.push(out);
    }
    return { screens, windows };
  }

  /**
   * Build the picker payload main returns to the renderer. The microphone
   * list is filled in on the renderer side because device labels require
   * a media-permission grant that only the renderer can request.
   */
  async listSources(): Promise<AudioSourceList> {
    const platform = process.platform;
    const permissions = this.getMediaAccessStatus();
    const supported = loopbackSupported(platform);
    if (!supported) {
      return {
        microphones: [],
        screens: [],
        windows: [],
        loopbackSupported: false,
        platform,
        permissions,
      };
    }
    const enumerated = await this.listDesktopSources();
    if (!enumerated) {
      // Permission likely missing (or denied) — surface that to the UI
      // rather than pretending no screens exist.
      return {
        microphones: [],
        screens: [],
        windows: [],
        loopbackSupported: true,
        permissionRequired: true,
        platform,
        permissions,
      };
    }
    return {
      microphones: [],
      screens: enumerated.screens,
      windows: enumerated.windows,
      loopbackSupported: true,
      platform,
      permissions,
    };
  }

  /**
   * Install a one-shot display-media handler for the next `getDisplayMedia`
   * call. The renderer triggers this immediately after the user picks a
   * screen / window source.
   *
   * Each prepare call replaces any previous handler so stale picks can't leak.
   */
  prepareDisplayMedia(source: AudioSource, electronSession: Session = session.defaultSession): void {
    if (source.kind !== AudioSourceKind.Screen && source.kind !== AudioSourceKind.Window) {
      // Microphone captures don't need the display-media handler — getUserMedia
      // is sufficient.
      return;
    }
    let used = false;
    electronSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      if (used) {
        callback({});
        return;
      }
      used = true;
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const chosen = sources.find((s) => s.id === source.id);
      if (!chosen) {
        callback({});
        return;
      }
      // `audio: 'loopback'` is the standard way to request system-audio capture
      // in Chromium / Electron when picking a screen / window source.
      callback({ video: chosen, audio: 'loopback' });
    });
  }

  /**
   * Clears any pending display-media handler. Called when the renderer cancels
   * a capture attempt before `getDisplayMedia` resolves.
   */
  clearDisplayMedia(electronSession: Session = session.defaultSession): void {
    electronSession.setDisplayMediaRequestHandler(null);
  }

  markRequesting(source: AudioSource): AudioCaptureState {
    this.state = {
      ...this.state,
      status: AudioCaptureStatus.Requesting,
      source,
      error: null,
    };
    this.emit('state', this.state);
    return this.state;
  }

  markStarted(source: AudioSource, sampleRate: number): AudioCaptureState {
    this.state = {
      status: AudioCaptureStatus.Active,
      source,
      error: null,
      sampleRate,
      segmentsEmitted: 0,
      startedAt: Date.now(),
    };
    this.emit('state', this.state);
    return this.state;
  }

  markStopped(electronSession: Session = session.defaultSession): AudioCaptureState {
    this.clearDisplayMedia(electronSession);
    this.state = defaultState();
    this.emit('state', this.state);
    return this.state;
  }

  markError(message: string, electronSession: Session = session.defaultSession): AudioCaptureState {
    this.clearDisplayMedia(electronSession);
    this.state = {
      ...defaultState(),
      status: AudioCaptureStatus.Error,
      error: message,
    };
    this.emit('state', this.state);
    return this.state;
  }

  recordLevel(tick: AudioLevelTick): void {
    this.emit('level', tick);
  }

  recordSegment(segment: AudioSegment): void {
    if (this.state.status === AudioCaptureStatus.Active) {
      this.state = {
        ...this.state,
        segmentsEmitted: this.state.segmentsEmitted + 1,
      };
      this.emit('state', this.state);
    }
    this.emit('segment', segment);
  }
}

let _orchestrator: AudioOrchestrator | null = null;
export function getAudioOrchestrator(): AudioOrchestrator {
  if (!_orchestrator) {
    _orchestrator = new AudioOrchestrator();
  }
  return _orchestrator;
}

export function _resetOrchestratorForTests(): void {
  _orchestrator = null;
}

/** Normalize Electron's macOS media-access values into a smaller enum. */
function mapDarwinStatus(
  value: ReturnType<typeof systemPreferences.getMediaAccessStatus>,
): 'granted' | 'denied' | 'unknown' {
  if (value === 'granted') return 'granted';
  if (value === 'denied' || value === 'restricted') return 'denied';
  return 'unknown';
}
