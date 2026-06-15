import { describe, expect, it } from 'vitest';
import { encodeWavFromFloat32 } from './wav';

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i += 1) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWavFromFloat32', () => {
  it('writes a valid 44-byte RIFF/WAVE/fmt/data header for mono 16k PCM', () => {
    const samples = new Float32Array([0, 0.25, -0.25, 0]);
    const out = encodeWavFromFloat32(samples, 16000);
    const view = new DataView(out.buffer);

    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(readAscii(view, 8, 4)).toBe('WAVE');

    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(16000 * 2);
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bit depth

    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.25 * 0x7fff));
    expect(view.getInt16(48, true)).toBe(Math.round(-0.25 * 0x7fff));
    expect(view.getInt16(50, true)).toBe(0);
  });

  it('clamps out-of-range samples to int16 limits', () => {
    const samples = new Float32Array([2, -3]);
    const out = encodeWavFromFloat32(samples, 16000);
    const view = new DataView(out.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x7fff);
  });

  it('rejects invalid sample rates', () => {
    expect(() => encodeWavFromFloat32(new Float32Array(4), 0)).toThrow(RangeError);
    expect(() => encodeWavFromFloat32(new Float32Array(4), -1)).toThrow(RangeError);
    expect(() => encodeWavFromFloat32(new Float32Array(4), 16000.5)).toThrow(RangeError);
  });

  it('handles an empty sample array (header only)', () => {
    const out = encodeWavFromFloat32(new Float32Array(0), 16000);
    expect(out.byteLength).toBe(44);
    const view = new DataView(out.buffer);
    expect(view.getUint32(40, true)).toBe(0);
  });
});
