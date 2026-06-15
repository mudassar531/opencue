import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ApiKeyPresence,
  ProviderCapabilities,
  ProviderSelection,
} from '../../../shared/ipc-contract';
import {
  DEFAULT_PROVIDER_SELECTION,
  type LlmProviderIdValue,
  type SttProviderIdValue,
  type TtsProviderIdValue,
} from '../../../shared/provider-types';

/**
 * Provider settings panel: pick a backend per capability, paste API keys, and
 * tune basic LLM knobs. Keys are stored encrypted via Electron `safeStorage`
 * — the renderer only learns whether a slot is populated, not the key itself.
 */
export function ProviderSettings(): JSX.Element {
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | null>(null);
  const [presence, setPresence] = useState<ApiKeyPresence>({});
  const [safeStorageAvailable, setSafeStorageAvailable] = useState(true);
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [caps, p, s] = await Promise.all([
      window.opencue.providers.getCapabilities(),
      window.opencue.providers.getKeyPresence(),
      window.opencue.settings.get(),
    ]);
    setCapabilities(caps);
    setPresence(p.presence);
    setSafeStorageAvailable(p.safeStorageAvailable);
    setSelection(s.providers);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.opencue.settings.onChanged((next) => setSelection(next.providers));
    return () => off();
  }, [refresh]);

  const updateSelection = useCallback(
    async (patch: Partial<ProviderSelection>) => {
      const next = await window.opencue.providers.updateSelection(patch);
      setSelection(next);
    },
    [],
  );

  const setKey = useCallback(
    async (scope: 'stt' | 'llm' | 'tts', providerId: string) => {
      const value = keys[`${scope}.${providerId}`] ?? '';
      const res = await window.opencue.providers.setApiKey(scope, providerId, value);
      setSafeStorageAvailable(res.safeStorageAvailable);
      if (!res.ok) {
        setSaveMessage(
          res.safeStorageAvailable
            ? 'Saving the API key failed.'
            : 'safeStorage is unavailable on this OS; opencue refuses to store keys in plaintext.',
        );
      } else {
        setSaveMessage(value.length === 0 ? 'Key cleared.' : 'Key saved (encrypted).');
        setKeys((prev) => ({ ...prev, [`${scope}.${providerId}`]: '' }));
        const p = await window.opencue.providers.getKeyPresence();
        setPresence(p.presence);
      }
      window.setTimeout(() => setSaveMessage(null), 3500);
    },
    [keys],
  );

  const deleteKey = useCallback(async (scope: 'stt' | 'llm' | 'tts', providerId: string) => {
    await window.opencue.providers.deleteApiKey(scope, providerId);
    const p = await window.opencue.providers.getKeyPresence();
    setPresence(p.presence);
    setSaveMessage('Key removed.');
    window.setTimeout(() => setSaveMessage(null), 2500);
  }, []);

  const sttPicks = useMemo(() => capabilities?.stt ?? [], [capabilities]);
  const llmPicks = useMemo(() => capabilities?.llm ?? [], [capabilities]);
  const ttsPicks = useMemo(() => capabilities?.tts ?? [], [capabilities]);

  if (!capabilities || !selection) {
    return (
      <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
        Loading providers…
      </section>
    );
  }

  return (
    <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Providers &amp; API keys
        </h2>
        {!safeStorageAvailable ? (
          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-200">
            safeStorage unavailable
          </span>
        ) : null}
      </div>

      {saveMessage ? (
        <p className="mb-3 rounded-md border border-cue-400/30 bg-cue-500/10 px-3 py-2 text-xs text-cue-100">
          {saveMessage}
        </p>
      ) : null}

      {/* STT */}
      <CapabilityRow
        label="Speech-to-text"
        currentId={selection.stt.id}
        currentModel={selection.stt.model}
        options={sttPicks}
        onChange={(id, model) => updateSelection({ stt: { id: id as SttProviderIdValue, model } })}
      />
      <ApiKeyRow
        scope="stt"
        providerId={selection.stt.id}
        presence={presence}
        value={keys[`stt.${selection.stt.id}`] ?? ''}
        onChange={(v) => setKeys((prev) => ({ ...prev, [`stt.${selection.stt.id}`]: v }))}
        onSave={() => setKey('stt', selection.stt.id)}
        onDelete={() => deleteKey('stt', selection.stt.id)}
      />

      {/* LLM */}
      <CapabilityRow
        label="Language model"
        currentId={selection.llm.id}
        currentModel={selection.llm.model}
        options={llmPicks}
        onChange={(id, model) =>
          updateSelection({ llm: { ...selection.llm, id: id as LlmProviderIdValue, model } })
        }
      />
      <div className="mb-3 mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
        <label className="flex flex-col gap-1">
          <span>temperature</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={selection.llm.temperature}
            onChange={(e) =>
              updateSelection({
                llm: { ...selection.llm, temperature: Number(e.target.value) },
              })
            }
            className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>max output tokens</span>
          <input
            type="number"
            min={16}
            max={8192}
            step={16}
            value={selection.llm.maxOutputTokens}
            onChange={(e) =>
              updateSelection({
                llm: { ...selection.llm, maxOutputTokens: Number(e.target.value) },
              })
            }
            className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-slate-100"
          />
        </label>
      </div>
      <ApiKeyRow
        scope="llm"
        providerId={selection.llm.id}
        presence={presence}
        value={keys[`llm.${selection.llm.id}`] ?? ''}
        onChange={(v) => setKeys((prev) => ({ ...prev, [`llm.${selection.llm.id}`]: v }))}
        onSave={() => setKey('llm', selection.llm.id)}
        onDelete={() => deleteKey('llm', selection.llm.id)}
      />

      {/* TTS */}
      <CapabilityRow
        label="Text-to-speech"
        currentId={selection.tts.id}
        currentModel={selection.tts.model}
        options={ttsPicks}
        onChange={(id, model) =>
          updateSelection({ tts: { ...selection.tts, id: id as TtsProviderIdValue, model } })
        }
      />
      <div className="mb-3 mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          <span>voice</span>
          <select
            value={selection.tts.voice}
            onChange={(e) => updateSelection({ tts: { ...selection.tts, voice: e.target.value } })}
            className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-slate-100"
          >
            {(ttsPicks.find((p) => p.id === selection.tts.id)?.voices ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selection.tts.autoPlay}
            onChange={(e) =>
              updateSelection({ tts: { ...selection.tts, autoPlay: e.target.checked } })
            }
          />
          <span>auto-play suggestions</span>
        </label>
      </div>
      <ApiKeyRow
        scope="tts"
        providerId={selection.tts.id}
        presence={presence}
        value={keys[`tts.${selection.tts.id}`] ?? ''}
        onChange={(v) => setKeys((prev) => ({ ...prev, [`tts.${selection.tts.id}`]: v }))}
        onSave={() => setKey('tts', selection.tts.id)}
        onDelete={() => deleteKey('tts', selection.tts.id)}
      />

      <div className="mt-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Assist system prompt</span>
          <textarea
            value={selection.assistSystemPrompt}
            onChange={(e) => updateSelection({ assistSystemPrompt: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-100"
          />
        </label>
        <button
          type="button"
          onClick={() => updateSelection(DEFAULT_PROVIDER_SELECTION)}
          className="mt-2 rounded-md border border-slate-700 px-3 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
        >
          Restore provider defaults
        </button>
      </div>
    </section>
  );
}

interface CapabilityRowProps {
  label: string;
  currentId: string;
  currentModel: string;
  options: { id: string; displayName: string; models: readonly string[] }[];
  onChange: (id: string, model: string) => void;
}

function CapabilityRow({
  label,
  currentId,
  currentModel,
  options,
  onChange,
}: CapabilityRowProps): JSX.Element {
  const current = options.find((o) => o.id === currentId);
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={currentId}
          onChange={(e) => {
            const next = options.find((o) => o.id === e.target.value);
            const model = next?.models[0] ?? currentModel;
            onChange(e.target.value, model);
          }}
          className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 text-slate-100"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.displayName}
            </option>
          ))}
        </select>
        <select
          value={currentModel}
          onChange={(e) => onChange(currentId, e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-slate-100"
        >
          {(current?.models ?? [currentModel]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface ApiKeyRowProps {
  scope: 'stt' | 'llm' | 'tts';
  providerId: string;
  presence: ApiKeyPresence;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

function ApiKeyRow({
  scope,
  providerId,
  presence,
  value,
  onChange,
  onSave,
  onDelete,
}: ApiKeyRowProps): JSX.Element {
  const hasKey = presence[`${scope}.${providerId}`] === true;
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasKey ? '••• key stored ' : 'paste API key'}
        className="flex-1 rounded-md border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-xs text-slate-100"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={onSave}
        className="rounded-md bg-cue-500/20 px-3 py-1 text-xs text-cue-100 hover:bg-cue-500/30"
      >
        save
      </button>
      {hasKey ? (
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-400/30 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10"
        >
          clear
        </button>
      ) : null}
    </div>
  );
}
