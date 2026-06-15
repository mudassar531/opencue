import { describe, expect, it } from 'vitest';
import {
  MODEL_REGISTRY,
  findModel,
  humanBytes,
  modelsByKind,
} from './model-registry';

describe('MODEL_REGISTRY', () => {
  it('contains at least one model per supported kind', () => {
    expect(modelsByKind('stt').length).toBeGreaterThanOrEqual(2);
    expect(modelsByKind('tts').length).toBeGreaterThanOrEqual(2);
  });

  it('has unique ids and stable names', () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODEL_REGISTRY) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.files.length).toBeGreaterThan(0);
      for (const f of m.files) {
        expect(f.name.length).toBeGreaterThan(0);
        expect(f.url.startsWith('http')).toBe(true);
      }
    }
  });

  it('places Parakeet under STT (it is an ASR family, not TTS)', () => {
    const parakeet = MODEL_REGISTRY.find((m) => m.runtime === 'parakeet');
    expect(parakeet).toBeDefined();
    expect(parakeet?.kind).toBe('stt');
  });

  it('places Piper / Kokoro under TTS', () => {
    const piperOrKokoro = MODEL_REGISTRY.filter(
      (m) => m.runtime === 'piper' || m.runtime === 'kokoro',
    );
    for (const m of piperOrKokoro) expect(m.kind).toBe('tts');
  });

  it('findModel returns the right entry', () => {
    expect(findModel('faster-whisper-tiny.en')?.runtime).toBe('faster-whisper');
    expect(findModel('does-not-exist')).toBeUndefined();
  });
});

describe('humanBytes', () => {
  it('formats common ranges sensibly', () => {
    expect(humanBytes(0)).toBe('0 B');
    expect(humanBytes(500)).toBe('500 B');
    expect(humanBytes(1024)).toBe('1.00 KB');
    expect(humanBytes(1024 * 1024)).toBe('1.00 MB');
    expect(humanBytes(1500 * 1024 * 1024)).toBe('1.46 GB');
  });

  it('handles non-finite / negative inputs', () => {
    expect(humanBytes(Number.NaN)).toBe('0 B');
    expect(humanBytes(-7)).toBe('0 B');
  });
});
