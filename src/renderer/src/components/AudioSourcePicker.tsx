import { useCallback, useEffect, useState } from 'react';
import {
  type AudioSource,
  AudioSourceKind,
  type AudioSourceList,
} from '../../../shared/audio-types';
import { listInputDevices } from '../audio/system-audio-capture';

interface Props {
  selected: AudioSource | null;
  disabled?: boolean;
  onSelect: (source: AudioSource) => void;
}

/**
 * Picker for the user's audio source. Combines:
 *   - Microphones from `navigator.mediaDevices.enumerateDevices()` (renderer).
 *   - Screens + windows from main-process `desktopCapturer` (via IPC).
 */
export function AudioSourcePicker({ selected, disabled, onSelect }: Props): JSX.Element {
  const [sources, setSources] = useState<AudioSourceList | null>(null);
  const [mics, setMics] = useState<AudioSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, devices] = await Promise.all([
        window.opencue.audio.listSources(),
        listInputDevices(),
      ]);
      setSources(list);
      setMics(
        devices.map((d, idx) => ({
          kind: AudioSourceKind.Microphone,
          id: d.deviceId,
          label: d.label || `Microphone ${idx + 1}`,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Audio source
        </h3>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          disabled={loading || disabled}
        >
          {loading ? 'refreshing…' : 'refresh'}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      {sources && !sources.loopbackSupported ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
          System-audio loopback isn&apos;t supported natively on{' '}
          <code>{sources.platform}</code>. Pick a microphone — or, on Linux,
          select a <em>Monitor of …</em> input device which captures whatever
          is currently playing.
        </p>
      ) : null}

      {sources?.permissionRequired ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          {sources.platform === 'darwin'
            ? 'macOS needs Screen & System Audio Recording permission for opencue to list windows and capture system audio. Open System Settings → Privacy & Security → Screen Recording, enable opencue (or your Electron build), then click refresh.'
            : "Couldn't enumerate screens / windows. Check your OS screen-recording permission, then refresh."}
        </p>
      ) : null}

      <SourceGroup
        title="Microphones"
        items={mics}
        selected={selected}
        onSelect={onSelect}
        disabled={disabled}
        emptyMessage="Allow microphone access once, then refresh."
      />

      {sources?.loopbackSupported ? (
        <>
          <SourceGroup
            title="Screens (system audio)"
            items={sources.screens}
            selected={selected}
            onSelect={onSelect}
            disabled={disabled}
            emptyMessage="No screens detected."
          />
          <SourceGroup
            title="Windows (per-app audio)"
            items={sources.windows}
            selected={selected}
            onSelect={onSelect}
            disabled={disabled}
            emptyMessage="No capturable windows detected."
          />
        </>
      ) : null}
    </div>
  );
}

interface GroupProps {
  title: string;
  items: AudioSource[];
  selected: AudioSource | null;
  onSelect: (source: AudioSource) => void;
  disabled?: boolean;
  emptyMessage: string;
}

function SourceGroup({
  title,
  items,
  selected,
  onSelect,
  disabled,
  emptyMessage,
}: GroupProps): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyMessage}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {items.map((item) => {
            const isSelected = selected?.id === item.id && selected?.kind === item.kind;
            return (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(item)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                    isSelected
                      ? 'border-cue-400/60 bg-cue-500/15 text-cue-50'
                      : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:bg-slate-900'
                  } ${disabled ? 'opacity-50' : ''}`}
                >
                  {item.thumbnailDataUrl ? (
                    <img
                      src={item.thumbnailDataUrl}
                      alt=""
                      className="h-8 w-12 flex-shrink-0 rounded border border-slate-800 object-cover"
                    />
                  ) : (
                    <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-slate-600" />
                  )}
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
