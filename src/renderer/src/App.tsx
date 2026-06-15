import { useCallback, useEffect, useState } from 'react';
import type { OpencueSettings, OverlayState } from '../../shared/ipc-contract';
import { HotkeyAction } from '../../shared/settings-schema';

interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  pingReply: string;
}

const HOTKEY_LABEL: Record<string, string> = {
  [HotkeyAction.ToggleOverlay]: 'Toggle overlay',
  [HotkeyAction.CycleOverlayPosition]: 'Move overlay',
  [HotkeyAction.Assist]: 'Assist',
  [HotkeyAction.Recap]: 'Recap',
  [HotkeyAction.ToggleAskBar]: 'Open ask-bar',
  [HotkeyAction.ToggleClickThrough]: 'Toggle click-through',
};

export function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<OpencueSettings | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [version, platform, ping, s, o] = await Promise.all([
          window.opencue.app.getVersion(),
          window.opencue.app.getPlatform(),
          window.opencue.app.ping({ message: 'hello from renderer' }),
          window.opencue.settings.get(),
          window.opencue.overlay.getState(),
        ]);
        setInfo({
          version: version.version,
          platform: platform.platform,
          arch: platform.arch,
          pingReply: ping.reply,
        });
        setSettings(s);
        setOverlay(o);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    const offState = window.opencue.overlay.onStateChanged(setOverlay);
    const offSettings = window.opencue.settings.onChanged(setSettings);
    return () => {
      offState();
      offSettings();
    };
  }, []);

  const toggleOverlay = useCallback(() => {
    window.opencue.overlay.toggle();
  }, []);

  const toggleProtection = useCallback(() => {
    if (!overlay) return;
    window.opencue.overlay.setContentProtection(!overlay.contentProtection);
  }, [overlay]);

  const toggleClickThrough = useCallback(() => {
    if (!overlay) return;
    window.opencue.overlay.setClickThrough(!overlay.clickThrough);
  }, [overlay]);

  const resetSettings = useCallback(() => {
    window.opencue.settings.reset();
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-start gap-6 overflow-y-auto bg-slate-950 p-8 text-slate-100">
      <header className="flex flex-col items-center gap-2">
        <div className="rounded-full bg-cue-500/20 px-4 py-1 text-xs font-medium uppercase tracking-widest text-cue-300">
          phase 1 · overlay & hotkeys
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">opencue</h1>
        <p className="max-w-xl text-center text-sm text-slate-400">
          Open-source meeting copilot. The overlay floats above every other
          window and is excluded from screen sharing. Phase 2 wires audio
          capture; Phase 3 wires AI suggestions.
        </p>
      </header>

      <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Runtime probe
        </h2>
        {error ? (
          <p className="text-sm text-rose-400">IPC error: {error}</p>
        ) : info ? (
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <li>
              <span className="text-slate-400">version</span>{' '}
              <span className="font-mono text-slate-100">{info.version}</span>
            </li>
            <li>
              <span className="text-slate-400">platform</span>{' '}
              <span className="font-mono text-slate-100">
                {info.platform} / {info.arch}
              </span>
            </li>
            <li>
              <span className="text-slate-400">ipc</span>{' '}
              <span className="font-mono text-slate-100">{info.pingReply}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Loading…</p>
        )}
      </section>

      <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Overlay
          </h2>
          <button
            type="button"
            onClick={toggleOverlay}
            className="rounded-md bg-cue-500/20 px-3 py-1 text-xs text-cue-100 hover:bg-cue-500/30"
          >
            {overlay?.visible ? 'Hide overlay' : 'Show overlay'}
          </button>
        </div>
        {overlay ? (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="visible" value={overlay.visible ? 'yes' : 'no'} />
            <Stat label="opacity" value={overlay.opacity.toFixed(2)} />
            <Stat label="position" value={overlay.positionPreset} />
            <Stat
              label="size"
              value={`${overlay.size.width}×${overlay.size.height}`}
            />
            <button
              type="button"
              onClick={toggleProtection}
              className={`col-span-2 rounded-md border px-3 py-2 text-xs ${
                overlay.contentProtection
                  ? 'border-cue-400/40 bg-cue-500/10 text-cue-100'
                  : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              {overlay.contentProtection
                ? 'content protection ON — overlay hidden from screen capture'
                : 'content protection OFF — overlay visible to screen capture'}
            </button>
            <button
              type="button"
              onClick={toggleClickThrough}
              className={`col-span-2 rounded-md border px-3 py-2 text-xs ${
                overlay.clickThrough
                  ? 'border-cue-400/40 bg-cue-500/10 text-cue-100'
                  : 'border-slate-600 bg-slate-800 text-slate-300'
              }`}
            >
              {overlay.clickThrough
                ? 'click-through ON — overlay ignores the mouse'
                : 'click-through OFF — overlay accepts clicks'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Loading overlay state…</p>
        )}
      </section>

      <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Global hotkeys
          </h2>
          <button
            type="button"
            onClick={resetSettings}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            Reset to defaults
          </button>
        </div>
        {settings ? (
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {Object.entries(settings.hotkeys).map(([action, accel]) => (
              <li
                key={action}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2"
              >
                <span className="text-slate-300">{HOTKEY_LABEL[action] ?? action}</span>
                <kbd className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-200">
                  {accel}
                </kbd>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Loading hotkeys…</p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Hotkey re-binding UI ships in Phase 6 (settings polish). Defaults are
          editable directly in <code>settings:update-hotkeys</code>.
        </p>
      </section>

      <footer className="text-xs text-slate-500">
        Next up — Phase 2: system / mic / loopback audio capture + Silero VAD.
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-slate-100">{value}</div>
    </div>
  );
}
