/**
 * Session manager (Phase 6).
 *
 * Owns the lifecycle of meeting sessions:
 *   - One "current" session at a time (start / stop).
 *   - Persists each session as a JSON file under `userData/sessions/<id>.json`.
 *   - Subscribes to assist orchestrator events so transcript entries and
 *     suggestions stream into the current session automatically.
 *   - Lists, loads, deletes, exports past sessions.
 *
 * The orchestrator is the source of truth for the *live* transcript /
 * suggestion arrays; the session manager simply snapshots them on start +
 * appends to its own copy on every event so the on-disk file always
 * reflects what the user just saw.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import {
  defaultSessionTitle,
  formatSessionMarkdown,
  type SessionListEntry,
  type SessionRecord,
  type SessionSummary,
} from '../../shared/session-types.js';
import type { AssistSuggestion, TranscriptEntry } from '../../shared/provider-types.js';
import { getAssistOrchestrator } from '../assist/assist-orchestrator.js';

export interface StartSessionArgs {
  title?: string;
  sourceLabel?: string | null;
}

export class SessionManager extends EventEmitter {
  private current: SessionRecord | null = null;
  private rootDir: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  /** Lazy root resolution — `app.getPath('userData')` is only safe after
   *  `app.whenReady()`. We accept a cwd override for tests. */
  setRoot(cwd?: string): void {
    this.rootDir = join(cwd ?? app.getPath('userData'), 'sessions');
  }

  private async ensureRoot(): Promise<string> {
    if (!this.rootDir) this.setRoot();
    const dir = this.rootDir!;
    await mkdir(dir, { recursive: true });
    return dir;
  }

  getCurrent(): SessionRecord | null {
    return this.current ? structuredClone(this.current) : null;
  }

  async start(args: StartSessionArgs = {}): Promise<SessionRecord> {
    if (this.current) {
      await this.stop();
    }
    const startedAt = Date.now();
    const id = `sess_${startedAt}_${Math.floor(Math.random() * 0x7fff).toString(16)}`;
    const orchestrator = getAssistOrchestrator();
    const record: SessionRecord = {
      id,
      title: args.title?.trim().length ? args.title.trim() : defaultSessionTitle(startedAt),
      sourceLabel: args.sourceLabel ?? null,
      startedAt,
      endedAt: null,
      transcript: Array.from(orchestrator.getTranscript()),
      suggestions: Array.from(orchestrator.getSuggestions()),
      summary: null,
    };
    this.current = record;
    this.wireOrchestratorListeners();
    await this.persistCurrent();
    this.emit('changed', this.snapshot());
    return structuredClone(record);
  }

  async stop(): Promise<SessionRecord | null> {
    if (!this.current) return null;
    this.current.endedAt = Date.now();
    this.unwireOrchestratorListeners();
    await this.persistCurrent(true);
    const snap = structuredClone(this.current);
    this.current = null;
    this.emit('changed', null);
    return snap;
  }

  async setSummary(summary: SessionSummary): Promise<SessionRecord | null> {
    if (!this.current) return null;
    this.current.summary = summary;
    await this.persistCurrent(true);
    this.emit('changed', this.snapshot());
    return structuredClone(this.current);
  }

  /** Set the title of the currently active session. */
  async setTitle(title: string): Promise<SessionRecord | null> {
    if (!this.current) return null;
    this.current.title = title.trim().length > 0 ? title.trim() : this.current.title;
    await this.persistCurrent(true);
    this.emit('changed', this.snapshot());
    return structuredClone(this.current);
  }

  async list(): Promise<SessionListEntry[]> {
    const dir = await this.ensureRoot();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: SessionListEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = join(dir, name);
      try {
        const buf = await readFile(path, 'utf8');
        const record = JSON.parse(buf) as SessionRecord;
        const st = await stat(path);
        out.push({
          id: record.id,
          title: record.title,
          sourceLabel: record.sourceLabel ?? null,
          startedAt: record.startedAt,
          endedAt: record.endedAt ?? null,
          transcriptCount: record.transcript?.length ?? 0,
          suggestionCount: record.suggestions?.length ?? 0,
          hasSummary: !!record.summary,
          diskBytes: st.size,
        });
      } catch {
        // Skip malformed files.
      }
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  async load(id: string): Promise<SessionRecord | null> {
    const dir = await this.ensureRoot();
    try {
      const buf = await readFile(join(dir, `${id}.json`), 'utf8');
      return JSON.parse(buf) as SessionRecord;
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    const dir = await this.ensureRoot();
    try {
      await rm(join(dir, `${id}.json`));
      if (this.current?.id === id) {
        this.current = null;
        this.unwireOrchestratorListeners();
        this.emit('changed', null);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Returns the on-disk Markdown for a session (current or persisted). */
  async exportMarkdown(id: string): Promise<{ filename: string; markdown: string } | null> {
    let record: SessionRecord | null = null;
    if (this.current?.id === id) record = this.current;
    else record = await this.load(id);
    if (!record) return null;
    const safe = record.title.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || record.id;
    const filename = `${safe}.md`;
    return { filename, markdown: formatSessionMarkdown(record) };
  }

  /* ---------------- internal ---------------- */

  private snapshot(): SessionRecord | null {
    return this.current ? structuredClone(this.current) : null;
  }

  private wireOrchestratorListeners(): void {
    const o = getAssistOrchestrator();
    const onTranscript = (entry: TranscriptEntry): void => {
      if (!this.current) return;
      this.current.transcript.push(entry);
      this.scheduleSave();
      this.emit('changed', this.snapshot());
    };
    const onSuggestionStarted = (sug: AssistSuggestion): void => {
      if (!this.current) return;
      this.current.suggestions = [sug, ...this.current.suggestions].slice(0, 200);
      this.scheduleSave();
      this.emit('changed', this.snapshot());
    };
    const onSuggestionCompleted = (sug: AssistSuggestion): void => {
      if (!this.current) return;
      this.current.suggestions = this.current.suggestions.map((s) => (s.id === sug.id ? sug : s));
      this.scheduleSave();
      this.emit('changed', this.snapshot());
    };
    const onReset = (): void => {
      if (!this.current) return;
      this.current.transcript = [];
      this.current.suggestions = [];
      this.scheduleSave();
      this.emit('changed', this.snapshot());
    };
    const wrap = (event: string, handler: (...args: never[]) => void): (() => void) => {
      const fn = (payload: unknown): void => {
        // Re-emit only the events we care about via a single combined listener.
        switch (event) {
          case 'transcript-entry':
            handler(payload as never);
            break;
          case 'suggestion-started':
            handler(payload as never);
            break;
          case 'suggestion-completed':
            handler(payload as never);
            break;
          case 'reset':
            handler();
            break;
        }
      };
      // We hook the orchestrator's generic 'event' emitter and pivot on type.
      return () => {
        void fn; // satisfy TS
      };
    };
    void wrap; // The wrap helper above is unused — we attach the unified listener below.

    const onEvent = (event: unknown): void => {
      if (!event || typeof event !== 'object') return;
      const e = event as { type: string };
      switch (e.type) {
        case 'transcript-entry':
          onTranscript((event as { entry: TranscriptEntry }).entry);
          break;
        case 'suggestion-started':
          onSuggestionStarted((event as { suggestion: AssistSuggestion }).suggestion);
          break;
        case 'suggestion-completed':
          onSuggestionCompleted((event as { suggestion: AssistSuggestion }).suggestion);
          break;
        case 'reset':
          onReset();
          break;
      }
    };
    o.on('event', onEvent);
    this.unsubscribe = () => o.off('event', onEvent);
  }

  private unwireOrchestratorListeners(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persistCurrent().catch(() => undefined);
    }, 800);
  }

  private async persistCurrent(immediate: boolean = false): Promise<void> {
    if (!this.current) return;
    const dir = await this.ensureRoot();
    const path = join(dir, `${this.current.id}.json`);
    const data = JSON.stringify(this.current, null, 2);
    if (immediate && this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await writeFile(path, data, 'utf8');
  }
}

let _manager: SessionManager | null = null;
export function getSessionManager(): SessionManager {
  if (!_manager) _manager = new SessionManager();
  return _manager;
}
export function _resetSessionManagerForTests(): void {
  _manager = null;
}
