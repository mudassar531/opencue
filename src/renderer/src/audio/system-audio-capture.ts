/**
 * Per-OS audio source acquisition (renderer).
 *
 * Acquires a `MediaStream` for the user-selected source:
 *
 *   - **Microphone:** plain `getUserMedia({ audio: { deviceId } })`.
 *   - **Screen / Window (system audio loopback):** `getDisplayMedia({ video,
 *     audio })`. The main process has already installed a one-shot
 *     `setDisplayMediaRequestHandler` that returns the chosen source plus
 *     `audio: 'loopback'`, so this resolves to a stream that contains the
 *     system audio mix for the picked target.
 *
 * The video track is discarded immediately when present — we only need audio.
 */

import {
  type AudioSource,
  AudioSourceKind,
} from '../../../shared/audio-types';

export interface AcquiredStream {
  stream: MediaStream;
  /** True if the stream came from `getDisplayMedia` (system audio path). */
  isDisplay: boolean;
  /** Effective sample rate of the first audio track (Hz). */
  sampleRate: number;
}

/**
 * Acquire an audio MediaStream for the given source.
 *
 * Caller must call `prepareCapture` on the main process *before* this for
 * Screen / Window sources so the display-media handler is armed.
 */
export async function acquireAudioStream(source: AudioSource): Promise<AcquiredStream> {
  if (source.kind === AudioSourceKind.Microphone) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: source.id ? { exact: source.id } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    return wrapStream(stream, false);
  }

  // Screen / Window — use getDisplayMedia. The main-process handler will
  // immediately return the chosen source with `audio: 'loopback'`.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  // Drop the video track — we only need audio.
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      'No audio track returned. The selected source does not produce system audio (or the OS denied loopback permission).',
    );
  }
  return wrapStream(stream, true);
}

function wrapStream(stream: MediaStream, isDisplay: boolean): AcquiredStream {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings() ?? {};
  const sampleRate = typeof settings.sampleRate === 'number' ? settings.sampleRate : 48000;
  return { stream, isDisplay, sampleRate };
}

/**
 * Enumerate input audio devices via `enumerateDevices`. Returns labels only
 * after the user has granted at least one media-permission (Chromium quirk),
 * so the picker shows generic labels until then.
 */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

/** Stop every track in a stream so the OS releases the device. */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore — track may already have ended.
    }
  }
}
