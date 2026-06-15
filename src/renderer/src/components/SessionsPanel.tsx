import { useCallback, useEffect, useState } from 'react';
import type {
  SessionListEntry,
  SessionRecord,
} from '../../../shared/ipc-contract';

/**
 * Session lifecycle + history surface.
 *
 * - Start / stop / title the current capture session.
 * - List, load, copy-as-markdown, save-as-file, generate-summary, delete.
 */
export function SessionsPanel(): JSX.Element {
  const [current, setCurrent] = useState<SessionRecord | null>(null);
  const [list, setList] = useState<SessionListEntry[]>([]);
  const [titleDraft, setTitleDraft] = useState('');
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    const [c, l] = await Promise.all([
      window.opencue.sessions.getCurrent(),
      window.opencue.sessions.list(),
    ]);
    setCurrent(c);
    setList(l);
  }, []);

  useEffect(() => {
    void refreshAll();
    const offSession = window.opencue.sessions.onChanged((next) => {
      setCurrent(next);
      // Refresh the list lazily so 'just stopped' sessions appear there.
      void window.opencue.sessions.list().then(setList).catch(() => undefined);
    });
    return () => offSession();
  }, [refreshAll]);

  const flash = useCallback((message: string) => {
    setSavedMessage(message);
    window.setTimeout(() => setSavedMessage(null), 2500);
  }, []);

  const handleStart = useCallback(async () => {
    const title = titleDraft.trim();
    const args: { title?: string } = {};
    if (title.length > 0) args.title = title;
    await window.opencue.sessions.start(args);
    setTitleDraft('');
  }, [titleDraft]);

  const handleStop = useCallback(async () => {
    await window.opencue.sessions.stop();
  }, []);

  const handleSummarize = useCallback(
    async (id: string) => {
      setGeneratingFor(id);
      try {
        await window.opencue.sessions.generateSummary(id);
        await refreshAll();
        flash('Summary generated and saved.');
      } finally {
        setGeneratingFor(null);
      }
    },
    [flash, refreshAll],
  );

  const handleCopy = useCallback(
    async (id: string) => {
      const exported = await window.opencue.sessions.exportMarkdown(id);
      if (exported) {
        await navigator.clipboard.writeText(exported.markdown);
        flash('Markdown copied to clipboard.');
      }
    },
    [flash],
  );

  const handleDownload = useCallback(
    async (id: string) => {
      const exported = await window.opencue.sessions.exportMarkdown(id);
      if (!exported) return;
      const blob = new Blob([exported.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exported.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash(`Saved ${exported.filename}.`);
    },
    [flash],
  );

  const handleDelete = useCallback(async (id: string) => {
    await window.opencue.sessions.remove(id);
    await window.opencue.sessions.list().then(setList);
  }, []);

  return (
    <section className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Sessions
        </h2>
        {savedMessage ? (
          <span className="rounded-full bg-cue-500/15 px-2 py-0.5 text-[10px] text-cue-100">
            {savedMessage}
          </span>
        ) : null}
      </div>

      <CurrentSession
        current={current}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        onStart={handleStart}
        onStop={handleStop}
        onSummarize={(id) => void handleSummarize(id)}
        onCopy={(id) => void handleCopy(id)}
        onDownload={(id) => void handleDownload(id)}
        generatingFor={generatingFor}
      />

      <div className="mt-4">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          Past sessions ({list.length})
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-slate-500">No saved sessions yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((entry) => (
              <li
                key={entry.id}
                className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-100">{entry.title}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {new Date(entry.startedAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {entry.transcriptCount} transcript · {entry.suggestionCount} suggestions
                  {entry.hasSummary ? ' · summary ✓' : ''} ·{' '}
                  {entry.endedAt ? 'closed' : 'in progress'} ·{' '}
                  {(entry.diskBytes / 1024).toFixed(1)} KB
                  {entry.sourceLabel ? ` · ${entry.sourceLabel}` : ''}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy(entry.id)}
                    className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                  >
                    copy md
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload(entry.id)}
                    className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                  >
                    download
                  </button>
                  {!entry.hasSummary && current?.id !== entry.id ? null : null}
                  <button
                    type="button"
                    onClick={() => void handleDelete(entry.id)}
                    className="rounded border border-rose-400/30 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-500/10"
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface CurrentSessionProps {
  current: SessionRecord | null;
  titleDraft: string;
  setTitleDraft: (v: string) => void;
  onStart: () => void;
  onStop: () => void;
  onSummarize: (id: string) => void;
  onCopy: (id: string) => void;
  onDownload: (id: string) => void;
  generatingFor: string | null;
}

function CurrentSession({
  current,
  titleDraft,
  setTitleDraft,
  onStart,
  onStop,
  onSummarize,
  onCopy,
  onDownload,
  generatingFor,
}: CurrentSessionProps): JSX.Element {
  if (!current) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
      >
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Optional session title (default uses today's date)"
          className="flex-1 rounded-md border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500"
        />
        <button
          type="submit"
          className="rounded-md bg-cue-500/20 px-3 py-1.5 text-xs text-cue-100 hover:bg-cue-500/30"
        >
          Start session
        </button>
      </form>
    );
  }

  const isGenerating = generatingFor === current.id;
  return (
    <div className="rounded-md border border-cue-400/30 bg-cue-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-cue-50">{current.title}</div>
          <div className="text-[10px] text-cue-200/80">
            started {new Date(current.startedAt).toLocaleTimeString()} ·{' '}
            {current.transcript.length} transcript · {current.suggestions.length}{' '}
            suggestions
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onSummarize(current.id)}
            className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {isGenerating ? 'summarizing…' : 'summarize'}
          </button>
          <button
            type="button"
            onClick={() => onCopy(current.id)}
            className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
          >
            copy md
          </button>
          <button
            type="button"
            onClick={() => onDownload(current.id)}
            className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
          >
            download
          </button>
          <button
            type="button"
            onClick={onStop}
            className="rounded border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-500/20"
          >
            stop
          </button>
        </div>
      </div>
    </div>
  );
}
