/**
 * Silero VAD wrapper for opencue.
 *
 * Thin adapter over `@ricky0123/vad-web`'s `AudioNodeVAD`. We use the
 * `AudioNodeVAD` variant (not `MicVAD`) because we own the `MediaStream` —
 * the renderer's `system-audio-capture.ts` already acquired it from
 * `getUserMedia` or `getDisplayMedia`.
 *
 * The VAD ONNX model + AudioWorklet bundle + onnxruntime-web WASM files are
 * copied into the renderer build under `/vad/` by `vite-plugin-static-copy`
 * (see `electron.vite.config.ts`). We point the VAD at that path.
 *
 * Public surface:
 *   - `createSileroVad(stream, callbacks)` → `{ start, pause, destroy }`.
 *   - `SileroVadCallbacks` mirrors the upstream callback signatures plus
 *     a normalized `onSegment` event that includes timing metadata.
 */

import { AudioNodeVAD } from '@ricky0123/vad-web';

/** Where the VAD assets live in the renderer build output (and dev server). */
const VAD_ASSET_BASE = '/vad/';

export interface SileroVadSegment {
  /** ms since epoch when speech started (best-effort from VAD callback time). */
  startedAt: number;
  /** ms since epoch when speech ended. */
  endedAt: number;
  /** Duration in ms. */
  durationMs: number;
  /** Mono 16 kHz PCM, normalized to [-1, 1]. */
  samples: Float32Array;
  sampleRate: 16000;
}

export interface SileroVadCallbacks {
  onSpeechStart?: () => void;
  onSegment?: (segment: SileroVadSegment) => void;
  /** Frame-level speech probabilities — useful for a live VAD indicator. */
  onSpeechProbability?: (probability: number) => void;
  onMisfire?: () => void;
  onError?: (err: Error) => void;
}

export interface SileroVadHandle {
  start(): void;
  pause(): void;
  destroy(): void;
}

/**
 * Build a Silero VAD attached to the supplied media stream.
 *
 * Audio flow:
 *   stream → MediaStreamAudioSourceNode → AudioNodeVAD → callbacks
 */
export async function createSileroVad(
  stream: MediaStream,
  callbacks: SileroVadCallbacks,
): Promise<SileroVadHandle> {
  // VAD operates on 16 kHz mono — match the AudioContext rate so resampling
  // overhead stays minimal. Most OSes will let us request 16 kHz directly.
  // If the OS refuses, fall back to the device default and let vad-web's
  // internal resampler handle it.
  const ctx = await createPreferredContext();

  let speechStartedAt: number | null = null;

  const vad = await AudioNodeVAD.new(ctx, {
    baseAssetPath: VAD_ASSET_BASE,
    onnxWASMBasePath: VAD_ASSET_BASE,
    model: 'v5',
    onFrameProcessed: (probabilities) => {
      try {
        callbacks.onSpeechProbability?.(probabilities.isSpeech);
      } catch (err) {
        callbacks.onError?.(toError(err));
      }
    },
    onSpeechStart: () => {
      speechStartedAt = Date.now();
      try {
        callbacks.onSpeechStart?.();
      } catch (err) {
        callbacks.onError?.(toError(err));
      }
    },
    onSpeechEnd: (samples) => {
      const endedAt = Date.now();
      const startedAt = speechStartedAt ?? endedAt;
      speechStartedAt = null;
      try {
        callbacks.onSegment?.({
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          samples,
          sampleRate: 16000,
        });
      } catch (err) {
        callbacks.onError?.(toError(err));
      }
    },
    onVADMisfire: () => {
      speechStartedAt = null;
      try {
        callbacks.onMisfire?.();
      } catch (err) {
        callbacks.onError?.(toError(err));
      }
    },
  });

  const sourceNode = ctx.createMediaStreamSource(stream);
  vad.receive(sourceNode);

  return {
    start: () => vad.start(),
    pause: () => vad.pause(),
    destroy: () => {
      try {
        vad.destroy();
      } catch (err) {
        callbacks.onError?.(toError(err));
      }
      try {
        sourceNode.disconnect();
      } catch {
        /* already disconnected */
      }
      void ctx.close().catch(() => undefined);
    },
  };
}

async function createPreferredContext(): Promise<AudioContext> {
  // Browsers don't have to honor the sample-rate hint; Chromium/Electron
  // usually do for capture pipelines.
  try {
    return new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
