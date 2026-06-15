import { useCallback, useEffect, useState } from 'react';
import type {
  AssistStatus,
  AssistSuggestion,
  TranscriptEntry,
} from '../../../shared/ipc-contract';

const STATUS_LABEL: Record<AssistStatus, string> = {
  idle: 'idle',
  thinking: 'thinking…',
  speaking: 'speaking…',
  error: 'error',
};

/**
 * Live transcript + Assist suggestion stream.
 *
 * Subscribes to the assist orchestrator events broadcast by main, plays back
 * TTS audio when it arrives, and exposes a small "Ask" form so the user can
 * submit a free-form question without using the hotkey.
 */
export function AssistPanel(): JSX.Element {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [suggestions, setSuggestions] = useState<AssistSuggestion[]>([]);
  const [status, setStatus] = useState<AssistStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [t, s, st] = await Promise.all([
        window.opencue.assist.getTranscript(),
        window.opencue.assist.getSuggestions(),
        window.opencue.assist.getStatus(),
      ]);
      if (cancelled) return;
      setTranscript(t);
      setSuggestions(s);
      setStatus(st.status);
      setError(st.error);
    })();

    const offStatus = window.opencue.assist.onStatusChanged((s, err) => {
      setStatus(s);
      setError(err);
    });
    const offTranscript = window.opencue.assist.onTranscriptEntry((entry) =>
      setTranscript((prev) => [...prev, entry].slice(-200)),
    );
    const offStarted = window.opencue.assist.onSuggestionStarted((sug) =>
      setSuggestions((prev) => [sug, ...prev].slice(0, 20)),
    );
    const offDelta = window.opencue.assist.onSuggestionDelta((id, _delta, textSoFar) =>
      setSuggestions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, text: textSoFar, streaming: true } : s)),
      ),
    );
    const offComplete = window.opencue.assist.onSuggestionCompleted((sug) =>
      setSuggestions((prev) => prev.map((s) => (s.id === sug.id ? sug : s))),
    );
    const offError = window.opencue.assist.onSuggestionError((id, message) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, streaming: false, text: `${s.text}\n\n[error] ${message}`.trim() } : s,
        ),
      );
    });
    const offReset = window.opencue.assist.onReset(() => {
      setTranscript([]);
      setSuggestions([]);
    });
    const offTts = window.opencue.assist.onTtsAudio(({ mimeType, audioBase64 }) => {
      playAudio(mimeType, audioBase64);
    });
    return () => {
      cancelled = true;
      offStatus();
      offTranscript();
      offStarted();
      offDelta();
      offComplete();
      offError();
      offReset();
      offTts();
    };
  }, []);

  const submitAsk = useCallback(
    async (text?: string, isRecap?: boolean) => {
      const prompt = text ?? ask;
      if (!prompt && !isRecap) return;
      setAsk('');
      const args: { triggeredBy: 'manual'; prompt?: string; isRecap?: boolean } = {
        triggeredBy: 'manual',
      };
      if (prompt) args.prompt = prompt;
      if (isRecap) args.isRecap = isRecap;
      await window.opencue.assist.run(args);
    },
    [ask],
  );

  const resetSession = useCallback(async () => {
    await window.opencue.assist.reset();
  }, []);

  return (
    <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Assist</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
            status === 'idle'
              ? 'bg-slate-800 text-slate-400'
              : status === 'thinking' || status === 'speaking'
                ? 'bg-cue-500/20 text-cue-200'
                : 'bg-rose-500/20 text-rose-200'
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {error ? (
        <p className="mb-3 rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitAsk();
        }}
      >
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Ask the copilot something… (or hit ⌘⇧↵ for auto Assist)"
          className="flex-1 rounded-md border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500"
          autoComplete="off"
        />
        <button
          type="submit"
          className="rounded-md bg-cue-500/20 px-3 py-1.5 text-xs text-cue-100 hover:bg-cue-500/30"
        >
          Ask
        </button>
        <button
          type="button"
          onClick={() => void submitAsk(undefined, true)}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          Recap
        </button>
        <button
          type="button"
          onClick={resetSession}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
          title="Clear transcript and suggestions"
        >
          Reset
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Transcript ({transcript.length})
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-2 text-xs">
            {transcript.length === 0 ? (
              <p className="text-slate-500">No transcribed segments yet.</p>
            ) : (
              transcript
                .slice(-30)
                .reverse()
                .map((entry) => (
                  <div key={entry.id} className="rounded bg-slate-900/60 px-2 py-1 text-slate-200">
                    <span className="mr-1 font-mono text-[10px] text-slate-500">
                      #{entry.id.toString().padStart(3, '0')}
                    </span>
                    {entry.text}
                  </div>
                ))
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Suggestions ({suggestions.length})
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-2 text-xs">
            {suggestions.length === 0 ? (
              <p className="text-slate-500">No suggestions yet. Press the Assist hotkey.</p>
            ) : (
              suggestions.map((sug) => (
                <div
                  key={sug.id}
                  className={`rounded border px-2 py-1.5 ${
                    sug.streaming
                      ? 'border-cue-400/40 bg-cue-500/5 text-cue-50'
                      : 'border-slate-800 bg-slate-900/60 text-slate-200'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
                    <span>
                      #{sug.id.toString().padStart(3, '0')} · {sug.providerId}
                      {sug.model ? ` · ${sug.model}` : ''}
                    </span>
                    {sug.streaming ? <span className="text-cue-300">streaming…</span> : null}
                  </div>
                  <p className="whitespace-pre-wrap leading-snug">{sug.text || '…'}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function playAudio(mimeType: string, audioBase64: string): void {
  try {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    audio.play().catch(() => URL.revokeObjectURL(url));
  } catch {
    /* swallow — audio playback failure should never break the UI */
  }
}
