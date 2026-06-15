import { dbFsToMeter, toDbFs } from '../audio/level-meter';

interface Props {
  rms: number;
  peak: number;
  speechActive: boolean;
}

/**
 * Compact horizontal level meter — log-scale, with a peak indicator and a
 * dot that lights up while the VAD believes speech is active.
 */
export function LevelMeter({ rms, peak, speechActive }: Props): JSX.Element {
  const rmsMeter = dbFsToMeter(toDbFs(rms));
  const peakMeter = dbFsToMeter(toDbFs(peak));
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            speechActive ? 'bg-cue-300 shadow-[0_0_8px] shadow-cue-300/70' : 'bg-slate-700'
          }`}
        />
        <span>{speechActive ? 'speech' : 'silence'}</span>
        <span className="ml-auto font-mono text-slate-500">
          {toDbFs(rms).toFixed(1)} dB rms · {toDbFs(peak).toFixed(1)} dB pk
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-cue-500/70 transition-[width] duration-75"
          style={{ width: `${rmsMeter * 100}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-cue-200"
          style={{ left: `${peakMeter * 100}%`, opacity: peakMeter > 0 ? 1 : 0 }}
        />
      </div>
    </div>
  );
}
