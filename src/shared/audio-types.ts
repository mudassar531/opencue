/**
 * Audio capture types shared across processes.
 *
 * Lives in `shared/` so the renderer can import them without pulling in
 * Electron, and the main process IPC layer can use the same shapes.
 */

/** The kind of input the user is capturing from. */
export const AudioSourceKind = {
  /** A microphone or other physical input device exposed by the OS. */
  Microphone: 'microphone',
  /** System/loopback audio for a screen (whole desktop mix). */
  Screen: 'screen',
  /** System/loopback audio for a single window (e.g. a Google Meet tab). */
  Window: 'window',
} as const;

export type AudioSourceKindValue = (typeof AudioSourceKind)[keyof typeof AudioSourceKind];

/** A capture source the user can select. Identifiers vary by kind. */
export interface AudioSource {
  kind: AudioSourceKindValue;
  /**
   * Stable identifier. For microphones this is the MediaDeviceInfo deviceId;
   * for screen/window it is the desktopCapturer source id.
   */
  id: string;
  label: string;
  /** Optional base64 thumbnail PNG (screen/window only). */
  thumbnailDataUrl?: string;
}

/** Per-OS media-permission state surfaced from main. */
export type MediaAccessStatus = 'granted' | 'denied' | 'unknown' | 'not-applicable';

/** Whole snapshot the source picker UI renders. */
export interface AudioSourceList {
  microphones: AudioSource[];
  screens: AudioSource[];
  windows: AudioSource[];
  /** Per-OS loopback capability — when false, the picker hides screen/window options. */
  loopbackSupported: boolean;
  /** True when loopback is supported but `desktopCapturer` returned nothing because
   *  the OS-level permission has not been granted. UI uses this to show a CTA. */
  permissionRequired?: boolean;
  /** Current macOS Screen & Microphone permission state (not-applicable elsewhere). */
  permissions?: { screen: MediaAccessStatus; microphone: MediaAccessStatus };
  platform: NodeJS.Platform;
}

/** Lifecycle of a single capture session, surfaced to the UI. */
export const AudioCaptureStatus = {
  Idle: 'idle',
  Requesting: 'requesting',
  Active: 'active',
  Error: 'error',
} as const;

export type AudioCaptureStatusValue = (typeof AudioCaptureStatus)[keyof typeof AudioCaptureStatus];

export interface AudioCaptureState {
  status: AudioCaptureStatusValue;
  /** The selected source while active. `null` between sessions. */
  source: AudioSource | null;
  /** Most recent error message when status === 'error'. */
  error: string | null;
  /** Effective sample rate of the captured stream (Hz). */
  sampleRate: number;
  /** Number of speech segments emitted so far in this session. */
  segmentsEmitted: number;
  /** When the current session started (ms since epoch). `null` between sessions. */
  startedAt: number | null;
}

/**
 * A finalized speech segment emitted by the VAD.
 *
 * The renderer collects the audio chunks and ships them through IPC; later
 * phases hand them off to STT (Phase 3) or persist them as session recordings
 * (Phase 6). PCM is normalized to mono 16 kHz Float32 in [-1, 1].
 */
export interface AudioSegment {
  /** Monotonic identifier, unique within a capture session. */
  id: number;
  /** ms since epoch when the speech started. */
  startedAt: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** PCM length in samples (frames). */
  sampleCount: number;
  /** Sample rate of `samples`. Currently always 16 000. */
  sampleRate: number;
  /** RMS level over the segment, [0, 1]. */
  rms: number;
}

/** Pure live-metrics packet pushed to the renderer at ~20 Hz while capturing. */
export interface AudioLevelTick {
  rms: number;
  peak: number;
  /** True if the VAD currently believes speech is active. */
  speechActive: boolean;
  /** ms since epoch. */
  timestamp: number;
}

/** Helper — typed empty source list (used when capture is unsupported). */
export const EMPTY_AUDIO_SOURCE_LIST: AudioSourceList = {
  microphones: [],
  screens: [],
  windows: [],
  loopbackSupported: false,
  platform: 'linux',
};
