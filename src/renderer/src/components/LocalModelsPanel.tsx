import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ModelStatus,
  ModelStatusEntry,
  SidecarStatus,
} from '../../../shared/ipc-contract';
import {
  MODEL_REGISTRY,
  humanBytes,
  type ModelDefinition,
} from '../../../shared/model-registry';

/**
 * Local models + Python sidecar control surface.
 *
 * Three responsibilities:
 *   1. Render the curated model registry with per-model status + actions.
 *   2. Surface the Python sidecar lifecycle (install check, start / stop).
 *   3. Show whether Ollama is reachable and list its installed local LLMs.
 */
export function LocalModelsPanel(): JSX.Element {
  const [statuses, setStatuses] = useState<Map<string, ModelStatus>>(new Map());
  const [sidecar, setSidecar] = useState<SidecarStatus>({ state: 'stopped' });
  const [scriptInfo, setScriptInfo] = useState<{ installed: boolean; scriptPath: string } | null>(
    null,
  );
  const [ollama, setOllama] = useState<{ reachable: boolean; baseUrl: string; models: string[] } | null>(
    null,
  );

  const refreshAll = useCallback(async () => {
    const [list, s, scr, oll] = await Promise.all([
      window.opencue.models.listStatuses(),
      window.opencue.sidecar.getStatus(),
      window.opencue.sidecar.checkInstalled(),
      window.opencue.ollama.listModels(),
    ]);
    const map = new Map<string, ModelStatus>();
    for (const entry of list) map.set(entry.id, entry.status);
    setStatuses(map);
    setSidecar(s);
    setScriptInfo(scr);
    setOllama(oll);
  }, []);

  useEffect(() => {
    void refreshAll();
    const offModel = window.opencue.models.onStatusChanged((entry: ModelStatusEntry) =>
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(entry.id, entry.status);
        return next;
      }),
    );
    const offSidecar = window.opencue.sidecar.onStatusChanged(setSidecar);
    return () => {
      offModel();
      offSidecar();
    };
  }, [refreshAll]);

  const sttModels = useMemo(() => MODEL_REGISTRY.filter((m) => m.kind === 'stt'), []);
  const ttsModels = useMemo(() => MODEL_REGISTRY.filter((m) => m.kind === 'tts'), []);

  return (
    <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Local models &amp; sidecar
        </h2>
        <button
          type="button"
          onClick={() => void refreshAll()}
          className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
        >
          refresh
        </button>
      </div>

      <SidecarControls
        sidecar={sidecar}
        scriptInfo={scriptInfo}
        onStart={async () => {
          await window.opencue.sidecar.start();
        }}
        onStop={async () => {
          await window.opencue.sidecar.stop();
        }}
      />

      <OllamaControls ollama={ollama} />

      <h3 className="mt-5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Speech-to-text
      </h3>
      <ul className="space-y-2">
        {sttModels.map((def) => (
          <ModelRow
            key={def.id}
            def={def}
            status={statuses.get(def.id) ?? { state: 'absent' }}
          />
        ))}
      </ul>

      <h3 className="mt-5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Text-to-speech
      </h3>
      <ul className="space-y-2">
        {ttsModels.map((def) => (
          <ModelRow
            key={def.id}
            def={def}
            status={statuses.get(def.id) ?? { state: 'absent' }}
          />
        ))}
      </ul>
    </section>
  );
}

