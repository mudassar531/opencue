import { describe, expect, it } from 'vitest';
import { loopbackSupported } from './audio-orchestrator';

describe('loopbackSupported', () => {
  it('reports true for Windows + macOS (native loopback paths)', () => {
    expect(loopbackSupported('win32')).toBe(true);
    expect(loopbackSupported('darwin')).toBe(true);
  });

  it('reports false for Linux (the picker falls back to mic + monitor source)', () => {
    expect(loopbackSupported('linux')).toBe(false);
  });

  it('reports false for unknown / non-mainstream platforms', () => {
    expect(loopbackSupported('aix')).toBe(false);
    expect(loopbackSupported('freebsd')).toBe(false);
    expect(loopbackSupported('openbsd')).toBe(false);
    expect(loopbackSupported('sunos')).toBe(false);
  });
});
