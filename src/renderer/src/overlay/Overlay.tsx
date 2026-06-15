import { useCallback, useEffect, useState } from 'react';
import type {
  AssistStatus,
  AssistSuggestion,
  HotkeyActionValue,
  OverlayState,
  TranscriptEntry,
} from '../../../shared/ipc-contract';
import { HotkeyAction } from '../../../shared/settings-schema';

/** Friendly labels for the action enum (used in the overlay HUD). */
const ACTION_LABEL: Record<HotkeyActionValue, string> = {
  [HotkeyAction.ToggleOverlay]: 'Toggle overlay',
  [HotkeyAction.CycleOverlayPosition]: 'Move overlay',
  [HotkeyAction.Assist]: 'Assist',
  [HotkeyAction.Recap]: 'Recap',
  [HotkeyAction.ToggleAskBar]: 'Ask',
  [HotkeyAction.ToggleClickThrough]: 'Click-through',
};

interface RecentHotkey {
  action: HotkeyActionValue;
  at: number;
}

/**
 * The always-on-top overlay UI.
 *
 * Phase 1 scope:
 *  - Drag handle (CSS `-webkit-app-region: drag`) so the user can move the
 *    window with the mouse.
 *  - Live readout of overlay state (opacity, click-through, content protection).
 *  - "Ask" pseudo-bar that is focused when the matching hotkey fires.
 *  - "Last action" toast to confirm hotkeys are reaching the renderer.
 *
 * The actual transcription / suggestion content arrives in Phases 2 + 3.
 */
