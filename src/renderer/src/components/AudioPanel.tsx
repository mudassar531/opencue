import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AudioCaptureState,
  AudioSegment,
  AudioSource,
} from '../../../shared/audio-types';
import { AudioCaptureStatus } from '../../../shared/audio-types';
import { CaptureController, type CaptureLifecycleState } from '../audio/capture-controller';
import { AudioSourcePicker } from './AudioSourcePicker';
import { LevelMeter } from './LevelMeter';

const STATUS_LABEL: Record<string, string> = {
  [AudioCaptureStatus.Idle]: 'idle',
  [AudioCaptureStatus.Requesting]: 'requesting…',
  [AudioCaptureStatus.Active]: 'live',
  [AudioCaptureStatus.Error]: 'error',
};

/**
 * Live audio capture panel — source picker, level meter, segment counter.
 * Owns a single `CaptureController` for the panel's lifetime.
 */
export function AudioPanel(): JSX.Element {
  const [selected, setSelected] = useState<AudioSource | null>(null);
  const [lifecycle, setLifecycle] = useState<CaptureLifecycleState>({ kind: 'idle' });
  const [captureState, setCaptureState] = useState<AudioCaptureState | null>(null);
  const [rms, setRms] = useState(0);
  const [peak, setPeak] = useState(0);
  const [speechActive, setSpeechActive] = useState(false);
  const [recentSegments, setRecentSegments] = useState<AudioSegment[]>([]);
  const controllerRef = useRef<CaptureController | null>(null);

  // Create the controller exactly once.
  if (!controllerRef.current) {
    controllerRef.current = new CaptureController({
      onState: (state) => setLifecycle(state),
      onLevel: (r, p, speech) => {
        setRms(r);
        setPeak(p);
        setSpeechActive(speech);
      },
    });
  }
  const controller = controllerRef.current;

  // Subscribe to main-process pushes so the UI stays in sync even if a
  // future code path drives capture from somewhere other than this panel.
  useEffect(() => {
    let cancelled = false;
    window.opencue.audio.getState().then((s) => {
      if (!cancelled) setCaptureState(s);
    });
    const offState = window.opencue.audio.onStateChanged(setCaptureState);
    const offSegment = window.opencue.audio.onSegmentReady((segment) => {
      setRecentSegments((prev) => {
        const next = [segment, ...prev];
        return next.slice(0, 5);
      });
    });
    return () => {
      cancelled = true;
      offState();
      offSegment();
    };
  }, []);

  // Stop capture on unmount so the OS releases the device.
  useEffect(() => {
    return () => {
      void controller.stop();
    };
  }, [controller]);

  const handleStart = useCallback(async () => {
    if (!selected) return;
    try {
      await controller.start(selected);
    } catch (err) {
      // The controller already surfaced this through the state callback.
      // eslint-disable-next-line no-console
      console.error('opencue: capture failed', err);
    }
  }, [controller, selected]);

  const handleStop = useCallback(() => {
    void controller.stop();
  }, [controller]);

  const isActive = lifecycle.kind === 'active';
  const isRequesting = lifecycle.kind === 'requesting';
  const statusText = useMemo(() => {
    if (lifecycle.kind === 'error') return `error: ${lifecycle.message}`;
    return STATUS_LABEL[captureState?.status ?? AudioCaptureStatus.Idle] ?? captureState?.status ?? 'idle';
  }, [captureState, lifecycle]);

  return (
    <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Audio capture
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
            isActive
              ? 'bg-cue-500/20 text-cue-200'
              : isRequesting
                ? 'bg-amber-500/20 text-amber-200'
                : lifecycle.kind === 'error'
                  ? 'bg-rose-500/20 text-rose-200'
                  : 'bg-slate-800 text-slate-400'
          }`}
        >
          {statusText}
        </span>
      </div>

      <AudioSourcePicker
        selected={selected}
        disabled={isActive || isRequesting}
        onSelect={setSelected}
      />

      <div className="mt-4 flex items-center gap-2">
        {!isActive ? (
          <button
            type="button"
            disabled={!selected || isRequesting}
            onClick={() => void handleStart()}
            className="rounded-md bg-cue-500/20 px-3 py-1.5 text-xs text-cue-100 hover:bg-cue-500/30 disabled:opacity-50"
          >
            {isRequesting ? 'starting…' : 'Start capture'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStop}
            className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-500/20"
          >
            Stop
          </button>
        )}
        {captureState && captureState.status === AudioCaptureStatus.Active ? (
          <span className="text-[10px] text-slate-500">
            {captureState.sampleRate} Hz · {captureState.segmentsEmitted} segments
          </span>
        ) : null}
      </div>

      {isActive ? (
        <div className="mt-4">
          <LevelMeter rms={rms} peak={peak} speechActive={speechActive} />
        </div>
      ) : null}

      {recentSegments.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Recent speech segments
          </div>
          <ul className="space-y-1">
            {recentSegments.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/40 px-2 py-1 font-mono text-[11px] text-slate-300"
              >
                <span>#{s.id.toString().padStart(3, '0')}</span>
                <span className="text-slate-500">{s.durationMs} ms</span>
                <span className="text-slate-500">{s.sampleCount} samples</span>
                <span className="text-slate-500">rms {s.rms.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] text-slate-500">
        VAD: Silero v5 (running locally in the renderer via onnxruntime-web).
        Audio never leaves your machine in this phase — Phase 3 adds optional
        cloud STT providers.
      </p>
    </section>
  );
}
