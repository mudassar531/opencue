import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '../../shared/provider-types';
import { SttProviderId } from '../../shared/provider-types';
import { TranscriptBuffer } from './transcript-buffer';

function entry(id: number, text: string): TranscriptEntry {
  return {
    id,
    text,
    startedAt: 0,
    completedAt: 0,
    providerId: SttProviderId.OpenAIWhisper,
  };
}

describe('TranscriptBuffer', () => {
  it('rejects invalid options', () => {
    expect(() => new TranscriptBuffer({ maxEntries: 0, maxContextChars: 10 })).toThrow(RangeError);
    expect(() => new TranscriptBuffer({ maxEntries: 1, maxContextChars: 0 })).toThrow(RangeError);
  });

  it('keeps only the most recent maxEntries lines', () => {
    const tb = new TranscriptBuffer({ maxEntries: 3, maxContextChars: 1000 });
    for (let i = 0; i < 5; i += 1) tb.add(entry(i, `line ${i}`));
    expect(tb.list().map((e) => e.id)).toEqual([2, 3, 4]);
  });

  it('renderContext joins newest entries up to maxContextChars', () => {
    const tb = new TranscriptBuffer({ maxEntries: 10, maxContextChars: 20 });
    tb.add(entry(1, 'this is very long that wouldnt fit'));
    tb.add(entry(2, 'short'));
    tb.add(entry(3, 'tail'));
    const ctx = tb.renderContext();
    // 'short\ntail' = 10 chars, fits.
    expect(ctx).toBe('short\ntail');
  });

  it('skips empty / whitespace-only entries when rendering', () => {
    const tb = new TranscriptBuffer({ maxEntries: 10, maxContextChars: 1000 });
    tb.add(entry(1, 'hello'));
    tb.add(entry(2, '   '));
    tb.add(entry(3, 'world'));
    expect(tb.renderContext()).toBe('hello\nworld');
  });

  it('buildPrompt always emits system then user', () => {
    const tb = new TranscriptBuffer({ maxEntries: 10, maxContextChars: 1000 });
    tb.add(entry(1, 'we should ship'));
    const messages = tb.buildPrompt('sys', 'help');
    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe('sys');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('we should ship');
    expect(messages[1]?.content).toContain('User question:\nhelp');
  });

  it('buildPrompt omits the context block when transcript is empty', () => {
    const tb = new TranscriptBuffer({ maxEntries: 10, maxContextChars: 1000 });
    const messages = tb.buildPrompt('sys', 'hello');
    expect(messages[1]?.content).toBe('hello');
  });

  it('clear() empties the buffer', () => {
    const tb = new TranscriptBuffer({ maxEntries: 10, maxContextChars: 1000 });
    tb.add(entry(1, 'a'));
    tb.clear();
    expect(tb.list()).toEqual([]);
    expect(tb.renderContext()).toBe('');
  });
});
