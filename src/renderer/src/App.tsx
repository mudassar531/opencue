import { useEffect, useState } from 'react';

interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  pingReply: string;
}

export function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [version, platform, ping] = await Promise.all([
          window.opencue.app.getVersion(),
          window.opencue.app.getPlatform(),
          window.opencue.app.ping({ message: 'hello from renderer' }),
        ]);
        setInfo({
          version: version.version,
          platform: platform.platform,
          arch: platform.arch,
          pingReply: ping.reply,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-slate-950 p-8 text-slate-100">
      <header className="flex flex-col items-center gap-2">
        <div className="rounded-full bg-cue-500/20 px-4 py-1 text-xs font-medium uppercase tracking-widest text-cue-300">
          phase 0 · scaffolding
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">opencue</h1>
        <p className="max-w-xl text-center text-sm text-slate-400">
          Open-source meeting copilot. Real-time transcription, AI assistance, and an
          always-on-top overlay excluded from screen sharing — bring your own keys or run
          fully local.
        </p>
      </header>

      <section className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Runtime probe
        </h2>
        {error ? (
          <p className="text-sm text-rose-400">IPC error: {error}</p>
        ) : info ? (
          <ul className="space-y-2 text-sm">
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

      <footer className="text-xs text-slate-500">
        Phase 1 wires the always-on-top overlay and global hotkeys.
      </footer>
    </div>
  );
}