export function Overlay(): JSX.Element {
  const [state, setState] = useState<OverlayState | null>(null);
  const [recent, setRecent] = useState<RecentHotkey | null>(null);
  const [askInput, setAskInput] = useState('');
  const [askVisible, setAskVisible] = useState(false);
  const [askIncludeScreen, setAskIncludeScreen] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [suggestions, setSuggestions] = useState<AssistSuggestion[]>([]);
  const [assistStatus, setAssistStatus] = useState<AssistStatus>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, t, sug, st] = await Promise.all([
        window.opencue.overlay.getState(),
        window.opencue.assist.getTranscript(),
        window.opencue.assist.getSuggestions(),
        window.opencue.assist.getStatus(),
      ]);
      if (cancelled) return;
      setState(s);
      setTranscript(t);
      setSuggestions(sug);
      setAssistStatus(st.status);
    })();

    const offState = window.opencue.overlay.onStateChanged((next) => setState(next));
    const offHotkey = window.opencue.hotkeys.onTriggered((action) => {
      setRecent({ action, at: Date.now() });
      if (action === HotkeyAction.ToggleAskBar) {
        setAskVisible(true);
        requestAnimationFrame(() => {
          document.getElementById('opencue-ask-input')?.focus();
        });
      }
    });
    const offTranscript = window.opencue.assist.onTranscriptEntry((entry) =>
      setTranscript((prev) => [...prev, entry].slice(-50)),
    );
    const offSuggestionStarted = window.opencue.assist.onSuggestionStarted((sug) =>
      setSuggestions((prev) => [sug, ...prev].slice(0, 5)),
    );
    const offSuggestionDelta = window.opencue.assist.onSuggestionDelta(
      (id, _delta, textSoFar) =>
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, text: textSoFar, streaming: true } : s)),
        ),
    );
    const offSuggestionDone = window.opencue.assist.onSuggestionCompleted((sug) =>
      setSuggestions((prev) => prev.map((s) => (s.id === sug.id ? sug : s))),
    );
    const offStatus = window.opencue.assist.onStatusChanged((s) => setAssistStatus(s));
    const offReset = window.opencue.assist.onReset(() => {
      setTranscript([]);
      setSuggestions([]);
    });
    return () => {
      cancelled = true;
      offState();
      offHotkey();
      offTranscript();
      offSuggestionStarted();
      offSuggestionDelta();
      offSuggestionDone();
      offStatus();
      offReset();
    };
  }, []);

  // Auto-clear the "last action" toast.
  useEffect(() => {
    if (!recent) return;
    const t = window.setTimeout(() => setRecent(null), 2200);
    return () => window.clearTimeout(t);
  }, [recent]);

  const handleHide = useCallback(() => {
    window.opencue.overlay.hide();
  }, []);

  const handleCycle = useCallback(() => {
    window.opencue.overlay.cyclePosition();
  }, []);

  const handleToggleClickThrough = useCallback(() => {
    if (!state) return;
    window.opencue.overlay.setClickThrough(!state.clickThrough);
  }, [state]);

  const handleToggleProtection = useCallback(() => {
    if (!state) return;
    window.opencue.overlay.setContentProtection(!state.contentProtection);
  }, [state]);

  const handleOpacity = useCallback((value: number) => {
    window.opencue.overlay.setOpacity(value);
  }, []);

  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-2xl backdrop-blur">
      {/* Drag handle — uses the Electron-supported CSS region. */}
      <div
        className="flex items-center justify-between gap-2 rounded-t-2xl border-b border-white/5 px-3 py-2 text-xs uppercase tracking-widest text-slate-300"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-cue-400 shadow-[0_0_10px] shadow-cue-400/60" />
          <span className="font-medium">opencue</span>
          {state ? (
            <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] tracking-wider text-slate-400">
              {state.positionPreset}
            </span>
          ) : null}
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={handleCycle}
            className="rounded px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10"
            title="Cycle overlay position"
          >
            ⇄
          </button>
          <button
            type="button"
            onClick={handleHide}
            className="rounded px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10"
            title="Hide overlay"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 py-2">
        {recent ? (
          <div className="rounded-md border border-cue-400/30 bg-cue-500/15 px-2 py-1 text-[10px] text-cue-100">
            {ACTION_LABEL[recent.action]}
          </div>
        ) : null}

        {askVisible ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const prompt = askInput.trim();
              if (prompt.length > 0) {
                void (async () => {
                  const args: {
                    triggeredBy: 'manual';
                    prompt: string;
                    screenshotDataUrl?: string;
                  } = { triggeredBy: 'manual', prompt };
                  if (askIncludeScreen) {
                    try {
                      const shot = await window.opencue.screen.capture();
                      args.screenshotDataUrl = shot.dataUrl;
                    } catch {
                      // Best-effort — fall through with text only.
                    }
                  }
                  await window.opencue.assist.run(args);
                })();
              }
              setAskInput('');
              setAskVisible(false);
            }}
          >
            <input
              id="opencue-ask-input"
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              placeholder="Ask anything…"
              className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs placeholder-slate-500 focus:border-cue-400 focus:outline-none"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setAskIncludeScreen((v) => !v)}
              className={`rounded-md px-2 py-1 text-[10px] ${
                askIncludeScreen
                  ? 'bg-cue-500/30 text-cue-100'
                  : 'text-slate-400 hover:bg-white/10'
              }`}
              title="Include a screenshot with this Ask"
            >
              📷
            </button>
            <button
              type="button"
              onClick={() => setAskVisible(false)}
              className="rounded-md px-2 py-1 text-[10px] text-slate-400 hover:bg-white/10"
            >
              esc
            </button>
          </form>
        ) : null}

        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>suggestions</span>
          <span
            className={
              assistStatus === 'thinking' || assistStatus === 'speaking'
                ? 'text-cue-300'
                : assistStatus === 'error'
                  ? 'text-rose-300'
                  : 'text-slate-500'
            }
          >
            {assistStatus}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto rounded-md border border-white/5 bg-black/30 p-2 text-xs text-slate-200">
          {suggestions.length === 0 ? (
            <p className="text-slate-500">
              Press <kbd className="font-mono text-cue-200">⌘⇧↵</kbd> to ask the copilot.
            </p>
          ) : (
            <div className="space-y-2">
              {suggestions.slice(0, 2).map((sug) => (
                <div
                  key={sug.id}
                  className={`rounded border px-2 py-1.5 leading-snug ${
                    sug.streaming
                      ? 'border-cue-400/40 bg-cue-500/5 text-cue-50'
                      : 'border-white/5 bg-white/[0.03] text-slate-100'
                  }`}
                >
                  {sug.text || '…'}
                  {sug.streaming ? <span className="ml-1 animate-pulse text-cue-300">▍</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {transcript.length > 0 ? (
          <div className="max-h-20 overflow-y-auto rounded-md border border-white/5 bg-black/20 p-1.5 text-[10px] leading-snug text-slate-400">
            {transcript
              .slice(-4)
              .map((entry) => (
                <div key={entry.id} className="truncate">
                  · {entry.text}
                </div>
              ))}
          </div>
        ) : null}

        {state ? <OverlayControls state={state} onOpacity={handleOpacity} /> : null}
      </div>

      {/* Footer toggles — exempt from the drag region so they remain clickable. */}
      <div
        className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-white/5 bg-white/[0.02] px-3 py-2 text-[10px] text-slate-400"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {state ? (
          <>
            <button
              type="button"
              onClick={handleToggleProtection}
              className={`rounded px-2 py-1 hover:bg-white/10 ${
                state.contentProtection ? 'text-cue-300' : 'text-slate-500'
              }`}
              title="Toggle screen-share invisibility"
            >
              {state.contentProtection ? '◉ private' : '○ visible'}
            </button>
            <button
              type="button"
              onClick={handleToggleClickThrough}
              className={`rounded px-2 py-1 hover:bg-white/10 ${
                state.clickThrough ? 'text-cue-300' : 'text-slate-500'
              }`}
              title="Toggle click-through"
            >
              {state.clickThrough ? 'click-through on' : 'click-through off'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function OverlayControls({
  state,
  onOpacity,
}: {
  state: OverlayState;
  onOpacity: (v: number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <label htmlFor="opencue-opacity">opacity</label>
      <input
        id="opencue-opacity"
        type="range"
        min={0.3}
        max={1}
        step={0.05}
        value={state.opacity}
        onChange={(e) => onOpacity(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-cue-400"
      />
      <span className="w-10 text-right font-mono text-slate-400">
        {state.opacity.toFixed(2)}
      </span>
    </div>
  );
}
