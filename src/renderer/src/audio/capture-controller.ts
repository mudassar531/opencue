/**
 * Top-level audio capture controller (renderer).
 *
 * Coordinates:
 *   - Selecting a source via the main-process orchestrator.
 *   - Acquiring the `MediaStream` (getUserMedia or getDisplayMedia).
 *   - Running a parallel AnalyserNode for live RMS / peak level ticks.
 *   - Running Silero VAD via `createSileroVad` for speech segmentation.
 *   - Reporting state, level ticks, and finalized segments back to the
 *     main process over the typed IPC bridge.
 *
 * The controller is a plain class that components instantiate; it does not
 * own React state. Components subscribe via the supplied callback.
 */

import type { AudioSource } from '../../../shared/audio-types';
import { peak, rms } from './level-meter';
import { RingBuffer } from './ring-buffer';
import { acquireAudioStream, stopStream } from './system-audio-capture';
import { createSileroVad, type SileroVadHandle } from './vad-stream';

const LEVEL_TICK_HZ = 20;
const LEVEL_FRAME_SAMPLES = 1024;
/** Retain ~30 s of pre-VAD audio so we can pad the start of a speech segment. */
const RING_BUFFER_SECONDS = 30;

export type CaptureLifecycleState =
  | { kind: 'idle' }
  | { kind: 'requesting'; source: AudioSource }
  | { kind: 'active'; source: AudioSource; sampleRate: number; startedAt: number }
  | { kind: 'error'; source: AudioSource | null; message: string };

export interface CaptureControllerCallbacks {
  onState?: (state: CaptureLifecycleState) => void;
  onLevel?: (rms: number, peak: number, speechActive: boolean) => void;
  onSegment?: (segmentId: number, durationMs: number, rms: number) => void;
}

/** Singleton-style controller — one capture session at a time. */
export class CaptureController {
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserCtx: AudioContext | null = null;
  private analyserRaf: number | null = null;
  private analyserTimer: number | null = null;
  private vad: SileroVadHandle | null = null;
  private ringBuffer: RingBuffer | null = null;
  private state: CaptureLifecycleState = { kind: 'idle' };
  private speechActive = false;
  private segmentCounter = 0;
  private callbacks: CaptureControllerCallbacks;

  constructor(callbacks: CaptureControllerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  getState(): CaptureLifecycleState {
    return this.state;
  }

  isActive(): boolean {
    return this.state.kind === 'active';
  }

  async start(source: AudioSource): Promise<void> {
    if (this.state.kind === 'requesting' || this.state.kind === 'active') {
      await this.stop();
    }
    this.setState({ kind: 'requesting', source });
    try {
      const prepare = await window.opencue.audio.prepareCapture(source);
      if (!prepare.ok) {
        throw new Error(prepare.error);
      }
      const acquired = await acquireAudioStream(source);
      this.stream = acquired.stream;

      const sampleRate = acquired.sampleRate;
      this.ringBuffer = new RingBuffer({
        capacity: Math.ceil(RING_BUFFER_SECONDS * sampleRate),
      });

      this.startLevelLoop(acquired.stream);
      await this.startVad(acquired.stream);

      await window.opencue.audio.captureStarted(source, sampleRate);
      this.setState({
        kind: 'active',
        source,
        sampleRate,
        startedAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.cleanup();
      this.setState({ kind: 'error', source: source ?? null, message });
      await window.opencue.audio.reportError(message).catch(() => undefined);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.cleanup();
    this.setState({ kind: 'idle' });
    await window.opencue.audio.captureStopped().catch(() => undefined);
  }

  /** Clean up native resources without changing user-facing state. */
  private cleanup(): void {
    if (this.analyserRaf !== null) {
      cancelAnimationFrame(this.analyserRaf);
      this.analyserRaf = null;
    }
    if (this.analyserTimer !== null) {
      window.clearInterval(this.analyserTimer);
      this.analyserTimer = null;
    }
    if (this.vad) {
      try {
        this.vad.destroy();
      } catch {
        /* ignore */
      }
      this.vad = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* ignore */
      }
      this.analyser = null;
    }
    if (this.analyserCtx) {
      void this.analyserCtx.close().catch(() => undefined);
      this.analyserCtx = null;
    }
    stopStream(this.stream);
    this.stream = null;
    this.ringBuffer = null;
    this.speechActive = false;
  }

  private startLevelLoop(stream: MediaStream): void {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    this.analyserCtx = ctx;
    this.analyser = analyser;

    const frame = new Float32Array(LEVEL_FRAME_SAMPLES);
    const tickIntervalMs = Math.round(1000 / LEVEL_TICK_HZ);
    this.analyserTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(frame);
      const r = rms(frame);
      const p = peak(frame);
      this.callbacks.onLevel?.(r, p, this.speechActive);
      void window.opencue.audio
        .reportLevel({
          rms: r,
          peak: p,
          speechActive: this.speechActive,
          timestamp: Date.now(),
        })
        .catch(() => undefined);
    }, tickIntervalMs);
  }

  private async startVad(stream: MediaStream): Promise<void> {
    this.vad = await createSileroVad(stream, {
      onSpeechStart: () => {
        this.speechActive = true;
      },
      onMisfire: () => {
        this.speechActive = false;
      },
      onSegment: ({ samples, durationMs, startedAt }) => {
        this.speechActive = false;
        if (this.ringBuffer) {
          this.ringBuffer.write(samples);
        }
        this.segmentCounter += 1;
        const segmentRms = rms(samples);
        const segmentId = this.segmentCounter;
        // 1) Lightweight metadata for the audio orchestrator UI.
        void window.opencue.audio
          .reportSegment({
            id: segmentId,
            startedAt,
            durationMs,
            sampleCount: samples.length,
            sampleRate: 16000,
            rms: segmentRms,
          })
          .catch(() => undefined);
        // 2) Full PCM for transcription. Skip if no STT key has ever been
        // configured to avoid spamming providers with empty calls.
        const samplesBase64 = float32ToBase64(samples);
        void window.opencue.assist
          .submitSegment({
            segmentId,
            startedAt,
            sampleRate: 16000,
            samplesBase64,
          })
          .catch(() => undefined);
        this.callbacks.onSegment?.(segmentId, durationMs, segmentRms);
      },
      onError: (err) => {
        // VAD errors after start are surfaced but don't tear the session down —
        // the level loop keeps reporting so the user still sees signal.
        // eslint-disable-next-line no-console
        console.warn('opencue: VAD error', err);
      },
    });
    this.vad.start();
  }

  private setState(next: CaptureLifecycleState): void {
    this.state = next;
    this.callbacks.onState?.(next);
  }
}

/**
 * Convert a Float32Array to a base64-encoded string of its raw bytes so it
 * can be shipped across IPC and re-wrapped in main with `new Float32Array(buf)`.
 */
function float32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
