/**
 * Pure transcript context buffer.
 *
 * Stores the most recent finalized transcript entries and renders the
 * conversation window the LLM sees. Keeps a hard cap so a marathon meeting
 * cannot make every Assist call exorbitantly large.
 */

import type { LlmMessage, TranscriptEntry } from '../../shared/provider-types.js';

export interface TranscriptBufferOptions {
  /** Maximum number of transcript entries to retain. */
  maxEntries: number;
  /** Maximum characters of meeting context handed to the LLM. */
  maxContextChars: number;
}

export class TranscriptBuffer {
  private entries: TranscriptEntry[] = [];
  private readonly options: TranscriptBufferOptions;

  constructor(options: TranscriptBufferOptions = { maxEntries: 200, maxContextChars: 8000 }) {
    if (options.maxEntries <= 0) throw new RangeError('maxEntries must be > 0');
    if (options.maxContextChars <= 0) throw new RangeError('maxContextChars must be > 0');
    this.options = options;
  }

  add(entry: TranscriptEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.options.maxEntries) {
      this.entries.splice(0, this.entries.length - this.options.maxEntries);
    }
  }

  list(): readonly TranscriptEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  /** Build a `Meeting transcript so far:` block from the most recent entries. */
  renderContext(): string {
    const lines: string[] = [];
    let totalChars = 0;
    // Walk from newest backwards so we keep the most recent context if we
    // need to truncate.
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i]!;
      const line = entry.text.trim();
      if (line.length === 0) continue;
      if (totalChars + line.length > this.options.maxContextChars) break;
      lines.unshift(line);
      totalChars += line.length;
    }
    return lines.join('\n');
  }

  /** Build the full LLM prompt (system + meeting context + user ask). */
  buildPrompt(systemPrompt: string, userPrompt: string): LlmMessage[] {
    const context = this.renderContext();
    const userContent =
      context.length > 0
        ? `Meeting transcript so far:\n"""\n${context}\n"""\n\nUser question:\n${userPrompt}`
        : userPrompt;
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
  }
}

/** The default question Assist asks when the user just hits the hotkey. */
export const DEFAULT_ASSIST_PROMPT =
  'Based on the meeting transcript above, what is the most useful thing I could say next? Keep it to one short sentence.';

/** The default recap prompt. */
export const DEFAULT_RECAP_PROMPT =
  'Summarize the meeting transcript above in 3-5 short bullet points: key decisions, open questions, and action items. Do not invent details that are not in the transcript.';