function SidecarControls({
  sidecar,
  scriptInfo,
  onStart,
  onStop,
}: {
  sidecar: SidecarStatus;
  scriptInfo: { installed: boolean; scriptPath: string } | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              sidecar.state === 'running'
                ? 'bg-cue-300'
                : sidecar.state === 'starting'
                  ? 'bg-amber-400'
                  : sidecar.state === 'error'
                    ? 'bg-rose-400'
                    : 'bg-slate-600'
            }`}
          />
          <span className="font-medium text-slate-200">Python sidecar</span>
          <span className="text-slate-500">
            {sidecar.state === 'running'
              ? `running · pid ${sidecar.pid} · port ${sidecar.port}`
              : sidecar.state === 'starting'
                ? `starting · pid ${sidecar.pid}`
                : sidecar.state === 'error'
                  ? sidecar.message
                  : 'stopped'}
          </span>
        </div>
        <div className="flex gap-2">
          {sidecar.state === 'running' || sidecar.state === 'starting' ? (
            <button
              type="button"
              onClick={() => void onStop()}
              className="rounded border border-rose-400/30 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-500/10"
            >
              stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onStart()}
              disabled={scriptInfo ? !scriptInfo.installed : false}
              className="rounded bg-cue-500/20 px-2 py-1 text-[10px] text-cue-100 hover:bg-cue-500/30 disabled:opacity-50"
            >
              start
            </button>
          )}
        </div>
      </div>
      {scriptInfo && !scriptInfo.installed ? (
        <p className="mt-2 text-[10px] text-amber-200">
          Sidecar script not found at <code>{scriptInfo.scriptPath}</code>.
          Install with <code>pip install -r sidecar/requirements.txt</code> — see <code>sidecar/README.md</code>.
        </p>
      ) : null}
    </div>
  );
}

function OllamaControls({
  ollama,
}: {
  ollama: { reachable: boolean; baseUrl: string; models: string[] } | null;
}): JSX.Element | null {
  if (!ollama) return null;
  return (
    <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            ollama.models.length > 0 ? 'bg-cue-300' : 'bg-slate-600'
          }`}
        />
        <span className="font-medium text-slate-200">Ollama (local LLM)</span>
        <span className="font-mono text-[10px] text-slate-500">{ollama.baseUrl}</span>
      </div>
      {ollama.models.length === 0 ? (
        <p className="mt-1 text-[10px] text-slate-500">
          Couldn&apos;t reach Ollama or no models pulled. Install Ollama from
          <a
            href="https://ollama.com"
            className="ml-1 text-cue-300 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            ollama.com
          </a>{' '}
          and run <code>ollama pull llama3.2</code>.
        </p>
      ) : (
        <p className="mt-1 text-[10px] text-slate-400">
          installed: <span className="font-mono">{ollama.models.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

function ModelRow({
  def,
  status,
}: {
  def: ModelDefinition;
  status: ModelStatus;
}): JSX.Element {
  return (
    <li className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-200">{def.displayName}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
              {def.runtime}
            </span>
            {def.hardware ? (
              <span className="text-[10px] text-slate-500">{def.hardware}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">{def.description}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {def.size.label} · {def.languages.join(' / ')}
          </p>
        </div>
        <ModelActions def={def} status={status} />
      </div>
      <ProgressRow status={status} />
    </li>
  );
}

function ModelActions({
  def,
  status,
}: {
  def: ModelDefinition;
  status: ModelStatus;
}): JSX.Element {
  if (status.state === 'downloading' || status.state === 'verifying') {
    return (
      <button
        type="button"
        onClick={() => void window.opencue.models.cancelDownload(def.id)}
        className="rounded border border-amber-400/30 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-500/10"
      >
        cancel
      </button>
    );
  }
  if (status.state === 'installed') {
    return (
      <button
        type="button"
        onClick={() => void window.opencue.models.remove(def.id)}
        className="rounded border border-rose-400/30 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-500/10"
      >
        remove
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void window.opencue.models.download(def.id)}
      className="rounded bg-cue-500/20 px-2 py-1 text-[10px] text-cue-100 hover:bg-cue-500/30"
    >
      download
    </button>
  );
}

function ProgressRow({ status }: { status: ModelStatus }): JSX.Element | null {
  if (status.state === 'downloading') {
    const pct = status.totalBytes > 0 ? (status.receivedBytes / status.totalBytes) * 100 : 0;
    const eta = status.etaSec !== null ? `${Math.max(0, Math.round(status.etaSec))}s` : '–';
    return (
      <div className="mt-2 space-y-1">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-cue-500/80 transition-[width] duration-150"
            style={{ width: `${Math.min(100, Math.max(0, pct)).toFixed(2)}%` }}
          />
        </div>
        <div className="flex justify-between font-mono text-[10px] text-slate-500">
          <span>
            {humanBytes(status.receivedBytes)} / {humanBytes(status.totalBytes)}
          </span>
          <span>
            {humanBytes(status.bytesPerSec)}/s · ETA {eta}
          </span>
        </div>
      </div>
    );
  }
  if (status.state === 'verifying') {
    return <p className="mt-2 text-[10px] text-amber-200">Verifying checksum…</p>;
  }
  if (status.state === 'failed') {
    return (
      <p className="mt-2 rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200">
        {status.message}
      </p>
    );
  }
  if (status.state === 'installed') {
    return (
      <p className="mt-2 text-[10px] text-slate-500">
        installed · {humanBytes(status.totalBytes)}
      </p>
    );
  }
  return null;
}
